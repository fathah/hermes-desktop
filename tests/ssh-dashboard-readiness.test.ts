// @vitest-environment node
import type { SpawnOptions } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import http from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SshConfig } from "../src/main/ssh-tunnel";

const transport = vi.hoisted(() => ({ home: "", commands: [] as string[] }));
vi.mock("../src/main/locale", () => ({ getAppLocale: () => "en" }));
vi.mock("child_process", async (original) => {
  const actual = await original<typeof import("child_process")>();
  return {
    ...actual,
    spawn(
      command: string,
      args: string[],
      options: SpawnOptions,
    ): ReturnType<typeof actual.spawn> {
      if (command !== "ssh") return actual.spawn(command, args, options);
      const remoteCommand = args.at(-1)!;
      transport.commands.push(remoteCommand);
      // Execute the production SSH command/Python bytes locally. No SSH
      // credentials or remote host are used; stdin still carries its real JSON.
      return actual.spawn("/bin/sh", ["-c", remoteCommand], {
        ...options,
        env: {
          ...process.env,
          HOME: transport.home,
          HERMES_HOME: transport.home,
        },
      });
    },
  };
});

import { sshDashboardAuthenticated } from "../src/main/ssh-remote";

type Reply = {
  status: number;
  type?: string;
  body?: string;
  interrupted?: boolean;
} | null;
const itPosix = process.platform === "win32" ? it.skip : it;

describe("SSH dashboard admission before tunnel creation", () => {
  let server: http.Server;
  let port = 0;
  let sessions: Reply;
  let profiles: Reply;
  let config: SshConfig;
  const seen: Array<{ path: string; token: string }> = [];

  beforeEach(async () => {
    transport.home = mkdtempSync(join(tmpdir(), "hermes-ssh-readiness-"));
    const keyPath = join(transport.home, "unused-key");
    writeFileSync(keyPath, "disposable test fixture, never used by SSH");
    config = {
      host: "unused.test",
      username: "fixture",
      port: 22,
      keyPath,
      remotePort: 9119,
      localPort: 19119,
    };
    transport.commands.length = 0;
    seen.length = 0;
    sessions = { status: 503 };
    profiles = { status: 200 };
    server = http.createServer((req, res) => {
      const route = req.url || "/";
      const token = String(req.headers["x-hermes-session-token"] || "");
      seen.push({ path: route, token });
      const reply =
        route === "/api/sessions?limit=1"
          ? sessions
          : route === "/api/profiles" && token === "candidate-token"
            ? profiles
            : { status: 401 };
      if (!reply) {
        req.socket.destroy();
        return;
      }
      res.writeHead(reply.status, {
        "Content-Type": reply.type ?? "application/json",
        ...(reply.interrupted ? { "Content-Length": "1000" } : {}),
        ...(reply.status === 302 ? { Location: "/api/profiles" } : {}),
      });
      const body = reply.body ?? "{}";
      if (reply.interrupted) {
        res.flushHeaders();
        res.write(body);
        setImmediate(() => res.destroy());
      } else res.end(body);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string")
          throw new Error("Missing fixture port");
        port = address.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(transport.home, { recursive: true, force: true });
  });

  // @lat: [[scheduled-jobs#Test specifications#SSH early fresh-store admission]]
  itPosix.each([
    { status: 200, token: "candidate-token", accepted: true },
    { status: 503, token: "candidate-token", accepted: true },
    { status: 503, token: "invalid-token", accepted: false },
  ])(
    "executes the real early Python gate ($status, $token)",
    async ({ status, token, accepted }) => {
      sessions = { status };
      await expect(
        sshDashboardAuthenticated(config, port, token),
      ).resolves.toBe(accepted);
      expect(seen).toEqual([
        { path: "/api/sessions?limit=1", token },
        ...(status === 503 ? [{ path: "/api/profiles", token }] : []),
      ]);
      expect(transport.commands).toHaveLength(1);
      expect(transport.commands[0]).toContain("python3 -c");
      expect(transport.commands[0]).not.toContain(token);
    },
  );

  // @lat: [[scheduled-jobs#Test specifications#SSH early session refusals]]
  itPosix.each([
    { name: "unauthorized", reply: { status: 401 } },
    { name: "forbidden", reply: { status: 403 } },
    { name: "other server error", reply: { status: 500 } },
    { name: "redirect", reply: { status: 302 } },
    { name: "HTML503 header", reply: { status: 503, type: "text/html" } },
    {
      name: "HTML503 body",
      reply: { status: 503, body: "<html>Unavailable</html>" },
    },
    { name: "malformed JSON503", reply: { status: 503, body: "invalid" } },
    { name: "interrupted503", reply: { status: 503, interrupted: true } },
    { name: "network failure", reply: null },
  ])("does not reach profiles after $name", async ({ reply }) => {
    sessions = reply;
    await expect(
      sshDashboardAuthenticated(config, port, "candidate-token"),
    ).resolves.toBe(false);
    expect(seen.map(({ path }) => path)).toEqual(["/api/sessions?limit=1"]);
  });

  // @lat: [[scheduled-jobs#Test specifications#SSH early profile refusals]]
  itPosix.each([
    { name: "unauthorized", reply: { status: 401 } },
    { name: "forbidden", reply: { status: 403 } },
    { name: "other server error", reply: { status: 500 } },
    { name: "HTML200 header", reply: { status: 200, type: "text/html" } },
    { name: "HTML200 body", reply: { status: 200, body: "<html>SPA</html>" } },
    { name: "malformed JSON", reply: { status: 200, body: "invalid" } },
    { name: "empty body", reply: { status: 200, body: "" } },
    { name: "interrupted body", reply: { status: 200, interrupted: true } },
    { name: "network failure", reply: null },
  ])("rejects fallback profiles $name", async ({ reply }) => {
    profiles = reply;
    await expect(
      sshDashboardAuthenticated(config, port, "candidate-token"),
    ).resolves.toBe(false);
    expect(seen.map(({ path }) => path)).toEqual([
      "/api/sessions?limit=1",
      "/api/profiles",
    ]);
  });
});
