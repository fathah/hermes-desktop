# Running Hermes Office (Claw3D) alongside Hermes Agent in Docker

This guide describes how to deploy the **Office** module (`fathah/hermes-office`) in Docker
together with a Dockerized **Hermes Agent**, so that users connecting to the agent over the
network can also access the 3D visualization.

> **Important limitation:** the desktop app's Office tab currently spawns Office's
> `npm run dev` and `hermes-adapter` **locally** on the machine running the desktop app
> and does not point its in-app webview at a remote Office instance. Following this guide
> gives you Office in a browser at `http://<docker-host>:3000`, **not** inside the desktop
> app's Office tab. The Office tab in the desktop app shows a guidance screen when in
> remote mode and will not start the local Office stack.

This is a known gap. If/when the desktop app gains support for a configurable remote
Office URL, the same Docker deployment described here will work behind that URL field.

---

## Architecture

When everything runs locally:

```
[ Desktop app  (Electron renderer + webview) ]
        │ webview → http://localhost:3000
        ▼
[ hermes-office (Next.js dev server, port 3000) ]
        │ ws://localhost:18789
        ▼
[ hermes-adapter (Node WebSocket bridge, port 18789) ]
        │ in-process / IPC
        ▼
[ Hermes Agent (Python, API on 127.0.0.1:8642) ]
```

When deploying to Docker, you reproduce the **bottom three boxes** as containers and
expose the Office UI on port 3000:

```
[ Browser at http://<docker-host>:3000 ]
        │ webview / page load
        ▼
┌─────────────────────────────────────────────┐
│  Docker network "hermes-net"                │
│                                             │
│  hermes-office  ◀──── ws ────  hermes-agent │
│   (port 3000,                  (port 8642)  │
│    port 18789)                              │
└─────────────────────────────────────────────┘
        ▲
        │ port-forwards
        ▼
[ Docker host: 192.168.1.177 ]
   ports 3000, 8642 published
```

The desktop app on a different machine can be configured (Settings → Connection → Remote)
to use the Hermes Agent at `http://192.168.1.177:8642`. **Chat works** through that path.
The Office tab will show the guidance screen instead of trying to start a local stack.
For the 3D UI, the user opens `http://192.168.1.177:3000` in any browser.

---

## Prerequisites

- Docker Engine 24+ and Docker Compose v2 installed on the host
- The host's IP reachable from the desktop machine (e.g., `192.168.1.177`)
- A copy of the upstream `hermes-office` repo (`https://github.com/fathah/hermes-office`)
  that you can build into an image (or a pre-built image, if available)
- Optionally: an API key to enable Hermes Agent authentication (see `docs/issues/2026-04-30-runtime-connection-issues.md`
  Issue 1, section 1.5, for the rationale)

---

## docker-compose.yml

This is a minimal example. **Adapt to your environment** — image names, environment
variable names for the Hermes Agent API key, and the exact `hermes-adapter` start command
depend on the upstream repos at the time you read this. Verify each `command:` and `image:`
against current upstream documentation before deploying.

```yaml
# docker-compose.yml
name: hermes-stack

networks:
  hermes-net:
    driver: bridge

services:
  hermes-agent:
    # Replace with the image you build from NousResearch/hermes-agent
    # or a pre-built image if upstream publishes one.
    image: hermes-agent:latest
    container_name: hermes-agent
    restart: unless-stopped
    networks: [hermes-net]
    ports:
      - "8642:8642"   # publish to LAN; remove if only Docker-internal
    volumes:
      - hermes-data:/root/.hermes
    environment:
      # The Hermes Agent's api_server config must bind to 0.0.0.0
      # for the Docker port-forward to reach it. Mount a config.yaml
      # or set the corresponding env var (name varies by upstream).
      HERMES_API_HOST: "0.0.0.0"
      # Optional API auth (recommended for LAN-exposed deployments).
      # The exact env var name depends on upstream Hermes Agent —
      # check the upstream docs.
      HERMES_API_KEY: "${HERMES_API_KEY:-}"

  hermes-office:
    # Build directly from upstream:
    build: https://github.com/fathah/hermes-office.git
    # Or, if you've cloned and want to develop locally:
    # build: ./hermes-office
    container_name: hermes-office
    restart: unless-stopped
    networks: [hermes-net]
    ports:
      - "3000:3000"     # Next.js dev server (the 3D UI)
      - "18789:18789"   # hermes-adapter WebSocket
    environment:
      # The dev server needs to listen on 0.0.0.0 inside the container
      # for the Docker port-forward to work. The Next.js convention is HOST.
      HOST: "0.0.0.0"
      PORT: "3000"
      # Tell the adapter where to find the Hermes Agent. The exact env var
      # depends on hermes-office's adapter implementation — check
      # https://github.com/fathah/hermes-office/blob/main/.env.example
      # or the adapter source for the canonical name.
      HERMES_AGENT_URL: "http://hermes-agent:8642"
      HERMES_API_KEY: "${HERMES_API_KEY:-}"
      HERMES_ADAPTER_PORT: "18789"
      HERMES_MODEL: "hermes"
      HERMES_AGENT_NAME: "Hermes"
    depends_on:
      hermes-agent:
        condition: service_started

volumes:
  hermes-data:
```

