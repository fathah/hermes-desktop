// @vitest-environment node
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

const execFile = vi.hoisted(() => vi.fn());
const runtime = vi.hoisted(() => ({
  home: "managed-home",
  python: "managed-python.exe",
  prefix: ["-I", "-c", "managed bootstrap with 'quoted' paths"],
}));
vi.mock("child_process", () => ({ execFile }));
vi.mock("../src/main/installer", () => ({
  HERMES_HOME: runtime.home,
  HERMES_PYTHON: runtime.python,
  hermesCliArgs: () => [...runtime.prefix],
  getEnhancedPath: () => "fixture-path",
}));
vi.mock("../src/main/hermes", () => ({ isRemoteOnlyMode: () => false }));
vi.mock("../src/main/config", () => ({
  getConnectionConfig: () => ({ mode: "local" }),
}));
vi.mock("../src/main/ssh-remote", () => ({
  sshRunKanban: vi.fn(),
  sshListClaw3dHqTasks: vi.fn(),
}));
vi.mock("../src/main/remote-kanban", () => ({}));

import { listBoards } from "../src/main/kanban";

describe("local Kanban managed runtime", () => {
  // @lat: [[kanban#Local CLI capture stays hidden]]
  it("captures named-profile board JSON without opening a Windows console", async () => {
    const boards = [{ slug: "research", name: "Research", is_current: true }];
    execFile.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      callback(null, JSON.stringify(boards), "");
    });

    await expect(listBoards(false, "research")).resolves.toEqual({
      success: true,
      data: boards,
    });
    const [executable, args, options, callback] = execFile.mock.calls[0];
    expect(executable).toBe(runtime.python);
    expect(args).toEqual([
      ...runtime.prefix,
      "-p",
      "research",
      "kanban",
      "boards",
      "list",
      "--json",
    ]);
    expect(options.windowsHide).toBe(true);
    expect(options.cwd).toBe(join(runtime.home, "hermes-agent"));
    expect(options.env.PATH).toBe("fixture-path");
    expect(typeof callback).toBe("function");
  });
});
