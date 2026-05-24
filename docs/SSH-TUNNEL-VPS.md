# Connecting Hermes Desktop to a Remote Hermes VPS over SSH

This guide walks through configuring Hermes Desktop to use a Hermes Agent
running on a remote server (a VPS, a HyperV/KVM VM, a Raspberry Pi on your
LAN, etc.) so that **every screen — Chat, Sessions, Skills, Memory, Soul,
Tools, Schedules, Gateway, Profiles, Models, Logs — works as if Hermes
were installed locally**.

If you only need to chat against a remote Hermes and you don't care about
the management screens, the simpler **"Remote" mode** (HTTP URL + API key)
is enough. If you want full functionality parity, you need **"SSH Tunnel"
mode**, which is what this document covers.

## Why SSH Tunnel mode (not plain Remote mode)

The desktop app has two remote modes, and they cover very different
surface areas:

| Screen / feature                               |  Remote (HTTP + API key)   |    SSH Tunnel    |
| ---------------------------------------------- | :------------------------: | :--------------: |
| Chat (`/v1/chat/completions`)                  |             ✅             |        ✅        |
| Sessions list & search                         | ❌ reads local `~/.hermes` | ✅ via SSH proxy |
| Skills (browse, install, uninstall)            | ❌ reads local `~/.hermes` | ✅ via SSH proxy |
| Memory (view/edit entries, user profile)       | ❌ reads local `~/.hermes` | ✅ via SSH proxy |
| Soul (persona editor)                          | ❌ reads local `~/.hermes` | ✅ via SSH proxy |
| Tools (toolset enable/disable)                 | ❌ reads local `~/.hermes` | ✅ via SSH proxy |
| Schedules (cron jobs)                          | ❌ reads local `~/.hermes` | ✅ via SSH proxy |
| Gateway (status, start/stop, platform toggles) |       ❌ reads local       | ✅ via SSH proxy |
| Profile switching                              |       ❌ reads local       | ✅ via SSH proxy |
| Models (saved per-provider configs)            |       ❌ reads local       | ✅ via SSH proxy |
| Logs (gateway, agent)                          |       ❌ reads local       | ✅ via SSH proxy |

Plain Remote mode only proxies the chat path. **All other screens read
the local `~/.hermes` directory**, so if you have no Hermes install on the
desktop's host, those screens look empty even though your remote Hermes
has data. SSH Tunnel mode proxies every screen via `sshExec` against the
remote host's `~/.hermes`, which is what you almost certainly want.

## Prerequisites

On the **desktop machine** (where Hermes Desktop runs):

- An SSH key pair (e.g. `~/.ssh/id_ed25519` / `~/.ssh/id_ed25519.pub`).
  Generate one with `ssh-keygen -t ed25519` if you don't have it.
- The OpenSSH client on `PATH`. macOS and Linux have it by default;
  Windows 10/11 ship it as an optional feature ("OpenSSH Client").

On the **remote machine** (where Hermes Agent runs):

- OpenSSH server reachable from the desktop host (port 22 by default).
- A user account whose `~/.hermes` directory contains your Hermes data
  (more on this below).
- Your desktop's public key authorized for that user
  (`~/.ssh/authorized_keys`).
- The Hermes API listening on `127.0.0.1:8642` (the default — it does
  **not** need to be exposed publicly; the SSH tunnel forwards it).

## Which user account should the desktop SSH in as?

This is the most important decision and the most common source of "the
screens are empty" reports.

The desktop app's SSH proxy uses paths like `~/.hermes/...` (which
resolves to `$HOME/.hermes/` of the SSH user). It must log in as the
**same user that runs Hermes Agent** so that `~` points at the directory
containing your real data.

### Case A — You installed Hermes manually as your own user

If you ran the Hermes installer interactively as e.g. `andrea` and your
data lives in `/home/andrea/.hermes`, SSH in as `andrea`. Nothing extra
to do.

### Case B — Hermes runs as a dedicated service user (systemd)

This is common on production VPSes. Hermes is installed under
`/opt/hermes` (or similar) and runs via a systemd unit like:

```ini
[Service]
User=hermes
Group=hermes
Environment=HOME=/opt/hermes
ExecStart=/opt/hermes/hermes-agent/.venv/bin/hermes gateway
```

In this case the data lives at `/opt/hermes/.hermes/` and you need to
SSH in as the `hermes` user. Two things to set up:

