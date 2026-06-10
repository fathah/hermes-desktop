import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/mock/app",
    isPackaged: false,
    getPath: (name: string) => `/mock/user-data/${name}`,
  },
}));

vi.mock("readline", () => {
  const fns = {
    createInterface: (options: { input: unknown }) => options.input,
  };
  return {
    ...fns,
    default: fns,
  };
});

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  const existsSync = (path: string): boolean => {
    if (typeof path === "string" && path.includes("/mock/")) return true;
    return actual.existsSync(path);
  };
  return {
    ...actual,
    existsSync,
    default: {
      ...actual,
      existsSync,
    },
  };
});

// Hoist mockSpawn so it's initialized before vi.mock() is executed.
const { mockSpawn } = vi.hoisted(() => {
  return {
    mockSpawn: vi.fn(),
  };
});

vi.mock("child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    spawn: (...args: unknown[]) => mockSpawn(...args),
    default: {
      ...actual,
      spawn: (...args: unknown[]) => mockSpawn(...args),
    },
  };
});

vi.mock("./installer/paths", () => ({
  HERMES_PYTHON: "/mock/bin/python",
  getBundledScriptPath: (name: string) => `/mock/scripts/${name}`,
}));

// Import semanticManager after mocking child_process & fs
import { semanticManager } from "./semantic-index";

describe("SemanticGraphManager", () => {
  let mockProc: EventEmitter & {
    stdin?: unknown;
    stdout?: unknown;
    kill?: () => void;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    semanticManager.stop();
    mockSpawn.mockReset();

    // Create a mock child process with stdin/stdout streams
    const stdoutEmitter = new EventEmitter() as EventEmitter & {
      resume?: unknown;
      pause?: unknown;
    };
    stdoutEmitter.resume = vi.fn();
    stdoutEmitter.pause = vi.fn();
    const stdinMock = {
      write: vi.fn((data: string, _encoding: string, cb?: () => void) => {
        // Parse the message sent to stdin
        const req = JSON.parse(data.trim());
        // Simulate python process reply on stdout after a brief delay
        process.nextTick(() => {
          let result: Record<string, unknown> = { ok: true };
          if (req.cmd === "search") {
            result = { results: [{ path: "test.md", score: 0.9 }] };
          } else if (req.cmd === "rag") {
            result = {
              context: [{ path: "test.md", title: "Test", content: "hello" }],
            };
          } else if (req.cmd === "graph") {
            result = { nodes: [], edges: [] };
          }
          stdoutEmitter.emit("line", JSON.stringify({ id: req.id, result }));
        });
        if (cb) cb();
        return true;
      }),
    };

    mockProc = new EventEmitter();
    mockProc.stdin = stdinMock;
    mockProc.stdout = stdoutEmitter;
    mockProc.kill = vi.fn(() => {
      mockProc.emit("exit", 0);
    });

    mockSpawn.mockReturnValue(mockProc);
  });

  afterEach(() => {
    vi.useRealTimers();
    semanticManager.stop();
    vi.restoreAllMocks();
  });

  it("spawns the subprocess on the first command and manages its lifecycle", async () => {
    const searchPromise = semanticManager.search("query", 3);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith(
      "/mock/bin/python",
      ["/mock/scripts/semantic_engine.py"],
      expect.any(Object),
    );

    const res = await searchPromise;
    expect(res.results).toHaveLength(1);
    expect(res.results[0].path).toBe("test.md");

    semanticManager.stop();
    expect(mockProc.kill).toHaveBeenCalledTimes(1);
  });

  it("routes search, graph, and rag commands correctly", async () => {
    const graphRes = await semanticManager.graph();
    expect(graphRes.nodes).toEqual([]);

    const ragRes = await semanticManager.rag("something");
    expect(ragRes.context).toHaveLength(1);
    expect(ragRes.context[0].title).toBe("Test");
  });

  it("coalesces successive index commands via the debounced triggerIndex", async () => {
    const indexSpy = vi
      .spyOn(semanticManager, "index")
      .mockResolvedValue({ ok: true });

    semanticManager.triggerIndex("/vault/path/a");
    semanticManager.triggerIndex("/vault/path/b");
    semanticManager.triggerIndex("/vault/path/c");

    // Fast-forward time, but not enough to trigger the debounce
    vi.advanceTimersByTime(1000);
    expect(indexSpy).not.toHaveBeenCalled();

    // Fast-forward past the 1.5s debounce boundary
    vi.advanceTimersByTime(600);

    expect(indexSpy).toHaveBeenCalledTimes(1);
    expect(indexSpy).toHaveBeenCalledWith("/vault/path/c");
  });
});
