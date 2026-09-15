# Cloud agent sync

Syncs desktop profiles (the app's agents) with the signed-in [[hermes-account-login|Hermes One account]]'s cloud agents, bidirectionally, via the backend's `/api/agents` CRUD.

Phase 1 covers the free parts from the backend's `docs/agent-sync.md`: color, persona (`SOUL.md` ↔ `systemPrompt`), memory (`memories/MEMORY.md` ↔ `memory`), and config basics (`model`/`provider` only — never the whole `config.yaml`, so no secrets leave the device). Skills, automations, and sessions are deferred. Deletions never propagate in either direction. Local profile deletion records a device-side exclusion so the retained cloud copy is not automatically restored.

## Sync engine

[[src/main/agent-sync.ts#syncAgents]] runs one single-flight pass: link local profiles to cloud agents, reconcile each part, create missing counterparts on both sides, and unlink mappings whose cloud agent disappeared.

The stored link (a profile's cloud `agentId`) is also read by [[wallet-token-balances#Wallet Sync]] via [[src/main/agent-sync.ts#getLinkedAgentId]], so backend-provisioned wallets can be fetched for the same agent.

Requests are bearer-authenticated with the device-login token — the account is located app-wide by [[src/main/account-store.ts#findAccountProfile]] (the token is saved under whichever profile was active at sign-in). Linking keys on the cloud agent's stable `id`; names only match never-synced profiles to their cloud namesakes and are never used to rename.

New links record both the normalized backend API URL and the owning user id. Links from a different recorded backend are skipped even when user ids coincide. Links are **account-scoped**: every state write records the owning backend user id, and a pass skips (never unlinks, never pushes) profiles whose link belongs to a different account — signing out and back in as someone else must not re-upload the first account's agents to the second. A missing cloud agent only unlinks when the state provably belongs to the current account; legacy states without an owner are adopted when their agent exists in the account's list and skipped with a warning otherwise. Wallet flows apply the same rule through [[src/main/agent-sync.ts#getLinkedAgentAccountId]] — see [[wallet-token-balances#Wallet Sync]].

Per part, the pure [[src/main/agent-sync.ts#decidePartAction]] compares the last-sync base hash with both sides' current hashes: only one side moved → that side wins; both moved (or first sync) → last-writer-wins by timestamp (local file mtime vs the agent's `updatedAt`). Equal content is always a no-op.

Pushes are built by [[src/main/agent-sync.ts#buildPushBody]], which enforces the backend's field limits by *skipping* oversize parts with a warning — truncating and later pulling back would destroy local content. An unset local model is also skipped so a PATCH can't clobber the cloud value with an empty string. Pulls write through the existing per-part helpers: [[src/main/soul.ts#writeSoul]], [[src/main/memory.ts#writeMemoryRaw]], [[src/main/profile-meta.ts#setProfileColor]], and [[src/main/config.ts#setModelConfig]] (preserving the local base URL).

A profile's stable **id** (its directory slug), not its editable display **name**, keys every on-disk operation — `getModelConfig`/`readSoul`/`readMemoryRaw`, the `cloud-sync.json` state file, and all pull writes — so a renamed profile keeps syncing against the same directory. The display `name` is used only as the cloud agent's human label (create/name-match/warnings).

Cloud-only agents are materialized locally by [[src/main/profiles.ts#createProfile]], which derives a valid, collision-free id from the cloud agent's display name and returns it; the pulled parts are then written under that id.

## State file

Each linked profile stores its mapping in `cloud-sync.json` under the profile home: the cloud `agentId`, the owning account's user id, the cloud-side name, and a per-part content hash from the last successful sync (the conflict-detection base).

Parts that failed to push (or were skipped as oversize) keep their old base, so they stay pending rather than being silently marked clean. Deleting the file unlinks the profile — which is exactly what a pass does when the cloud agent was deleted in the console, leaving the local profile untouched.

## Local deletion exclusions

Deleting a linked local profile keeps its cloud copy but prevents sync from recreating it on this device. The exclusion follows the cloud id, so renaming either side does not undo deletion.

[[src/main/agent-sync.ts#deleteProfileWithSync]] saves the recorded cloud identity in `cloud-sync-deleted.json` under the default Hermes home before invoking the Agent CLI. The file survives deletion of the named profile and of any account session stored there. It uses atomic file replacement and contains no credentials or profile content. An unreadable or invalid link blocks deletion; an invalid exclusion history blocks sync and linked deletion rather than silently restoring removed profiles.

New link records carry the backend URL and account id, and exclusions honor both. Older links preserve whatever scope they actually recorded: account-only records match that user and exact cloud id; legacy ownerless records exclude only that exact cloud id on this device. No signed-in account is guessed during deletion, which also works offline or while a different account is active. A new cloud id with the same name remains eligible for import. A freshly created local profile cannot automatically relink by name to an excluded cloud copy.

Sync and local deletion share a main-process operation queue, including awaited color metadata writes. A waiting delete runs after the current pass; later passes read the persisted exclusions before touching profiles. Network requests have a 30-second timeout so stalled requests release the queue. Invalid or interrupted list responses never imply cloud deletion. New imports persist their identity and initial local hashes before asynchronous pulls, then advance each base only after its write succeeds. The CLI retains responsibility for stopping profile services and removing profile files; Desktop verifies the directory is gone before reporting success. A failed or partial CLI delete retains its exclusion and reports the failure for retry; an intact linked profile can still sync.

This applies to deletion through Desktop's local profile controls. SSH deletion stays on the configured SSH host, and unsupported remote connections cannot fall through to local deletion. Direct CLI deletions and independent processes do not participate in Desktop's operation queue. No backend DELETE request is made. Exclusions persist even when a cloud id is absent from a workspace list, since absence does not establish deletion. To intentionally restore a retained cloud copy on this device, remove its specific exclusion entry while Desktop is closed and sync again; other devices are unaffected.

## IPC and UI

The main process exposes `agent-sync-run`, `agent-sync-status`, and `agent-sync-linked-id` in [[src/main/ipc/register.ts#registerIpcHandlers]], next to the account handlers; a completed run also emits `agent-sync-updated` so the renderer can refresh.

`agent-sync-linked-id` returns the cloud agent id a profile is linked to (or null) — for the per-profile Sync tab below.

The preload bridge surfaces these as `syncAgents`, `getAgentSyncStatus`, `getLinkedAgentId`, and `onAgentSyncUpdated` on `window.hermesAPI`, typed by the shared shapes in [[src/shared/agent-sync.ts]].

[[src/renderer/src/screens/Agents/Agents.tsx]] (local mode only — Layout shows a remote notice otherwise) renders the sync affordance in the header: a signed-out hint pointing at the Providers account card, or a Sync button with the last pass's summary (warnings in the tooltip). It auto-runs one pass per visit when signed in, and reloads the profile list when a pass pull-created profiles. [[src/renderer/src/components/HermesAccountModal.tsx]] kicks off the first sync right after a successful sign-in.

The profile modal's **Sync** tab, [[src/renderer/src/components/profile/ProfileSyncPane.tsx]], is a per-profile manual path for when the auto-sync hasn't run: it shows the signed-in account, whether this profile is linked to a cloud agent (`getLinkedAgentId`), and this profile's outcome from the last pass, with a **Sync now** button that runs the same app-wide `syncAgents()`. Sign-in/unauthorized/error states are surfaced inline.

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

When a mapped cloud agent disappears **and the link's recorded owner is the current account**, the pass removes `cloud-sync.json` and keeps the local profile — no DELETE is ever sent in either direction.

### Skips foreign-linked profiles

A profile whose state names a different `accountId` is left completely untouched — state file intact, nothing pushed or pulled — and wallet sync refuses it client-side with `status: "foreign"` before any backend call.

### Leaves ambiguous legacy links alone

A legacy state (no `accountId`) whose agent isn't in the current account's list is skipped with a warning, not unlinked.

It could be a console deletion or another account's agent — and a wrong unlink would re-upload someone else's agent on the next pass, so skipping is the safe read.

### Records the owning account

Every successful pass stamps the current account's user id into the state file, adopting legacy links whose agent exists in this account's list.


### Keeps deleted profiles deleted after restart

Deleting a renamed linked profile removes its directory while preserving its cloud-id exclusion outside that directory. Reloading the sync module and syncing the retained cloud copy must neither recreate the profile nor delete the cloud agent.

### Preserves deletion ownership

Exclusions respect recorded account and backend boundaries without borrowing the current login. Offline and legacy deletions preserve known identity, and a different cloud id or an explicitly created namesake remains independent.

### Fails safely when deletion persistence fails

Failed exclusion writes leave the profile intact and allow retry. Corrupt history or link state blocks unsafe operations; a CLI failure retains the exclusion for a later retry. Invalid and default profile targets never reach deletion.

### Serializes deletion with in-flight sync

A pending asynchronous metadata pull finishes before deletion, and a later sync cannot recreate the deleted profile. Concurrent deletion requests preserve both cloud-id exclusions.

### Rejects incomplete CLI deletion

A CLI that exits successfully but leaves the profile directory must produce a failed Desktop deletion result, preventing a misleading success message on older Agent builds.

### Surfaces deletion failures in the modal

The profile modal disables duplicate deletion while a request is pending, displays both structured failures and IPC rejections, preserves the modal, and allows a retry.


### Does not infer deletion from invalid responses

Malformed, missing, or interrupted successful cloud-list responses must leave links intact. A failed request releases the operation queue so a pending local deletion can complete safely.

### Retains the identity after a failed import

Cloud import records its identity and pre-import local hashes before asynchronous writes. A failed part remains retryable without pushing defaults, and deletion can still exclude the retained cloud copy.


### Enforces backend ownership for wallets

Wallet listing, provisioning, and portfolio reads reject a link recorded under another backend even when user ids match. Legacy links must gain a matching backend through sync before wallet requests are allowed.

### Validates all reconciliation fields

Cloud-list responses must include valid identity, color, nullable persona/memory, model/provider, and timestamp fields. Missing or invalid values cannot trigger unlinking or push local defaults over cloud content.

Empty model/provider strings remain accepted because the backend permits them; an empty remote model never clears the local selection.
