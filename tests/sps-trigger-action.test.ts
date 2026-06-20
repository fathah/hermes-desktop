// C1 regression: sps-trigger-action {type:"shell"} previously called
// node:child_process `exec(action.command, {shell implicitly true})` with no
// allowlist and no metacharacter rejection. Any renderer escape (e.g. the C3
// RSS stored-XSS) became arbitrary command execution. This test pins the new
// contract: only allowlisted read-only binaries run, via execFile (no shell),
// and every shell-metacharacter / mutating case is rejected.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process so we never spawn anything real; capture the args.
// `node:child_process` and `child_process` resolve to the same module, so we
// mock the bare specifier to cover both import styles.
const { execFileMock, fetchMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(
    (
      cmd: string,
      args: string[],
      opts: unknown,
      cb: (e: Error | null, out: Buffer, err: Buffer) => void,
    ) => {
      cb(null, Buffer.from(`${cmd} ${args.join(" ")}`), Buffer.from(""));
    },
  ),
  fetchMock: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: execFileMock,
  default: { execFile: execFileMock },
}));

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: fetchMock,
  };
});

import { runApiAction, runShellAction } from "../src/main/sps-action-runner";

function response(
  body: string,
  status = 200,
): {
  status: number;
  body: ReadableStream<Uint8Array>;
} {
  return {
    status,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
  };
}

describe("runShellAction (C1 shell allowlist + no-shell execFile)", () => {
  beforeEach(() => {
    execFileMock.mockClear();
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        cb: (e: Error | null, out: Buffer, err: Buffer) => void,
      ) => {
        cb(null, Buffer.from(`${cmd} ${args.join(" ")}`), Buffer.from(""));
      },
    );
  });

  it("rejects empty / whitespace-only commands", async () => {
    for (const cmd of ["", "   ", "\t\n"]) {
      const res = await runShellAction(cmd, "/vault");
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/empty/i);
    }
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("rejects shell metacharacters (chaining / redirection / substitution)", async () => {
    const malicious = [
      "ls; rm -rf /",
      "cat x | sh",
      "ls && whoami",
      "echo `whoami`",
      "echo $(whoami)",
      "ls > /etc/passwd",
      "ls >> ~/.bashrc",
      "grep foo || cat /etc/shadow",
      "echo ${IFS}",
      "ls\nrm -rf /",
      "echo *",
    ];
    for (const cmd of malicious) {
      const res = await runShellAction(cmd, "/vault");
      expect(res.success, `should reject: ${cmd}`).toBe(false);
      expect(res.error).toMatch(/not allowed|unsafe|metachar/i);
    }
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("rejects binaries not on the safe allowlist", async () => {
    for (const cmd of [
      "rm -rf /",
      "curl http://evil.com",
      "nc -l 4444",
      "chmod 777 .",
      "bash -c 'rm -rf /'",
      'node -e \'require("fs").unlinkSync("/")\'',
    ]) {
      const res = await runShellAction(cmd, "/vault");
      expect(res.success, `should reject: ${cmd}`).toBe(false);
      expect(res.error).toMatch(/not allowed|unsafe|binary/i);
    }
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("rejects mutating git subcommands even though git is allowlisted", async () => {
    for (const cmd of [
      "git push",
      "git commit -m x",
      "git merge evil",
      "git checkout -- .",
      "git reset --hard",
    ]) {
      const res = await runShellAction(cmd, "/vault");
      expect(res.success, `should reject: ${cmd}`).toBe(false);
    }
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("runs allowlisted read-only commands via execFile with shell:false", async () => {
    const res = await runShellAction("ls -la", "/vault");
    expect(res.success).toBe(true);
    expect(res.output).toContain("ls -la");
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = execFileMock.mock.calls[0];
    expect(cmd).toBe("ls"); // argv[0] is the bare binary, not a shell
    expect(args).toEqual(["-la"]);
    expect(opts).toMatchObject({ shell: false, cwd: "/vault" });
  });

  it("passes through execFile errors as a failure result (never throws)", async () => {
    execFileMock.mockImplementationOnce((_c, _a, _o, cb) => {
      cb(new Error("boom") as Error, Buffer.from(""), Buffer.from("oops"));
    });
    const res = await runShellAction("ls", "/vault");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/boom|oops/);
  });
});

describe("runApiAction (C2 guarded API action)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(response("ok"));
  });

  it("rejects empty, invalid, and non-http URLs before fetching", async () => {
    for (const url of ["", "not a url", "file:///etc/passwd"]) {
      const res = await runApiAction(url);
      expect(res.success, `should reject ${url}`).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects sensitive or malformed attacker-controlled headers", async () => {
    for (const headers of [
      '{"Authorization":"Bearer secret"}',
      '{"Cookie":"a=b"}',
      '{"Host":"metadata.google.internal"}',
      '{"X-Test":"line\\nbreak"}',
      "[]",
      "{not json",
    ]) {
      const res = await runApiAction("https://example.com", headers);
      expect(res.success, `should reject ${headers}`).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the guarded dispatcher for http(s) GET requests", async () => {
    const res = await runApiAction(
      "https://example.com/status",
      '{"Accept":"application/json"}',
    );
    expect(res).toEqual({ success: true, output: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.com/status");
    expect(init).toMatchObject({
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    expect(init.dispatcher).toBeTruthy();
  });

  it("returns status failures without throwing", async () => {
    fetchMock.mockResolvedValueOnce(response("nope", 500));
    const res = await runApiAction("https://example.com/status");
    expect(res.success).toBe(false);
    expect(res.output).toBe("nope");
    expect(res.error).toMatch(/500/);
  });
});
