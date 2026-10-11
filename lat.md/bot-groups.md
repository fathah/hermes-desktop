# Bot groups

An opt-in renderer for Hermes groups protocol v2. Hermes owns group membership, shared context, execution, approvals and durable history; Desktop owns only presentation and unsent drafts.

Set `HERMES_DESKTOP_BOT_GROUPS=1` in the desktop process environment. The feature
requires a local Hermes runtime advertising groups protocol v2 and a running
hosted room driver; the reference runtime is Hermes Agent `v2026.9.7`.
The navigation entry is hidden by default. Unsetting the flag disables the UI
without deleting history or cancelling already running Hermes work.

The first slice supports same-installation 2–6 Agent groups, mentions, shared
messages, replay, stop, exact approvals and explicit retry. It does not include
Bot direct messages, attachments, remote/SSH connections, cross-server invites,
scheduling UI or human-to-human social messaging. It must not be exposed as a
tenant-scoped API: Hermes groups are installation-wide.

## Request boundary

[[src/shared/bot-groups.ts#validateBotGroupRequest]] admits only the implemented protocol operations and their known fields. No generic gateway method, authenticated URL or execution authority crosses renderer IPC.

The bridge uses [[src/main/hermes.ts#requestLocalBotGroup]] and the existing local
TUI gateway client. It does not enter ordinary Chat's automatic approval path,
add a database, import an Agent plugin or maintain a second execution queue.
Profile results exclude filesystem paths and private session previews.

## Connection scope

[[src/main/bot-groups.ts#botGroupsRequest]] checks the feature flag and explicit connection identity in the main process. A remote or SSH connection is rejected, never silently routed to the local installation.

Connection changes remount the page, discarding the previous display cache and
in-memory drafts. Public Dashboard OAuth and SSH owner scope need a separate
reviewed adapter before remote support is enabled.

## Explicit send retry

An unconfirmed send keeps its draft and event ID. Only an explicit user retry resends the identical payload; editing the draft starts a new identity. Reload never sends a queued request.

Creation uses the same rule with a stable room ID. Drafts are not persistent.
Failed-task retry has a second confirmation because earlier tool effects may
have completed even if execution did not finish.

## View lifecycle

[[src/renderer/src/screens/BotGroups/BotGroups.tsx#BotGroups]] owns the transient room list, selected room and polling effects. Leaving, switching rooms or changing connections invalidates late responses and releases the poll.

State/log reads pause while the document is hidden. Re-entering the page reads
authoritative state and replays committed history; ordinary Chat sessions are
not used as group state.

## Exact approval

Approval buttons send the complete room, member, task, execution generation and request identity. Only allow-once and deny are offered; stale requests remain subject to Hermes validation.

Fresh state is required for writes. The UI never stores a durable approval queue
or automatically grants a pending tool request.

## Replay authority

[[src/shared/bot-groups.ts#mergeBotGroupLog]] rejects mixed authority pages and deduplicates committed event IDs. An epoch change resets replay instead of promoting a replica or continuing from a stale cursor.

At most 500 events remain in the display cache; Hermes retains the canonical
history. Text is rendered with React's escaping, not injected as HTML.

## Verification

Focused Vitest cases cover connection boundaries, late responses, exact approval, explicit retry and replay fencing. Browser fixtures exercise the real React component; runtime acceptance separately uses an actual Agent backend.

```bash
npm test -- src/shared/bot-groups.test.ts src/main/bot-groups.test.ts src/renderer/src/screens/BotGroups/BotGroups.test.tsx
npm run typecheck
BOT_GROUPS_BROWSER_CHANNEL=chrome BOT_GROUPS_SCREENSHOTS=docs/images/bot-groups node scripts/verify-bot-groups-ui.mjs
```

The browser smoke checks 1280px and 600px layouts, mentions, send/draft clearing,
overflow and page errors. It is not full Electron, installer, remote connection
or real-provider LLM acceptance. Use isolated state for a provider-backed manual
trial before enabling this experimental feature for daily work.

### Runtime acceptance

An isolated Agent Dashboard and local provider fixture verify durable rooms, successful two-profile discussion, ordinary Chat coexistence and restart recovery without user state or paid model requests.

[[scripts/verify-bot-groups-runtime.py#run]] starts the actual Dashboard with a
temporary home, two temporary profiles and an OpenAI-compatible HTTP fixture.
Both members must settle successfully; failed or cancelled turns fail the
trial. Restart must preserve the room and installation authority. Backend
processes and temporary state are cleaned up after the result is written.

Run with a Python environment containing the Agent Dashboard dependencies:

```bash
python scripts/verify-bot-groups-runtime.py --agent-repo ../hermes-agent
```

The repair also passed manual Chrome acceptance with the real Layout, App shell
wrappers, providers and CSS against this isolated backend: room creation,
mentions, accepted send, Ready state and Chat/group navigation. At 1280×600,
1440×900 and 600×900, the composer remains visible without horizontal overflow.

## Recovery regressions

The repaired draft follows connection revisions and reports availability only when the runtime exposes the required protocol and a running room driver.

### Runtime availability

Missing methods, malformed capabilities and a stopped driver leave groups unavailable instead of presenting a usable runtime. Covered by [[src/main/bot-groups.test.ts]].

### Edited connection scope

Editing a connection under the same ID releases the old view, drafts and requests before displaying the new target. Navigation refreshes its flag and the renderer cannot reuse old group state. Covered by [[src/renderer/src/screens/BotGroups/BotGroups.test.tsx]].

### Unconfirmed room creation

An explicit retry after a lost creation acknowledgement retains the submitted room ID and payload, so Hermes can return the same durable room without duplicate creation.

### Creation preserves navigation

A delayed creation adds its accepted room to the list without replacing a newer deliberate room selection, including a selection that returns to the original room.

### Delayed action room isolation

Late approval, retry and send successes or failures preserve the newly selected room and its unsent draft. Old-room errors cannot replace feedback for the newer selection.

### Hidden creation completion

Accepted creation closes and clears the submitted form even behind Chat, preventing accidental duplicate creation on return. Selecting its room still requires a visible view without a newer deliberate selection.

### Submitted creation fields

Name and member controls are disabled while creation is pending, so success cannot discard newer edits. Failed acknowledgement retains the submitted form and stable retry identity while re-enabling its controls.

### Existing profile names

Group members use the shared Desktop profile-name contract, including existing underscore-prefixed profiles. Picker and main routing preserve names unchanged while validation rejects unsafe paths, uppercase names and overlong values.

[[src/shared/profile-name.ts#PROFILE_NAME_RE]] is also consumed by Desktop's existing profile-path helpers, keeping group admission aligned without importing main-process modules into the renderer.

Desktop forwards the selected profile unchanged; Hermes still controls discovery
and group membership. The reference Agent CLI rejects leading underscores, and
hosted-room validation applies its stricter identifier rule to all discovered
local profiles. An existing `_ops` directory can therefore block creation even
when it is not selected. Backend refusals remain visible; upstream support or
repair of that legacy profile is needed. Runtime acceptance covers `default`
and `ops`.