### Environment file

Save your API key in a sibling `.env` file (do **not** commit it to git):

```bash
# .env
HERMES_API_KEY=<your-32-byte-hex-secret>
```

Generate a strong key:

```bash
openssl rand -hex 32 > .env
sed -i '1s/^/HERMES_API_KEY=/' .env
chmod 600 .env
```

### Bring it up

```bash
# from the directory with docker-compose.yml
docker compose pull          # if using prebuilt images
docker compose build         # if using build: directives
docker compose up -d
docker compose logs -f       # tail logs to verify both services come up
```

### Verify

From any machine on the same LAN:

```bash
# Hermes Agent API
curl -v http://192.168.1.177:8642/health
# Expected: HTTP/1.1 200 OK with { "status": "ok" } (or similar)

# Office 3D UI
curl -I http://192.168.1.177:3000/
# Expected: HTTP/1.1 200 OK with Content-Type: text/html
```

If either fails, check Issue 1 verification protocol in
`docs/issues/2026-04-30-runtime-connection-issues.md`.

### Open the 3D UI

In a browser on any LAN machine (including the one running the desktop app):

```
http://192.168.1.177:3000
```

You should see the Claw3D office. The first load takes a few seconds while Next.js
compiles. Subsequent reloads are fast.

### Configure the desktop app

In the desktop app:

1. Settings → Connection → Remote
2. URL: `http://192.168.1.177:8642`
3. API Key: the same value you put in `.env` (if you set one)
4. Click "Test connection". Should report **Connected successfully!**.

The desktop app's chat now goes through the remote Hermes Agent. The Office tab shows the
guidance screen pointing at this guide.

---

## Caveats

- **`hermes-office` adapter remote-agent support is unverified at the time of writing.**
  Setting `HERMES_AGENT_URL` in the `hermes-office` container's env is what *should*
  work if the upstream adapter has been refactored to talk over HTTP. If it still
  expects a co-located process, the Office UI will load but be unable to drive
  agents. In that case the path forward is upstream-side work: either modify
  `hermes-adapter` to accept a remote URL or contribute that change.
- **No TLS in this example.** For LAN-only deployments this is acceptable; for anything
  exposed to the internet, terminate TLS with a reverse proxy (Caddy, Traefik, nginx) in
  front of both ports.
- **API key is shared between agent and office.** Make sure both services see the same
  value. If they diverge, the office adapter cannot authenticate to the agent.
- **The desktop app's webview points at `localhost:3000`, not at the remote.** Until the
  desktop app gains a configurable remote-Office URL, opening Office "inside" the
  Electron window in remote mode is not supported. Use a regular browser.
- **Auto-update only works for `.AppImage` builds.** Users on `.rpm`/`.deb` will need to
  manually download new releases. Unrelated to Docker, mentioned in the README.

---

## Future work

To make the Office tab inside the desktop app work in remote mode, two changes would be
needed:

1. **Desktop app**: a "Remote Office URL" field in Settings or in the Office tab itself,
   pointing to `http://<docker-host>:3000`. The webview would load that URL instead of
   `http://localhost:<port>` when in remote mode and the URL is set.
2. **Upstream `hermes-office`**: confirmation that `hermes-adapter` supports
   `HERMES_AGENT_URL` (or equivalent) for remote agents, so the in-Docker adapter can
   reach the in-Docker Hermes Agent over HTTP rather than IPC/in-process.

Both changes are independent of this guide and would be tracked as separate PRs.

---

## Related documents

- `docs/issues/2026-04-30-runtime-connection-issues.md` — analysis of the underlying
  remote-mode and Office connectivity issues.
- `docs/superpowers/specs/2026-04-30-windows-winget-fedora-rpm-release-design.md` —
  release pipeline (the `.rpm`/`.exe` builds the desktop app uses).
