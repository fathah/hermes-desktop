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

Focused Vitest cases cover the request/connection boundaries, late response isolation, exact approval, explicit send retry and replay fencing. Browser fixtures exercise the real React component with synthetic IPC, not a running Agent.

```bash
npm test -- src/shared/bot-groups.test.ts src/main/bot-groups.test.ts src/renderer/src/screens/BotGroups/BotGroups.test.tsx
npm run typecheck
BOT_GROUPS_BROWSER_CHANNEL=chrome BOT_GROUPS_SCREENSHOTS=docs/images/bot-groups node scripts/verify-bot-groups-ui.mjs
```

The browser smoke checks 1280px and 600px layouts, mentions, send/draft clearing,
overflow and page errors. It is not full Electron, installer, remote connection
or real-provider LLM acceptance. Use isolated state for a provider-backed manual
trial before enabling this experimental feature for daily work.