1. **Make sure the `hermes` user has a real login shell.** Hardened
   installs sometimes set `/usr/sbin/nologin`. Switch it to bash:

   ```bash
   sudo chsh -s /bin/bash hermes
   ```

2. **Authorize your desktop's public key for the `hermes` user.** Run
   this from an account with sudo (e.g. your normal login user):

   ```bash
   PUBKEY="ssh-ed25519 AAAA... your-desktop-host"   # paste yours

   sudo install -d -o hermes -g hermes -m 700 /opt/hermes/.ssh
   sudo touch /opt/hermes/.ssh/authorized_keys
   sudo chown hermes:hermes /opt/hermes/.ssh/authorized_keys
   sudo chmod 600 /opt/hermes/.ssh/authorized_keys
   echo "$PUBKEY" | sudo tee -a /opt/hermes/.ssh/authorized_keys
   ```

   **Note:** systemd's `ProtectHome=read-only` on the Hermes service unit
   only restricts the Hermes process itself. Interactive SSH sessions
   into the `hermes` user are unaffected, so the desktop can still
   write skills, memory edits, soul updates, etc.

### Case C — Hermes runs as root

Don't. If it currently does, migrate it to a dedicated user before
exposing SSH to it.

## Step-by-step setup

### 1. Verify SSH works exactly as the desktop will call it

The desktop spawns `ssh` with these flags (see `src/main/ssh-tunnel.ts`):
`-N -L <localPort>:127.0.0.1:8642 -i <keyPath> -o BatchMode=yes
-o StrictHostKeyChecking=accept-new`. The critical one is
`BatchMode=yes` — **any password or passphrase prompt will fail closed
with no useful error message**. From your desktop, run:

```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    -i ~/.ssh/id_ed25519 -p 22 hermes@your.vps.example.com \
    'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8642/health'
```

You should see `200`. If you see `Permission denied (publickey)`, the
key isn't authorized for that user — double-check
`/opt/hermes/.ssh/authorized_keys` and its permissions (700 on the dir,
600 on the file, owned by the target user). If you see a passphrase
prompt, your key has a passphrase and SSH agent isn't loaded — either
remove the passphrase, or load it into the agent before launching the
desktop app.

### 2. Configure the desktop app

Open **Settings → Connection** and select **SSH Tunnel**. Fill in:

| Field              | Value                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| SSH Host           | hostname or IP of the remote (e.g. `your.vps.example.com`)                                          |
| SSH Port           | `22` (or your sshd port)                                                                            |
| Username           | the user whose `~/.hermes` is the real one (`hermes` in Case B)                                     |
| Private Key Path   | absolute path, e.g. `~/.ssh/id_ed25519` on macOS/Linux or `C:\Users\you\.ssh\id_ed25519` on Windows |
| Remote Hermes Port | `8642` (default)                                                                                    |

Click **Test SSH Connection**. Expected result: "SSH tunnel connected!".
Then **Save** and restart the app.

### 3. (Alternative) Edit `~/.hermes/desktop.json` directly

If you prefer to skip the UI, the same config is stored at
`~/.hermes/desktop.json` (the desktop app's _local_ config, on the
desktop machine — not on the VPS):

```json
{
  "connectionMode": "ssh",
  "remoteUrl": "http://your.vps.example.com:8642",
  "remoteApiKey": "",
  "sshConfig": {
    "host": "your.vps.example.com",
    "port": 22,
    "username": "hermes",
    "keyPath": "/Users/you/.ssh/id_ed25519",
    "remotePort": 8642,
    "localPort": 18642
  }
}
```

`remoteUrl` / `remoteApiKey` are retained so you can switch back to
plain Remote mode by changing only `connectionMode`.

## Verifying every screen works

After restart, walk through these screens — each should reflect data
from the _remote_ `~/.hermes`, not your local one:

- **Chat** — send a message. Tokens should stream.
- **Sessions** — should list past conversations from the VPS.
- **Skills** — should show installed skills from the VPS.
- **Memory** — should show memory entries from the VPS.
- **Soul** — should show your remote `SOUL.md`.
- **Tools** — should show toolset enable/disable state.
- **Profiles** — should list profiles defined on the VPS.
- **Schedules** — should show cron jobs from `~/.hermes/cron/jobs.json`.
- **Gateway** — should reflect the running gateway's state.

If any screen still looks empty, see Troubleshooting below.

## Troubleshooting

### "SSH tunnel is not active" or chat hangs

