import { BrowserWindow, ipcMain } from "electron";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as net from "net";
import { randomBytes } from "crypto";

export interface AskpassHandle {
  env: Record<string, string>;
  pathPrepend: string;
  cleanup: () => void;
}

/**
 * Bridge sudo's password prompt to a GUI dialog.
 *
 * Writes two scripts into a temp dir:
 *   - askpass.sh: invoked by `sudo -A`. Talks to a unix socket we listen on,
 *     receives the password, prints it to stdout.
 *   - sudo: a PATH shim that forces real sudo to use `-A`, so install
 *     scripts that call plain `sudo` still trigger our askpass.
 *
 * Caller must invoke `cleanup()` when the install/update finishes.
 */
export async function setupAskpass(
  parent: BrowserWindow | null,
): Promise<AskpassHandle> {
  const dir = mkdtempSync(join(tmpdir(), "hermes-askpass-"));
  const sockPath = join(dir, "ipc.sock");
  const askpassPath = join(dir, "askpass.sh");
  const sudoShim = join(dir, "sudo");

  // The askpass program. sudo invokes this with a single arg (the prompt).
  // We pipe through python3 because it's available on every macOS/Linux box
  // that can run hermes-agent (which itself requires python).
  writeFileSync(
    askpassPath,
    `#!/bin/sh
exec /usr/bin/env python3 - "$@" <<'PY'
import socket, sys
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(${JSON.stringify(sockPath)})
prompt = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "Password:"
s.sendall((prompt + "\\n").encode())
buf = b""
while True:
    chunk = s.recv(4096)
    if not chunk: break
    buf += chunk
if not buf:
    sys.exit(1)
sys.stdout.buffer.write(buf)
PY
`,
  );
  chmodSync(askpassPath, 0o755);

  // PATH shim: any plain `sudo` call gets rewritten to `sudo -A`.
  // /usr/bin/sudo is the standard location on macOS and ~all Linux distros.
  writeFileSync(
    sudoShim,
    `#!/bin/sh
for p in /usr/bin/sudo /bin/sudo /usr/local/bin/sudo; do
  if [ -x "$p" ]; then exec "$p" -A "$@"; fi
done
echo "sudo not found" >&2
exit 1
`,
  );
  chmodSync(sudoShim, 0o755);

  const server = net.createServer((conn) => {
    let buf = "";
    conn.on("data", async (chunk) => {
      buf += chunk.toString();
      if (!buf.includes("\n")) return;
      const prompt = buf.split("\n")[0];
      const pw = await showPasswordDialog(parent, prompt);
      if (pw === null) {
        conn.end();
      } else {
        conn.end(pw + "\n");
      }
    });
    conn.on("error", () => {
      /* connection errors are non-fatal */
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(sockPath, () => {
      try {
        chmodSync(sockPath, 0o600);
      } catch {
        /* non-fatal */
      }
      resolve();
    });
  });

  return {
    env: { SUDO_ASKPASS: askpassPath },
    pathPrepend: dir,
    cleanup: () => {
      try {
        server.close();
      } catch {
        /* non-fatal */
      }
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* non-fatal */
      }
    },
  };
}

async function showPasswordDialog(
  parent: BrowserWindow | null,
  prompt: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = `askpass-result-${randomBytes(8).toString("hex")}`;

    // Build the HTML template before creating the window so we can inject
    // the channel name securely as a data attribute instead of exposing it
    // via require("electron") with nodeIntegration.
    const html = buildDialogHtml(prompt);

    // [SECURITY FIX] Use contextIsolation + sandbox instead of nodeIntegration.
    // The channel name is passed to the preload via the URL hash fragment,
    // so the renderer HTML never has direct access to it or to ipcRenderer.
    const win = new BrowserWindow({
      width: 460,
      height: 240,
      parent: parent ?? undefined,
      modal: !!parent,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: "Administrator Password Required",
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, "../preload/askpass-preload.js"),
      },
    });

    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      ipcMain.removeAllListeners(channel);
      try {
        if (!win.isDestroyed()) win.close();
      } catch {
        /* non-fatal */
      }
      resolve(value);
    };

    ipcMain.on(channel, (_e, value: string | null) => finish(value));
    win.on("closed", () => finish(null));

    // Pass channel via URL hash so the preload can read it safely
    win.loadURL(
      "data:text/html;charset=UTF-8;base64," +
        Buffer.from(html).toString("base64") +
        `#askpass-channel-${channel}`,
    );
  });
}

function buildDialogHtml(prompt: string): string {
  const safePrompt = prompt
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  // [SECURITY FIX] No longer inject require("electron") or the channel name
  // into the HTML. The preload script reads the channel from additionalData
  // and exposes a safe API via contextBridge.
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin:0; padding:0; height:100%; }
  body { font-family:-apple-system,system-ui,sans-serif; background:#1e1e1e; color:#eee; padding:20px; box-sizing:border-box; }
  .title { font-size:14px; font-weight:600; margin-bottom:6px; }
  .prompt { font-size:12px; line-height:1.5; margin-bottom:14px; color:#bbb; white-space:pre-wrap; word-break:break-word; }
  input { width:100%; padding:8px 10px; border-radius:6px; border:1px solid #444; background:#2a2a2a; color:#fff; font-size:14px; box-sizing:border-box; outline:none; }
  input:focus { border-color:#2563eb; }
  .row { display:flex; gap:8px; justify-content:flex-end; margin-top:18px; }
  button { padding:6px 14px; border-radius:6px; border:1px solid #444; background:#333; color:#fff; cursor:pointer; font-size:13px; font-family:inherit; }
  button.primary { background:#2563eb; border-color:#2563eb; }
  button:hover { opacity:0.9; }
</style></head>
<body>
<div class="title">The installer needs your password</div>
<div class="prompt">${safePrompt}</div>
<input id="pw" type="password" autofocus autocomplete="off" />
<div class="row">
  <button id="cancel">Cancel</button>
  <button id="ok" class="primary">OK</button>
</div>
<script>
  // [SECURITY FIX] Use contextBridge-exposed API instead of require("electron")
  const pw = document.getElementById("pw");
  const submit = (val) => window.askpassAPI.submit(val);
  document.getElementById("ok").onclick = () => submit(pw.value);
  document.getElementById("cancel").onclick = () => submit(null);
  pw.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit(pw.value);
    if (e.key === "Escape") submit(null);
  });
  pw.focus();
</script>
</body></html>`;
}
