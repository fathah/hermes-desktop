// @vitest-environment node
import { readFileSync } from "fs";
import { join } from "path";
import { runInNewContext } from "vm";
import ts from "typescript";
import { beforeEach, expect, it, vi } from "vitest";

// Execute the actual private routing function and IPC registrations, isolating
// unrelated Electron startup/installer side effects rather than copying branches.
const source = ts.createSourceFile(
  "register.ts",
  readFileSync(join(__dirname, "../src/main/ipc/register.ts"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const snippets: string[] = [];
function collect(node: ts.Node): void {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name?.text === "withSshDashboardSessions"
  )
    snippets.push(node.getText(source));
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(source) === "ipcMain.handle" &&
    ts.isStringLiteral(node.arguments[0]) &&
    ["delete-session", "delete-sessions"].includes(node.arguments[0].text)
  )
    snippets.push(node.getText(source) + ";");
  ts.forEachChild(node, collect);
}
collect(source);
const code = ts.transpileModule(snippets.join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const handlers = new Map<string, (...args: unknown[]) => unknown>();
const sshDeleteSession = vi.fn();
const sshDeleteSessions = vi.fn();
const dashboard = vi.fn();
const remoteDeleteSession = vi.fn();
const remoteDeleteSessions = vi.fn();
let transport = "legacy";
const connection = {
  mode: "ssh",
  ssh: { host: "remote.example" },
  get sshChatTransport(): string {
    return transport;
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  transport = "legacy";
  handlers.clear();
  sshDeleteSessions.mockResolvedValue({ requested: 2, deleted: 2 });
  dashboard.mockResolvedValue({ baseUrl: "http://dashboard" });
  runInNewContext(code, {
    ipcMain: {
      handle: (name: string, fn: (...args: unknown[]) => unknown) =>
        handlers.set(name, fn),
    },
    sessionConnection: (id: string) => {
      expect(id).toBe("saved-remote");
      return connection;
    },
    activeSshProfile: (profile: string) => profile,
    getSshDashboardSessionConfig: dashboard,
    scopedRemoteSessionConfig: vi.fn(),
    sshDeleteSession,
    sshDeleteSessions,
    remoteDeleteSession,
    remoteDeleteSessions,
    deleteSession: vi.fn(),
    deleteSessions: vi.fn(),
  });
});

// @lat: [[ssh-session-delete#Legacy routing]]
it("deletes a session over native SSH when dashboard transport is disabled", async () => {
  await expect(
    Promise.resolve(
      handlers.get("delete-session")!(
        null,
        "selected",
        "saved-remote",
        "research",
      ),
    ),
  ).resolves.toBeUndefined();
  expect(sshDeleteSession).toHaveBeenCalledWith(
    connection.ssh,
    "selected",
    "research",
  );
  expect(dashboard).not.toHaveBeenCalled();
});

// @lat: [[ssh-session-delete#Batch fallback routing]]
it("uses the same scoped SSH fallback for batch deletion in auto mode", async () => {
  transport = "auto";
  dashboard.mockRejectedValue(new Error("No dashboard"));
  await expect(
    Promise.resolve(
      handlers.get("delete-sessions")!(
        null,
        ["a", "b"],
        "saved-remote",
        "research",
      ),
    ),
  ).resolves.toEqual({ requested: 2, deleted: 2 });
  expect(sshDeleteSessions).toHaveBeenCalledWith(
    connection.ssh,
    ["a", "b"],
    "research",
  );
});

// @lat: [[ssh-session-delete#Explicit dashboard mode]]
it("preserves explicit dashboard errors without silently using another transport", async () => {
  transport = "dashboard";
  dashboard.mockRejectedValue(new Error("No dashboard"));
  await expect(
    Promise.resolve(
      handlers.get("delete-session")!(null, "a", "saved-remote", "research"),
    ),
  ).rejects.toThrow("No dashboard");
  expect(sshDeleteSession).not.toHaveBeenCalled();
});