On **Linux/macOS** versions ≤ 0.4.3 there is a known
`ControlPersist` lifecycle bug — the SSH process exits immediately,
making the desktop think the tunnel died even though port-forwarding is
alive. See [#195][#195] and [#159][#159]. Upgrade to a build that
includes [PR #204][#204] or apply the fix from those issues.

### "Permission denied (publickey)" from the desktop, but my key works in the terminal

Most common causes:

- You use a different key from your terminal (via `~/.ssh/config` host
  alias or `ssh-agent`) than the path you configured in the desktop. The
  desktop only uses the explicit key file you give it (`BatchMode=yes`
  disables agent fallback negotiation in some configurations).
- The key has a passphrase and is unlocked only in the agent. Either
  remove the passphrase or ensure the agent is loaded before launching
  Hermes Desktop.

### Screens are empty even after switching to SSH Tunnel mode

You're almost certainly SSH'ing in as the wrong user — `~/.hermes`
resolves to that user's home, not where Hermes actually keeps its data.
Verify with:

```bash
ssh -i <key> <user>@<host> 'ls -la ~/.hermes && pwd'
```

The directory should contain `SOUL.md`, `config.yaml`, `auth.json`,
`memories/`, `profiles/`, etc. If you see `No such file or directory`,
you're in the wrong account — re-read the **"Which user account"**
section above.

### Settings → Hermes Agent shows blank Engine / Released / Python / OpenAI SDK

Production installs commonly ship `/usr/local/bin/hermes` as a
`sudo -u hermes …` wrapper, and the sudoers policy refuses to run the
wrapper as the `hermes` user itself ("Sorry, user hermes is not allowed
to execute …"). The result: `sshGetHermesVersion` returns empty and the
Settings card renders four blanks while everything else works.

Fixed in [PR #205][#205] by probing the venv binary directly. If your
build pre-dates that fix, you can verify locally with:

```bash
ssh <user>@<host> '/opt/hermes/hermes-agent/.venv/bin/hermes --version'
```

A working version string means the fix will populate the card once your
build includes #205.

### Kanban shows "Kanban requires a local Hermes install"

This screen is not yet wired for remote/SSH mode (the UI explicitly
says "Remote/SSH support is coming in a follow-up"). All other
management screens work in SSH tunnel mode; Kanban is the one
exception. Track upstream for the follow-up PR.

### Office (Claw3D) offers to install Claw3D locally

The Office screen detects Claw3D on the desktop host, not on the VPS.
If you're already running `hermes-office.service` on the VPS, that
service is independent of this screen — visit it directly at
`http://<vps>:3000`. Tighter integration is tracked in
[#196](https://github.com/fathah/hermes-desktop/issues/196).

### `Test SSH Connection` succeeds but chat fails with 401 or auth errors

Hermes API may require an API key locally even when bound to
`127.0.0.1`. Configure it in the desktop app's Settings → API key (or
leave blank if the gateway is configured for no-auth on localhost). The
key, if used, is the one stored in your remote Hermes `.env`/`auth.json`,
not a value you generate on the desktop.

### Windows-specific: keys not persisting across restarts

Tracked in [#182][#182]. If you hit this, store the desktop's API key
and SSH key path in a password manager and re-paste after a Windows
restart until the upstream fix lands.

## Security notes

- The SSH tunnel binds **only** to `127.0.0.1` on the desktop side. The
  remote Hermes port is **not** exposed to the public internet at any
  point in this flow.
- `BatchMode=yes` means a stolen desktop without an unlocked SSH key
  cannot impersonate you to the remote Hermes — there's no password to
  steal and no key-loading prompt to manipulate.
- `StrictHostKeyChecking=accept-new` trusts the host key on first
  connection and pins it in `~/.ssh/known_hosts` after that. If the
  remote host key ever changes (e.g. server reinstall), SSH will fail
  closed and you'll need to manually re-trust it. This is the desired
  behavior — don't change it.
- Authorize the desktop's pubkey only on the dedicated Hermes user, not
  on root. The Hermes user is already what runs the agent; giving it
  inbound SSH does not expand the blast radius.

[#159]: https://github.com/fathah/hermes-desktop/issues/159
[#182]: https://github.com/fathah/hermes-desktop/issues/182
[#195]: https://github.com/fathah/hermes-desktop/issues/195
[#204]: https://github.com/fathah/hermes-desktop/pull/204
[#205]: https://github.com/fathah/hermes-desktop/pull/205
