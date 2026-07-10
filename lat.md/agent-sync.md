# Cloud agent sync

Syncs desktop profiles (the app's agents) with the signed-in [[hermes-account-login|Hermes One account]]'s cloud agents, bidirectionally, via the backend's `/api/agents` CRUD.

Phase 1 covers the free parts from the backend's `docs/agent-sync.md`: color, persona (`SOUL.md` ↔ `systemPrompt`), memory (`memories/MEMORY.md` ↔ `memory`), and config basics (`model`/`provider` only — never the whole `config.yaml`, so no secrets leave the device). Skills, automations, and sessions are deferred. Deletions never propagate in either direction.

## Sync engine

[[src/main/agent-sync.ts#syncAgents]] runs one single-flight pass: link local profiles to cloud agents, reconcile each part, create missing counterparts on both sides, and unlink mappings whose cloud agent disappeared.

The stored link (a profile's cloud `agentId`) is also read by [[wallet-token-balances#Wallet Sync]] via [[src/main/agent-sync.ts#getLinkedAgentId]], so backend-provisioned wallets can be fetched for the same agent.

Requests are bearer-authenticated with the device-login token — the account is located app-wide by [[src/main/account-store.ts#findAccountProfile]] (the token is saved under whichever profile was active at sign-in). Linking keys on the cloud agent's stable `id`; names only match never-synced profiles to their cloud namesakes and are never used to rename.

Per part, the pure [[src/main/agent-sync.ts#decidePartAction]] compares the last-sync base hash with both sides' current hashes: only one side moved → that side wins; both moved (or first sync) → last-writer-wins by timestamp (local file mtime vs the agent's `updatedAt`). Equal content is always a no-op.

Pushes are built by [[src/main/agent-sync.ts#buildPushBody]], which enforces the backend's field limits by *skipping* oversize parts with a warning — truncating and later pulling back would destroy local content. An unset local model is also skipped so a PATCH can't clobber the cloud value with an empty string. Pulls write through the existing per-part helpers: [[src/main/soul.ts#writeSoul]], [[src/main/memory.ts#writeMemoryRaw]], [[src/main/profile-meta.ts#setProfileColor]], and [[src/main/config.ts#setModelConfig]] (preserving the local base URL).

A profile's stable **id** (its directory slug), not its editable display **name**, keys every on-disk operation — `getModelConfig`/`readSoul`/`readMemoryRaw`, the `cloud-sync.json` state file, and all pull writes — so a renamed profile keeps syncing against the same directory. The display `name` is used only as the cloud agent's human label (create/name-match/warnings).

Cloud-only agents are materialized locally by [[src/main/profiles.ts#createProfile]], which derives a valid, collision-free id from the cloud agent's display name and returns it; the pulled parts are then written under that id.

## State file

Each linked profile stores its mapping in `cloud-sync.json` under the profile home: the cloud `agentId`, the cloud-side name, and a content hash per part from the last successful sync (the conflict-detection base).

Parts that failed to push (or were skipped as oversize) keep their old base, so they stay pending rather than being silently marked clean. Deleting the file unlinks the profile — which is exactly what a pass does when the cloud agent was deleted in the console, leaving the local profile untouched.

## IPC and UI

The main process exposes `agent-sync-run` and `agent-sync-status` in [[src/main/ipc/register.ts#registerIpcHandlers]], next to the account handlers; a completed run also emits `agent-sync-updated` so the renderer can refresh.

The preload bridge surfaces these as `syncAgents`, `getAgentSyncStatus`, and `onAgentSyncUpdated` on `window.hermesAPI`, typed by the shared shapes in [[src/shared/agent-sync.ts]].

[[src/renderer/src/screens/Agents/Agents.tsx]] (local mode only — Layout shows a remote notice otherwise) renders the sync affordance in the header: a signed-out hint pointing at the Providers account card, or a Sync button with the last pass's summary (warnings in the tooltip). It auto-runs one pass per visit when signed in, and reloads the profile list when a pass pull-created profiles. [[src/renderer/src/components/HermesAccountModal.tsx]] kicks off the first sync right after a successful sign-in.

## Tests

[[src/main/agent-sync.test.ts]] fakes the profile/config/fs surface and stubs `fetch`, so the tests exercise the reconciliation logic itself; one account-lookup test lives in [[src/main/account-store.test.ts]].

### Locates the account app-wide

`findAccountProfile` finds a session saved under a named profile and prefers the default home when both have one, so sync works no matter which profile was active at sign-in.

### Part decision matrix

`decidePartAction` across the base/local/remote hash matrix: equal content is a no-op, a single moved side pushes or pulls, and both-moved / never-synced parts fall back to last-writer-wins by timestamp.

### Push bodies stay within limits

`buildPushBody` maps parts to exactly the backend's fields and nothing else, and skips oversize persona/memory and unset models instead of truncating or sending empty strings.

### Keys on-disk work off the stable id

A renamed profile (id `hello-agent`, display name `Hello Agent`) drives all on-disk sync — state file, part reads — off the id, while the cloud agent it creates carries the display name as its label.

### Backs up new local profiles

A never-synced local profile is POSTed to the backend with its four parts and the returned agent id is persisted to `cloud-sync.json`.

### Links by name and pulls the newer side

An unmapped profile links to its cloud namesake without creating a duplicate, and on first sync the newer side (the cloud, when local files are older) wins part by part.

### Pull-creates cloud-only agents

A cloud agent with no local counterpart becomes a local profile (via `createProfile`, which derives the id from the agent's display name), and its persona/color/memory/config are written locally under that id.

### Unlinks deleted cloud agents

When a mapped cloud agent disappears, the pass removes `cloud-sync.json` and keeps the local profile — no DELETE is ever sent in either direction.
