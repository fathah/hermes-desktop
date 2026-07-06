# Remote Access Lab

This lab creates a disposable remote Hermes target for the sandboxed Hermes One instance without
touching the normal Hermes One worktree, config, or database.

## Shape

- Lab state lives in `.sandbox/remote-lab/hermes-home`.
- Containers are named `hermes-two-remote-lab-*`.
- The desktop connects to one URL: `http://127.0.0.1:19080`.
- A small nginx proxy routes:
  - `/api/*` and `/api/ws` to the Hermes dashboard service in the agent container.
  - `/v1/*` to the OpenAI-compatible API server in the same agent container.
- One disposable token is used for both:
  - `X-Hermes-Session-Token` dashboard auth.
  - `Authorization: Bearer ...` legacy API auth.
- The Hermes Agent image is built from the bundled checkout at
  `.sandbox/hermes-home/hermes-agent` into `hermes-two-remote-lab-agent:local`,
  because the public `nousresearch/hermes-agent:latest` image can lag the
  bundled dashboard auth contract.
- The lab copies working model configuration, then strips messaging/webhook
  platform credentials and opts out of bundled skill sync to avoid side effects.
- For regression testing only, the lab exports `COMFYUI_HOST` as
  `http://host.docker.internal:49000` so Remote HTTP and SSH-dashboard tests can
  use this Windows machine's AI Playground ComfyUI. Normal remote deployments
  should not rely on access to connecting-host resources.
- Remote-generated images should be copied into `/opt/data/images` and surfaced
  as `MEDIA:/opt/data/images/<file>.png` when possible. That path is under the
  Hermes home media roots exposed by the upstream dashboard `/api/media`
  endpoint.
- If the copied config has an `OPENROUTER_API_KEY`, the lab pins
  `auxiliary.vision` to OpenRouter with `google/gemini-3-flash-preview`. This
  keeps `vision_analyze` on a vision-capable auxiliary model even when the
  active chat model is a text-only custom provider such as DeepSeek.

## Commands

Run from the separate development worktree:

```powershell
cd C:\Users\pmos6\Documents\Claude\Projects\Hermes-Desktop-reconcile

powershell -NoProfile -ExecutionPolicy Bypass -File scripts\remote-lab.ps1 init
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\remote-lab.ps1 up
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\remote-lab.ps1 status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\remote-lab.ps1 configure-desktop
```

Stop the lab:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\remote-lab.ps1 down
```

Remove all lab state:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\remote-lab.ps1 clean
```

## Expected Probes

`status` should show three OK checks:

- `dashboard status`
- `dashboard sessions auth`
- `legacy OpenAI models auth`

If Docker Desktop returns pipe/API 500 errors or hangs on `docker ps`, restart
Docker Desktop or run:

```powershell
wsl --shutdown
```

Then reopen Docker Desktop and retry `scripts\remote-lab.ps1 up`.

The first `up` may take several minutes because Docker builds the local Hermes
Agent image. Later starts reuse the image cache.

## Hermes One Sandbox Settings

After `configure-desktop`, the sandboxed Hermes One instance is set to:

- Connection mode: Remote
- Remote URL: `http://127.0.0.1:19080`
- Chat transport: Auto

That is the intended regression-test mode: dashboard first, legacy fallback
available through the same remote URL.
