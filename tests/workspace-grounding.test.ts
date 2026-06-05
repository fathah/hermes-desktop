import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── Mock project dependencies so importing hermes.ts is side-effect free ──
// (mirrors tests/buildUserContent.test.ts). The note-index is mocked so this
// runs under vitest without opening the better-sqlite3 native index.

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: join(tmpdir(), `hermes-grounding-${Date.now()}`),
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_REPO: "/dev/null",
  hermesCliArgs: () => ["/dev/null"],
  getEnhancedPath: () => process.env.PATH || "",
}));

vi.mock("../src/main/config", () => ({
  getModelConfig: () => ({ model: "test-model", provider: "openrouter" }),
  readEnv: () => ({}),
  getConnectionConfig: () => ({
    mode: "local" as const,
    remoteUrl: "",
    apiKey: "",
    ssh: {
      host: "",
      port: 22,
      username: "",
      keyPath: "",
      remotePort: 8642,
      localPort: 18642,
    },
  }),
}));

vi.mock("../src/main/ssh-tunnel", () => ({
  getSshTunnelUrl: () => null,
  isSshTunnelActive: () => false,
  isSshTunnelHealthy: () => Promise.resolve(false),
  startSshTunnel: () => Promise.resolve(),
}));

vi.mock("../src/main/utils", () => ({ stripAnsi: (s: string) => s }));
vi.mock("../src/main/models", () => ({ readModels: () => [] }));
vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

const search = vi.fn();
const status = vi.fn();
vi.mock("../src/main/note-index", () => ({
  getSpsNoteIndex: () => Promise.resolve({ search, status }),
}));

import {
  formatRetrievalSystemMessage,
  buildRetrievalSystemMessage,
  type GroundingSource,
} from "../src/main/hermes";

describe("formatRetrievalSystemMessage (pure)", () => {
  it("returns null when there are no sources (skip-injection contract)", () => {
    expect(formatRetrievalSystemMessage([])).toBeNull();
  });

  it("emits a system message citing title, rel path, and absolute path", () => {
    const sources: GroundingSource[] = [
      {
        title: "Handbook",
        relPath: "sources/handbook.md",
        absPath: "/vault/sources/handbook.md",
        excerpt: "Rest periods are 20 minutes.",
      },
    ];
    const msg = formatRetrievalSystemMessage(sources);
    expect(msg?.role).toBe("system");
    expect(msg?.content).toContain("Handbook · sources/handbook.md");
    expect(msg?.content).toContain("/vault/sources/handbook.md");
    expect(msg?.content).toContain("Rest periods are 20 minutes.");
  });
});

describe("buildRetrievalSystemMessage (IO)", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "grounding-vault-"));
    writeFileSync(
      join(root, "handbook.md"),
      '---\ntitle: "Handbook"\n---\n\nRest periods are 20 minutes per shift.',
      "utf-8",
    );
    status.mockReturnValue({ root, notes: 1, links: 0, indexedAt: 1 });
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("returns null when the index has no hits", async () => {
    search.mockReturnValueOnce([]);
    expect(await buildRetrievalSystemMessage("anything")).toBeNull();
  });

  it("grounds on a hit, stripping frontmatter from the excerpt", async () => {
    search.mockReturnValueOnce([
      { path: "handbook.md", title: "Handbook", snippet: "…" },
    ]);
    const msg = await buildRetrievalSystemMessage("rest period");
    expect(msg?.role).toBe("system");
    expect(msg?.content).toContain("Handbook · handbook.md");
    expect(msg?.content).toContain(join(root, "handbook.md"));
    expect(msg?.content).toContain("Rest periods are 20 minutes per shift.");
    // Frontmatter must be stripped from the inlined excerpt.
    expect(msg?.content).not.toContain('title: "Handbook"');
  });

  it("skips an unreadable hit without throwing", async () => {
    search.mockReturnValueOnce([
      { path: "missing.md", title: "Missing", snippet: "…" },
    ]);
    // Only hit is unreadable ⇒ no sources ⇒ null.
    expect(await buildRetrievalSystemMessage("x")).toBeNull();
  });
});
