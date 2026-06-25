import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { buildSshControlOptions } from "../ssh-options";
import type { SshConfig } from "../ssh-tunnel";
import { HIDDEN_SUBPROCESS_OPTIONS } from "../process-options";

// ── SSH exec core ────────────────────────────────────────────────────────────

function buildExecArgs(config: SshConfig): string[] {
  const keyPath = config.keyPath?.trim() || join(homedir(), ".ssh", "id_rsa");
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=15",
    ...buildSshControlOptions(),
    "-i",
    keyPath,
    "-p",
    String(config.port || 22),
    `${config.username}@${config.host}`,
  ];
}

export function sshExec(
  config: SshConfig,
  command: string,
  stdin?: string,
  timeoutMs = 30000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [...buildExecArgs(config), command], {
      stdio: ["pipe", "pipe", "pipe"],
      ...HIDDEN_SUBPROCESS_OPTIONS,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("SSH command timed out"));
    }, timeoutMs);
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(sanitizeSshError(stderr) || "SSH command failed"));
    });
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

export function sshPython(
  config: SshConfig,
  script: string,
  stdin?: string,
  timeoutMs = 30000,
): Promise<string> {
  if (stdin === undefined) {
    return sshExec(config, "python3 -", script, timeoutMs);
  }
  return sshExec(config, `python3 -c ${shellQuote(script)}`, stdin, timeoutMs);
}

function sanitizeSshError(stderr: string): string {
  const cleaned = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^Warning: Permanently added /.test(line))
    .filter((line) => !/identity file .* not accessible/i.test(line))
    .join("\n")
    .trim();
  if (
    /Permission denied \(publickey\)|no such identity|could not open a connection|publickey/i.test(
      cleaned,
    )
  ) {
    return "SSH authentication failed. Configure an SSH key for this host and try again.";
  }
  if (
    /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(
      cleaned,
    )
  ) {
    return "SSH host key verification failed. Check the host key before reconnecting.";
  }
  return cleaned;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export function normalizeRemotePath(remotePath: string): string {
  return remotePath.replace(/^~\//, "$HOME/");
}

export function pythonJsonInput(payload: unknown): string {
  return JSON.stringify(payload);
}

export async function sshReadFile(
  config: SshConfig,
  remotePath: string,
): Promise<string> {
  try {
    return await sshExec(
      config,
      `bash -c 'case "$1" in "~/"*) p="$HOME/\${1#~/}" ;; "\\$HOME/"*) p="$HOME/\${1#\\$HOME/}" ;; *) p="$1" ;; esac; cat -- "$p" 2>/dev/null || true' -- ${shellQuote(normalizeRemotePath(remotePath))}`,
    );
  } catch {
    return "";
  }
}

export async function sshWriteFile(
  config: SshConfig,
  remotePath: string,
  content: string,
): Promise<void> {
  const p = normalizeRemotePath(remotePath);
  const dir = p.includes("/") ? p.substring(0, p.lastIndexOf("/")) : ".";
  await sshExec(
    config,
    `bash -c 'expand(){ case "$1" in "~/"*) printf "%s" "$HOME/\${1#~/}" ;; "\\$HOME/"*) printf "%s" "$HOME/\${1#\\$HOME/}" ;; *) printf "%s" "$1" ;; esac; }; dir=$(expand "$1"); file=$(expand "$2"); mkdir -p -- "$dir" && cat > "$file"' -- ${shellQuote(dir)} ${shellQuote(p)}`,
    content,
  );
}
