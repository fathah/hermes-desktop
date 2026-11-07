# Hy gateway

Kotoba's local Hermes API server, written in Hy (`gateway-hy/`). It replaces upstream `hermes gateway` as the process the desktop spawns per profile, while staying wire-compatible with the Hermes Agent API.

The desktop's main process already speaks the Hermes API for remote and gateway-only setups (`sendMessageViaRuns` → `sendMessageViaApi`). The Hy gateway implements exactly that surface, so the desktop needs no new protocol: it spawns a different process on the same port and keeps talking HTTP.

## Hermes API surface

The routes mirror upstream `gateway/platforms/api_server.py`, with the same JSON and SSE shapes, and are also served under `/p/<profile>/`.

- `GET /health` (unauthenticated), `/health/detailed`, `/api/status`
- `GET /v1/capabilities`, `/v1/models`
- `POST /v1/chat/completions`: OpenAI chunks, `event: hermes.tool.progress` frames, `X-Hermes-Session-Id`
- `POST /v1/runs` → `202 {run_id}`; `GET /v1/runs/{id}`; `GET /v1/runs/{id}/events`; `POST /v1/runs/{id}/stop`

Run events keep upstream names and key order (`event`, `run_id`, `timestamp`, …): `message.delta`, `reasoning.available`, `tool.started`, `tool.completed`, `approval.request`, `run.completed|failed|cancelled`. Bearer auth uses `API_SERVER_KEY` from the environment or `HERMES_HOME/.env`; a non-loopback bind without a key is refused (exit 78), as upstream does.

## Hermes Agent backend

Each turn builds a Hermes Agent `AIAgent` in-process with upstream's own runtime helpers, so sessions persist to the profile's `state.db` exactly as upstream API turns do.

The helpers are `_resolve_runtime_agent_kwargs`, `_get_platform_tools(..., "api_server")`, and the fallback and reasoning config loaders.

The gateway runs under the Hermes venv's python (`HERMES_PYTHON`) with `cwd=HERMES_REPO`. Its only extra dependency is Hy, vendored into `gateway-hy/.deps` by `npm run gateway:deps`; nothing is installed into the Hermes venv. Tool approvals register a gateway notify that surfaces `approval.request`. A client disconnecting from the event stream interrupts the agent.

An `echo` backend (`--backend echo`) needs no Hermes install and backs the contract tests.

## Desktop integration

[[src/main/kotoba-gateway.ts#gatewayRuntime]] selects the runtime: `hy` by default, or `hermes` via `KOTOBA_GATEWAY_RUNTIME=hermes` for upstream messaging platforms.

In `hy` mode, `startGatewayDetailed` spawns [[src/main/kotoba-gateway.ts#kotobaGatewayArgs]] (launcher, `--port`, `--pid-file`) with `HERMES_HOME` set to the profile home. The pid file is `kotoba-gateway.pid`, never `gateway.pid`, so a user's running upstream gateway or multiplexer ([[gateway-multiplex]]) is not mistaken for it, and multiplexer checks are skipped. Restart is stop, then start, then poll `/health`.

The main window gets `--kotoba-gateway-runtime=<runtime>` as an extra argument, and preload exposes it as `window.electron.kotobaGatewayRuntime`. In local mode with the `auto` transport, [[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#localChatTransportPreference]] picks the `/v1` transport, so chat reaches the Hy gateway rather than the upstream dashboard WebSocket. Picking `dashboard` explicitly still works.

Packaged builds ship `gateway-hy/` (with `.deps`) as `extraResources`. The `prebuild` npm hook vendors the pinned Hy into `.deps` with whatever Python the build machine has (Hy is pure Python), so the release workflows need no change.

## Python ↔ Hy mapping

How the Hy sources relate to Python in both directions: the names Python callers see, the generated Python view, and the upstream Hermes Python each piece mirrors.

Hy compiles to Python AST, so the gateway *is* a set of Python modules once `import hy` has run. Python code imports it directly (`from kotoba_gateway.identity import is_signed`), and Hy code imports Hermes directly (`(import run_agent [AIAgent])`). There is no FFI layer.

### Naming rules

Hy names reach Python through Hy's mangling. The gateway restricts itself to the subset that maps to plain snake_case.

| Hy | Python |
|---|---|
| `run-event`, `self.run-id` | `run_event`, `self.run_id` |
| `TERMINAL-STATUSES` | `TERMINAL_STATUSES` |
| `is-signed`, `is-trusted`, `is-valid-cid` (predicates) | `is_signed`, `is_trusted`, `is_valid_cid` |
| `(make-server h p b k :state-dir d)` | `make_server(h, p, b, k, state_dir=d)` |
| `#** kw`, `#* args` | `**kw`, `*args` |
| `f"{e !r}"` (space before the conversion) | `f"{e!r}"` |

Avoid `foo?` and `foo!` names: they mangle to `hyx_fooXquestion_markX`, which Python callers cannot reasonably type. The same check also catches `{e!r}` written without the space, which Hy reads as a symbol named `e!r` and which fails at runtime.

### Python view

`npm run gateway:hy2py` compiles each Hy module with Hy's own compiler and writes the Python source to `gateway-hy/py/`, for review and for diffing against upstream.

The tool is `gateway-hy/tools/hy2py.hy`. Its output is gitignored and read-only; the Hy files remain the source of truth.

The interop test compiles that view and fails if any `hyx_` name appears.

### Module map

| Hy module | Python view | Upstream Hermes Python it mirrors or calls |
|---|---|---|
| `server.hy` | `py/kotoba_gateway/server.py` | `gateway/platforms/api_server.py` (`APIServerAdapter` routes, `_require_auth`, `_handle_health`, `_handle_capabilities`, `_handle_models`); `api_server_openai_routes.py` (`_handle_chat_completions`, `hermes.tool.progress` frames) |
| `runs.hy` | `py/kotoba_gateway/runs.py` | `gateway/platforms/api_server_runs.py` (`_run_event`, `_handle_runs`, `_handle_run_events`, `_handle_get_run`, `_handle_stop_run`, `terminal_run_status`) |
| `backend.hy` | `py/kotoba_gateway/backend.py` | `APIServerAdapter._create_agent`; `api_server_runs._make_run_event_callback` (`_FIXED_EVENT_FIELDS`, `_USAGE_FIELDS`); calls `gateway/run.py` (`_resolve_runtime_agent_kwargs`, `_resolve_gateway_model`, `_load_gateway_config`, `_checkpoint_agent_kwargs`, `_current_max_iterations`), `run_agent.AIAgent`, `tools/approval.py` (`register_gateway_notify`), `tools/approval_context.py`, `hermes_state_registry.acquire` |
| `identity.hy` | `py/kotoba_gateway/identity.py` | none upstream (Kotoba mesh); uses `cryptography` Ed25519 |
| `ledger.hy` | `py/kotoba_gateway/ledger.py` | none upstream; block/head vocabulary follows `kotobase-federation` |
| `peers.hy` | `py/kotoba_gateway/peers.py` | none upstream |
| `orders.hy` | `py/kotoba_gateway/orders.py` | none upstream; `network-awai-apex` ADR 0027 |

The upstream references are to Hermes Agent 0.21.5 (local `4f649c65`). The wire contracts these share (`/v1/runs` event names and key order, the capability shape, `X-Hermes-Session-Id`) are what the gateway tests pin.

### Symbol map

Upstream functions and the Hy definitions that take their place.

| Upstream Python | Hy |
|---|---|
| `_run_event(run_id, name, **fields)` | `runs.hy` `run-event` |
| `terminal_run_status(result)` | `server.hy` `Gateway.launch-turn` (cond on `interrupted` / `failed` / `completed`) |
| `APIServerAdapter._create_agent(...)` | `backend.hy` `HermesBackend._create-agent` |
| `_make_run_event_callback` → `_FIXED_EVENT_FIELDS` | `backend.hy` `tool-progress` (inside `_create-agent`) |
| `_USAGE_FIELDS` | `backend.hy` `USAGE-FIELDS` / `usage-of` |
| `_require_auth` + `_api_key_passes_startup_guard` | `server.hy` `Gateway.authorize` + the loopback guard in `main` |
| `_handle_capabilities` | `server.hy` `Handler.capabilities` |
| `_handle_chat_completions` | `server.hy` `Handler.chat-completions` / `stream-chat` / `blocking-chat` |
| `_handle_runs` / `_handle_run_events` / `_handle_get_run` / `_handle_stop_run` | `server.hy` `Handler.start-run` / `run-events` / `run-status` / `run-stop` |

## Decentralized mesh

Every Hy gateway is a self-sufficient node: it owns an identity, stores its sessions as signed content, and talks to other nodes directly. No server, account or registry is needed for any of it to work.

The design follows the substrate's federation vocabulary (content-addressed blocks, signed heads, replicas converging on a head, injected transports) rather than inventing a protocol. Every node speaks the same Hermes API, so peers need nothing beyond it.

### Node identity

Each node has an Ed25519 key in `HERMES_HOME/kotoba-node.key` (0600, created on first start), and its id is the matching `did:key`.

`GET /.well-known/kotoba-node` serves a manifest signed by that key, holding the did, url, model and features. A manifest verifies against its own did, so it needs no certificate authority.

### Content-addressed sessions

Each completed turn is an immutable block (`kotoba.turn`: input, output, run id, writer did, `prev`), stored under its CIDv1 (dag-json, sha2-256) in `HERMES_HOME/kotoba-blocks/`.

The session head (`{session, seq, cid}`) is signed by the node that wrote it and kept in `kotoba-heads.json`. Reads re-hash every block, so a corrupted file is treated as absent. `GET /v1/blocks/{cid}` and `GET /v1/sessions/{id}/head` expose blocks and heads to peers.

Replication pulls the chain: verify the head signature, then walk `prev` links fetching missing blocks. Each block's hash must match its CID, and its `session` and `seq` must match the chain. Only then is the head adopted, and only if it is newer. A session is therefore portable: whichever node holds the chain can continue it. When the client sends no history, a run reads it from the ledger.

### Peers, gossip and trust

Discovery and authority are separate, so gossip can spread addresses without spreading permission.

- **Discovery**: seeds (`KOTOBA_PEERS`) plus periodic gossip over `GET /v1/peers`. A peer is recorded only after its manifest verifies, and only under the did that its address proves.
- **Trust**: an explicit did allowlist (`KOTOBA_TRUSTED_PEERS`, or `POST /v1/peers {"trust": did}`). Only trusted dids may call a node.
- **Node-to-node auth**: no shared secrets. A caller signs the method, path, unix time and body sha256 (`X-Kotoba-Node`, `X-Kotoba-Timestamp`, `X-Kotoba-Signature`), and the signature expires after 300s. The desktop keeps using its local bearer key.

State lives in `HERMES_HOME/kotoba-peers.json`. Cross-machine peers need a reachable bind (`API_SERVER_HOST`, which also requires `API_SERVER_KEY`) and `KOTOBA_PUBLIC_URL`. All of these can be set in the profile `.env`, which the desktop passes to the spawn.

### Run delegation

`POST /v1/runs` with `"peer": did` (or an `X-Kotoba-Peer` header) runs the turn on that peer. The peer's events are relayed through the local run, tagged with `node`, and stop requests are forwarded.

On completion the origin pulls the session chain, so it holds a verified replica of what the peer wrote. Delegation is one hop and local-only: only the desktop's bearer may delegate, and a node-authenticated request asking to delegate is refused with 403, so relays cannot loop or amplify.

### Remaining central dependencies

The mesh makes agent execution and session state independent of any server. These desktop features still assume a central service, and are optional rather than required:

- Kotoba Cloud account, device, orgs and agent sync (`src/main/kotoba-cloud-*.ts`, `agent-sync.ts`)
- Model inference, when the configured provider is a hosted API (for example `api.murakumo.cloud`). A local or self-hosted OpenAI-compatible endpoint removes it.
- Release checks and auto-update (GitHub releases)

## Paid orders

With `--order-provider` and its settings, a node serves paid inference one order at a time (`orders.hy`, `network-awai-apex` ADR 0027 V1).

This route calls a local llama.cpp server directly. It does not run a Hermes agent, and it does not change any other route.

An order fixes the buyer, the provider, this node and the model. The local operator registers it with the hash of its key at `POST /v1/orders`. That key opens one call to `POST /v1/chat/completions`, and the signed receipt at `GET /v1/orders/{cid}/receipt`, and nothing else.

The node measures the call from the engine's own `usage`, appends a ledger block of hashes to the session `order-<cid>`, and signs an `awai.work-receipt/1`. No prompt, output or key is stored. The input hash is keyed with the order's key, so a short prompt cannot be guessed from it.

Before spending an order, the node checks that the model and engine files have not changed since their digests were taken, and that the engine reports serving that model path. This does not attest what the engine really ran. A failed call spends the order and leaves no receipt.

A receipt records work, not its quality, and nothing here moves money. A streaming client receives the finished result as chunks, after the call ends. One order allows one call, so a Hermes turn that makes several calls does not fit yet.

## Tests

Gateway tests run echo-backed nodes over real HTTP (`npm run test:gateway`). In CI they are the `gateway` job of murakumo actions (`.murakumo/actions.edn`). The desktop side runs under vitest.

`gateway-hy/tests/test_gateway.hy` covers the API contract. `gateway-hy/tests/test_mesh.hy` runs three nodes with separate keys and state. `gateway-hy/tests/test_python_interop.py` drives the gateway from plain Python. The runtime switch is covered in `src/main/kotoba-gateway.test.ts`, and the transport choice in `useDashboardChatTransport.test.tsx`.

### Health is unauthenticated

`GET /health` answers without a bearer token and reports `platform: hermes-agent`, matching upstream liveness probing.

### Bearer auth is enforced

A wrong bearer token on an authenticated route returns 401.

### Capabilities advertise runs

`/v1/capabilities` advertises `run_submission` and the run events path, and works under the `/p/<profile>/` prefix.

### Runs stream message deltas then completion

`POST /v1/runs` returns 202 with the requested session id, and the event stream carries tool events and `message.delta` frames, then ends with `run.completed` holding the final output.

### Chat completions stream OpenAI chunks

Streaming chat echoes `X-Hermes-Session-Id`, emits `chat.completion.chunk` content deltas, and ends with `[DONE]`.

### Chat completions without streaming

Non-streaming chat returns one `chat.completion` with the assistant message.

### Unknown runs are 404

Stopping a run id the gateway never issued returns 404.

### Message splitting

OpenAI messages split into system instructions, text-only history, and the final user turn. A conversation that does not end on a user message is rejected.

### Runtime defaults to hy

The desktop uses the Hy gateway unless `KOTOBA_GATEWAY_RUNTIME=hermes`, and treats unknown values as `hy`.

### Spawn uses its own pid file per profile

Spawn args carry the launcher, the profile's port and `kotoba-gateway.pid` in the profile home. The env points `HERMES_HOME` at that profile.

### Local auto chat uses the Hermes API

Local `auto` chat switches to the `/v1` transport only when the Hy gateway is active. Explicit preferences and remote connections are left unchanged.

### Manifest is self-certifying

The node manifest verifies against the did it names, and changing any field breaks the signature.

### Untrusted nodes are refused

A node that is known by address but not on the trust list gets 401 on signed calls.

### Delegated run replicates the session

A run delegated to a peer streams that peer's events, tagged with its did, and finishes with its output. Afterwards the origin holds the identical head, signed by the peer, and can rebuild the history from it.

### A session continues on another node

After replicating a peer's chain, the origin can run the next turn locally. That extends the same chain: seq 1, `prev` set, signed by the origin.

### Gossip spreads addresses not trust

A node learns a peer-of-a-peer through gossip without adding that peer to its trust list.

### Delegation is one hop and local only

A trusted peer asking a node to delegate onward gets 403.

### Tampered blocks are rejected

Adopting a head fails when a fetched block's bytes do not match its CID, and when a head's seq is altered (which also breaks its signature). Valid chains adopt.

### Signed requests expire and bind the body

A node request signature verifies only for its exact method, path and body, and only within the clock-skew window.

### Hy modules are plain Python modules

Plain Python imports the Hy modules after `import hy`. It signs and verifies through snake_case names, appends to a ledger, and builds a server.

### Python view compiles without mangled names

Every Hy module's generated Python compiles and contains no `hyx_` mangled names.

### An order gets one signed receipt

A registered order's key returns the engine's answer and a receipt signed by this node. The receipt's output CID, keyed input hash, digests and measurement match the call, and its fields are a closed set.

### Orders keep no prompt or output

After a served order, no file in the state directory contains the prompt, the output or the key.

### An order key works once

A second call is refused with `order_used` and never reaches the engine. Of two simultaneous calls, exactly one runs.

### An order key opens nothing else

An order's key cannot read models, another order's receipt or register an order, and an unknown key is refused.

### An order this node cannot honour is refused

Registration refuses another provider, node or model, a live or unknown value class, a past expiry, and missing fields.

### An order key belongs to one order

The same order cannot register twice, and a key cannot open two orders. A refused order leaves nothing behind.

### Registering orders is local only

Registering an order needs the local operator's credential.

### A different model refuses before spending the order

If the engine reports another model, or the model file changed, the call is refused without reaching the engine. An engine mismatch leaves the order usable once it is corrected.

### A failed call leaves no receipt

An engine error or a missing measurement spends the order. Its receipt route says `order_failed`, and the key is not accepted again.

### An expired order is refused

A call after the order's expiry is refused without reaching the engine.

### The order caps the tokens

The engine is asked for the order's `max-tokens`, or a smaller valid amount from the caller.

### A streaming client gets the same result

A `stream: true` call receives the finished answer as OpenAI chunks, and the order still has a receipt.

### The upstream stays on this machine

A non-local upstream is refused at startup, and a redirect from the engine is not followed.

### A receipt survives a restart

The receipt reads back after the order desk restarts, and the key stays spent.

### Orders change nothing when they are off

Without the settings, the order routes answer 404 and capabilities report orders as off.
