# Hermes Agent Enhanced Desktop Roadmap

**Status:** In progress

**Created:** 2026-08-23

**Last updated:** 2026-08-24

**Upstream reference:** `NousResearch/hermes-agent` desktop and release notes through the audit baseline

**Owner:** hermes-desktop maintainers

## Goal

Track the missing Hermes Agent desktop capabilities that should be implemented in hermes-desktop while keeping this repository an independent, enhanced client for a system-installed Hermes Agent.

## Product boundary

Hermes Agent owns agent execution, gateway protocols, bot behavior, routines, cron execution, voice services, messaging integrations, and agent-side plugins. hermes-desktop owns native windows, orchestration, presentation, local integrations, and user workflows.

The desktop must consume Agent capabilities instead of copying Agent backend logic. The desktop app and Hermes Agent continue to use independent update channels.

## How to use this tracker

- Check an item only after its implementation and focused verification are complete.
- Update the milestone status table and `Last updated` date in the same PR.
- Link the implementing PR or commit in the milestone's Notes section.
- Add or update the relevant `lat.md/` architecture and test sections whenever behavior changes.
- Run the milestone verification commands plus `lat check` before marking a milestone complete.
- Refresh the upstream comparison before beginning a new release train.

Status values are `Not started`, `In progress`, `Blocked`, and `Complete`.

## Milestone status

| ID  | Milestone                                   | Depends on                             | Status      |
| --- | ------------------------------------------- | -------------------------------------- | ----------- |
| M0  | Compatibility baseline                      | —                                      | Complete    |
| M1  | Multi-gateway Connections registry          | M0                                     | In progress |
| M2  | Internal contribution framework             | M0, M1                                 | Not started |
| M3  | Artifacts workbench                         | M2                                     | Not started |
| M4  | Bot Mode                                    | M1, M2                                 | Not started |
| M5  | Multi-window, Quick Entry, and HUD          | M1                                     | Not started |
| M6  | Coding workspace                            | M1, M2                                 | Not started |
| M7  | Advanced chat steering                      | M0, M1                                 | Not started |
| M8  | Conversational voice                        | M0, M7                                 | Not started |
| M9  | Automation upgrades                         | M0, M4                                 | Not started |
| M10 | External plugin SDK                         | M2 and at least two built-in consumers | Not started |
| M11 | Performance, themes, and platform hardening | M3–M10                                 | Not started |

## Already available — do not reimplement

These capabilities are present today and should be extended through their existing seams.

- [x] Skills, Tools, and MCP capability surfaces
- [x] Local, Remote, SSH, and Docker operation
- [x] Profile-aware routing
- [x] Image, text, PDF, path-reference, and drag-and-drop attachments
- [x] Sandboxed web preview with inspect and annotation workflows
- [x] Context-folder and worktree file browser
- [x] Grouped reasoning and tool activity
- [x] Provider and model management
- [x] Kanban and schedules
- [x] Desktop auto-update
- [x] Multiple chat tabs in the main window
- [x] Voice dictation and transcription

## Architecture invariants

- [ ] Every session is addressed by `{ connectionId, profile, sessionId }`.
- [ ] Agent features are enabled through advertised capabilities, not scattered version checks.
- [ ] Secrets remain in the Electron main process or Hermes Agent; renderer APIs expose bounded state only.
- [ ] Local, Remote, SSH, Docker, and cloud routes share one typed connection contract.
- [ ] Built-in and external contributions use one command and pane registry.
- [ ] Secondary windows reuse the normal chat/session state and submission path.
- [ ] Hermes Agent remains the authority for bots, routines, cron, webhooks, and voice execution.
- [ ] Older supported Agent installations continue to provide the current desktop experience.
- [ ] New dependencies are added only where the native platform and current dependencies cannot provide the feature.

---

## Release Train R1 — Compatibility and architecture

R1 creates the identities and extension seams required by every later feature.

### M0 — Compatibility baseline

**Outcome:** The desktop knows what the connected Agent supports and can safely expose newer features without breaking older installations.

#### Implementation

- [x] Define a typed `AgentCapabilities` snapshot.
- [x] Read capabilities from the API capability endpoint and dashboard runtime contract where available.
- [x] Add command-inventory evidence for feature-specific gates that require it.
- [x] Add conservative probes for capabilities not explicitly advertised.
- [x] Cache capabilities per connection and invalidate them after reconnect, connection changes, or Agent update.
- [x] Expose the installed Agent version and minimum/recommended desktop contracts.
- [x] Add an explicit Agent update action while preserving the separate desktop updater.
- [x] Disable the unsafe local update action for direct Remote Agents and provide a host-update hint.
- [x] Avoid using release numbers as the primary feature switch.

#### Verification

- [x] Unit tests cover capability normalization and unknown fields.
- [x] Contract integration tests cover an older Agent and the latest supported Agent.
- [x] A failed capability probe degrades to the existing desktop experience.
- [x] Agent and desktop update actions remain visibly separate.
- [x] Relevant `lat.md/` sections are updated and `lat check` passes.

#### Completion gate

- [x] Older Agent installations can open chats and use all currently supported features.
- [x] New capability surfaces appear automatically when supported by the connected Agent.

#### Notes

- PR/commit: branch `codex/hermes-enhanced-desktop-roadmap`; M0 complete.
- Decisions: capability states are tri-state; missing evidence is `unknown`, never automatically unsupported. Runtime evidence is reduced to five compatibility fields before main-process caching.
- Verified 2026-08-23: `npm test -- --maxWorkers=2` (189 files, 1,906 passed, 3 skipped), `npm run typecheck`, `npm run build`, `npm run lint` (warnings only), and `lat check`.
- Command inventory slice: `commands.catalog` is reduced to bounded canonical names and gates background prompts, queues, tool-call steering, session loops, voice commands, and automation blueprints without version guesses.
- Integration coverage uses checked-in representative Agent payloads so CI does not depend on a sibling checkout or live Agent process.
- Completion evidence: unknown capabilities preserve the existing chat/fallback paths, while supported runtime, API, and command evidence automatically populates the typed snapshot and Settings contract status.

### M1 — Multi-gateway Connections registry

**Outcome:** Multiple local and remote Hermes machines can remain connected, and each chat is permanently routed to the correct machine and profile.

#### Data and migration

- [x] Replace the singleton connection record with a versioned connection registry.
- [x] Assign every connection a stable `connectionId` and user-visible name.
- [x] Migrate the existing Local/Remote/SSH configuration without losing credentials or preferences.
- [x] Introduce `SessionLocation = { connectionId, profile, sessionId }`.
- [x] Add `connectionId` to chat-run identity and persisted desktop session metadata.
- [x] Keep API keys, OAuth cookies, SSH secrets, and tunnel credentials outside renderer state.

#### Connection behavior

- [x] Support named Local, Remote/cloud, and SSH connections, including SSH Docker targets.
- [x] Track health, latency, authentication state, Agent version, and capabilities per connection.
- [ ] Allow multiple connections to stay active simultaneously.
- [ ] Route sessions, metadata, attachments, models, and commands through the session's connection.
- [ ] Reconnect one connection without interrupting unrelated connections.
- [x] Preserve the existing single unified SSH dashboard/tunnel invariant per SSH machine.
- [ ] Add connection create, edit, test, reconnect, remove, and select workflows. Create, edit, test, remove, and select are complete; isolated reconnect remains.
- [ ] Add a fleet overview with connection-specific update actions.

Progress (2026-09-02): Settings now manages redacted named records through main-process CRUD IPC and exposes manual per-record health, latency, authentication, version, and capability snapshots. Dashboard and legacy Local/direct-Remote chats keep an immutable saved connection while other records are selected, including URL, authentication, capability probes, fallbacks, cancellation, resumed transcript reads, and live transcript reconciliation. Sidebar and full-list browsing now route list, cache sync, pagination, search, rename, single delete, and bulk delete through the selected connection and profile; Local cache and database access retain that explicit profile, while inactive SSH operations cannot retarget the global tunnel. Remaining desktop metadata, attachments, model/command routing, isolated reconnect, and true simultaneous connection lifecycles are pending.

#### Verification

- [x] Migration tests cover existing local, direct remote, and SSH configurations.
- [x] Routing tests prove profile and connection identities cannot cross.
- [ ] Reconnect tests prove one failing connection does not reset other chat runs.
- [x] Security tests prove credentials never cross preload IPC.
- [ ] Local plus two remote chats can stream concurrently.
- [x] Relevant `lat.md/` sections are updated and `lat check` passes.

#### Completion gate

- [ ] Restarting the desktop restores every connection and reopens chats against their original locations.

#### Notes

- PR/commit: branch `codex/hermes-enhanced-desktop-roadmap`; M1 registry foundation in progress.
- Decisions: version 1 lives inside the existing `desktop.json`; current callers keep using `getConnectionConfig()` as an active-record adapter. Session locations use a credential-free global desktop metadata file instead of the active profile's Agent database, so background runs cannot persist under the wrong profile. Status refresh is initial/manual rather than polling so saved SSH targets do not spawn recurring background probes.
- Verified 2026-08-24: `npm test -- --reporter=json --maxWorkers=2` (191 files, 1,921 passed, 3 skipped), `npm run typecheck`, focused ESLint, and `npm run build`. Full multi-connection routing remains pending.
- Verified 2026-09-02: connection-explicit session browsing passed 192 focused tests across renderer, cache, database deletion, and preload contracts; focused ESLint and the production build also pass.

### M2 — Internal contribution framework

**Outcome:** New desktop features can register UI and commands without expanding central layout and IPC switches.

#### Contribution contract

- [ ] Add a small typed registry for navigation items, panes/pages, commands, keybindings, and status items.
- [ ] Reuse the existing slash-command router for command execution.
- [ ] Namespace contribution IDs and record their source.
- [ ] Return disposers from registrations so contributions can unload cleanly.
- [ ] Define ordering, visibility, capability requirements, and activation rules.
- [ ] Add minimal theme-token contribution support without allowing arbitrary global CSS initially.

#### First built-in consumers

- [ ] Register Artifacts through the contribution framework.
- [ ] Register Bot Mode through the contribution framework.
- [ ] Register Coding workspace panes and commands through the contribution framework.
- [ ] Remove the corresponding one-off central layout cases after migration.

#### IPC organization

- [ ] Split only the touched sections of the main IPC registry into domain registrars.
- [ ] Keep one narrow context-isolated preload contract.
- [ ] Add preload surface tests for every new domain.

#### Verification

- [ ] Registry tests cover duplicate IDs, ordering, disposal, and capability gating.
- [ ] A sample built-in contribution adds a pane and command without editing the central layout switch.
- [ ] Disabling a contribution removes all of its registrations and listeners.
- [ ] Relevant `lat.md/` sections are updated and `lat check` passes.

#### Completion gate

- [ ] At least three built-in features use the framework before the external SDK is finalized.

#### Notes

- PR/commit:
- Decisions:

---

## Release Train R2 — Agent workbench

R2 surfaces substantial Agent output and multi-agent collaboration in the desktop.

### M3 — Artifacts workbench

**Outcome:** Generated content becomes a versioned, attributable work product instead of being trapped inside transcript messages.

#### Detection and identity

- [ ] Detect HTML, SVG, Markdown, code, diagrams, and generated files.
- [ ] Derive stable artifact identity from session, kind, language, and title/slug.
- [ ] Deduplicate repeated streaming renders using a content hash.
- [ ] Associate every artifact version with connection, profile, session, message, and timestamp.
- [ ] Treat transcript content/files as the durable source and store only required index metadata.

#### Experience

- [ ] Add inline artifact cards without hijacking the active pane during streaming.
- [ ] Add session and global artifact galleries.
- [ ] Add version selection and comparison.
- [ ] Reuse the existing file viewer and web-preview pane.
- [ ] Sandbox HTML/SVG previews and keep active scripts disabled by default.
- [ ] Add copy, export, reveal, reopen, and provenance actions.
- [ ] Prune indexes and in-memory content using documented limits.

#### Verification

- [ ] Tests cover detection, stable identity, deduplication, and version ordering.
- [ ] Reloading a transcript rebuilds its artifacts and history.
- [ ] Untrusted artifact content cannot access Node, preload APIs, or unrestricted navigation.
- [ ] Large artifacts do not enter localStorage or block transcript rendering.
- [ ] Relevant `lat.md/` sections are updated and `lat check` passes.

#### Completion gate

- [ ] An artifact generated three times appears once with three selectable versions and complete provenance.

#### Notes

- PR/commit:
- Decisions:

### M4 — Bot Mode

**Outcome:** Users can operate Hermes Agent bots, rooms, routines, and handoffs from the standalone desktop across multiple machines.

#### Agent contract

- [ ] Inventory the current Bot Mode RPC, event, REST, plugin, and routine contracts.
- [ ] Keep bot execution, routing, rooms, and routine state authoritative in Hermes Agent.
- [ ] Define capability-gated desktop adapters for supported Agent versions.
- [ ] Document fallback behavior when Bot Mode is unavailable.

#### Experience

- [ ] Add Sessions/Bots navigation.
- [ ] Add a bot roster with avatar, status, current work, connection, and last activity.
- [ ] Add one-to-one bot chats.
- [ ] Add group rooms.
- [ ] Add `@agent` mentions and explicit handoffs.
- [ ] Render bot and handoff events in the normal ordered transcript timeline.
- [ ] Add routine and schedule management by extending the existing schedule UI.
- [ ] Reuse Agent Sync persona, color, memory, and model metadata.
- [ ] Support bots located on different registered connections.

#### Verification

- [ ] Tests cover roster updates, mentions, handoffs, room membership, and reconnect.
- [ ] Older Agents hide or explain Bot Mode without affecting normal sessions.
- [ ] Cross-connection bot events cannot be applied to the wrong room.
- [ ] Two bots on different connections can participate in one supported room workflow.
- [ ] Relevant `lat.md/` sections are updated and `lat check` passes.

#### Completion gate

- [ ] Bot status, routines, messages, and handoff history survive desktop restart through Agent-owned state.

#### Notes

- PR/commit:
- Decisions:

---

## Release Train R3 — Native desktop power

R3 adds operating-system windows and a focused coding workflow without creating parallel state systems.

### M5 — Multi-window, Quick Entry, and HUD

**Outcome:** Sessions can be viewed and controlled from multiple native windows, including a global lightweight prompt surface.

#### Window foundation

- [ ] Add a main-process window registry keyed by `SessionLocation`.
- [ ] Centralize secure web preferences for every chat-capable window.
- [ ] Pop out an existing chat and focus an existing pop-out instead of duplicating it.
- [ ] Add complete secondary application windows.
- [ ] Persist safe window geometry and constrain restored bounds to available displays.
- [ ] Keep background streaming active only while work is running; restore idle throttling afterward.

#### Quick Entry and HUD

- [ ] Add a configurable global Quick Entry shortcut with accelerator validation.
- [ ] Detect and report shortcut registration conflicts.
- [ ] Forward Quick Entry through the normal prompt-submission path.
- [ ] Add connection/profile/session target selection.
- [ ] Add a compact HUD for running agents, approvals, and voice state.
- [ ] Ensure Escape, blur, and submission behavior are predictable and accessible.

#### Verification

- [ ] Window registry tests cover focus-or-create and cleanup.
- [ ] URL/route tests preserve full connection/profile/session identity.
- [ ] A stream continues while its window is hidden, blurred, or minimized.
- [ ] Idle hidden windows do not keep active polling or animation timers.
- [ ] Shortcut tests cover invalid, reserved, conflicting, disabled, and valid accelerators.
- [ ] Relevant `lat.md/` sections are updated and `lat check` passes.

#### Completion gate

- [ ] The same chat can move between the main window and a pop-out without message duplication or stream loss.

#### Notes

- PR/commit:
- Decisions:

### M6 — Coding workspace

**Outcome:** A session's context folder or worktree can be inspected, executed, reviewed, committed, and published from the desktop.

#### Terminal

- [ ] Add `xterm` and `node-pty` only when this milestone starts.
- [ ] Add persistent terminal tabs scoped to connection, session, and worktree.
- [ ] Keep PTY ownership in the main process and expose only create/write/resize/close/data IPC.
- [ ] Validate working directories against the selected context/worktree.
- [ ] Add local terminal support.
- [ ] Add SSH and Docker terminal transports using the existing connection routing.
- [ ] Restore terminal metadata after restart without pretending dead processes survived.
- [ ] Close processes cleanly during session deletion and app shutdown.

#### Git review and worktrees

- [ ] Detect repository and worktree state from the selected context folder.
- [ ] Add changed-files tree and staged/unstaged/branch/last-turn scopes.
- [ ] Add safe text and binary diff views.
- [ ] Add stage, unstage, revert, commit, fetch, pull, and push.
- [ ] Add branch and worktree creation and switching.
- [ ] Add GitHub PR creation when the `gh` CLI is installed and authenticated.
- [ ] Use `execFile` with validated executable, arguments, repository, and relative paths; do not build shell commands.
- [ ] Add remote Git operations through the existing SSH/Docker transport rather than assuming local paths.

#### Verification

- [ ] PTY tests cover lifecycle, resize, exit, and invalid working directories.
- [ ] Git tests cover spaces, renames, binary files, untracked files, and non-repositories.
- [ ] Path-validation tests prevent traversal outside the selected repository/worktree.
- [ ] Mutating actions require explicit user intent and produce actionable errors.
- [ ] A worktree can be reviewed, selectively staged, committed, pushed, and opened as a PR.
- [ ] Relevant `lat.md/` sections are updated and `lat check` passes.

#### Completion gate

- [ ] Local and remote coding flows use the same renderer experience with transport-specific main-process adapters.

#### Notes

- PR/commit:
- Decisions:

---

## Release Train R4 — Interaction and autonomy

R4 improves control of active turns, voice conversations, and recurring work.

### M7 — Advanced chat steering

**Outcome:** Users can redirect active work and edit upcoming work without corrupting the ordered session timeline.

#### Steering and queue

- [ ] Add active-turn redirect when supported by the gateway.
- [ ] Add editable queued prompts.
- [ ] Add queue reorder and removal.
- [ ] Add composer history navigation and undo.
- [ ] Define explicit fallback behavior for Agents without redirect/queue RPCs.

#### Timeline and clarification

- [ ] Add multi-question clarification cards.
- [ ] Preserve answers and unresolved questions across reconnect.
- [ ] Add transcript find and an event timeline.
- [ ] Add jump targets for reasoning, tools, artifacts, approvals, handoffs, and user edits.
- [ ] Keep live and restored rows projected through the same ordered event normalizer.

#### Verification

- [ ] State-machine tests cover redirect during reasoning, tools, and message streaming.
- [ ] Queue tests cover edit, reorder, delete, reconnect, and submission failure.
- [ ] Redirect never duplicates user messages or assistant output.
- [ ] Timeline search works on long and restored transcripts.
- [ ] Relevant `lat.md/` sections are updated and `lat check` passes.

#### Completion gate

- [ ] A busy session can be redirected and its remaining queue edited without losing or duplicating any turn.

#### Notes

- PR/commit:
- Decisions:

### M8 — Conversational voice

**Outcome:** Dictation becomes an interruptible, hands-free conversation while preserving explicit privacy controls.

#### Voice pipeline

- [ ] Keep the current dictation/transcription path as the push-to-talk fallback.
- [ ] Add streaming TTS playback through Agent-supported voice services.
- [ ] Add explicit listening, transcribing, thinking, speaking, and interrupted states.
- [ ] Add automatic turn-taking.
- [ ] Add barge-in that stops playback and redirects or interrupts the active turn.
- [ ] Add per-profile voice, speed, device, and hands-free settings.
- [ ] Add optional wake-word support only when explicitly enabled and supported.
- [ ] Ensure first-turn playback works in voice-started windows without weakening other security settings.

#### Privacy and resilience

- [ ] Show persistent microphone state and a one-action stop control.
- [ ] Never start always-on listening without user opt-in.
- [ ] Handle microphone denial, device removal, TTS failure, and reconnect.
- [ ] Prevent old audio from playing after redirect, session switch, or interruption.

#### Verification

- [ ] Tests cover voice state transitions and stale-audio cancellation.
- [ ] Barge-in stops playback before submitting the interruption.
- [ ] Push-to-talk continues working when conversational voice is unavailable.
- [ ] Wake-word mode remains off after fresh installation and profile creation.
- [ ] Relevant `lat.md/` sections are updated and `lat check` passes.

#### Completion gate

- [ ] A user can interrupt a spoken response and continue the same session without overlapping audio or duplicate prompts.

#### Notes

- PR/commit:
- Decisions:

### M9 — Automation upgrades

**Outcome:** Existing schedules gain reusable blueprints, durable context, richer reasoning controls, and secure outbound notifications.

#### Automation experience

- [ ] Add Cron Blueprint creation, editing, import, export, and instantiation.
- [ ] Add per-job model and reasoning settings.
- [ ] Expose Agent-owned persistent cron memory and execution context.
- [ ] Link scheduled jobs to bots and routines.
- [ ] Add run history, output, duration, retry, duplicate, pause, and test-run actions.
- [ ] Add signed outbound webhook configuration through Hermes Agent.
- [ ] Keep webhook secrets, signature generation, retries, and delivery in Hermes Agent.
- [ ] Gate fields and actions by the selected connection's capabilities.

#### Verification

- [ ] Blueprint round-trip tests preserve all supported job settings.
- [ ] Webhook secrets and signatures never enter desktop persistence or logs.
- [ ] Run history is scoped to the correct connection, profile, bot, and job.
- [ ] Older Agents retain the current schedules experience.
- [ ] Relevant `lat.md/` sections are updated and `lat check` passes.

#### Completion gate

- [ ] A blueprint can create a scheduled Bot routine whose signed webhook execution is visible in desktop history.

#### Notes

- PR/commit:
- Decisions:

---

## Release Train R5 — Ecosystem and hardening

R5 opens the proven contribution seam to trusted plugins and completes cross-platform performance and polish work.

### M10 — External plugin SDK

**Outcome:** Trusted plugins can extend the desktop and their Hermes Agent backend without changing core desktop files.

#### Plugin lifecycle

- [ ] Finalize the SDK only after at least two substantial built-in consumers validate it.
- [ ] Support bundled and explicitly trusted on-disk plugins.
- [ ] Add discovery, inventory, enable, disable, error, and reload states.
- [ ] Add development hot reload with complete disposer cleanup.
- [ ] Namespace contribution IDs, storage, translations, and Agent endpoints by plugin ID.
- [ ] Record plugin provenance for every contribution and OS action.

#### Curated host capabilities

- [ ] Expose contribution registration through a scoped plugin context.
- [ ] Expose namespaced persistence.
- [ ] Expose profile/connection-aware plugin REST and socket access.
- [ ] Expose bounded notifications, clipboard, reveal-path, and open-URL operations.
- [ ] Do not expose raw Electron, unrestricted filesystem access, or arbitrary IPC.
- [ ] Validate URLs and paths in the main process.
- [ ] Define desktop/Agent capability and version requirements in plugin metadata.

#### Distribution and documentation

- [ ] Document the trusted-plugin security model and installation consent.
- [ ] Add an example plugin repository or in-tree fixture.
- [ ] Document contribution APIs, lifecycle, storage, Agent APIs, testing, and packaging.
- [ ] Add a compatibility and deprecation policy before declaring the SDK stable.

#### Verification

- [ ] Tests cover discovery, duplicate IDs, toggles, activation failure, disposal, and reload.
- [ ] A plugin can add a pane, command, keybinding, status item, and Agent-backed live view.
- [ ] A disabled plugin leaves no listeners, sockets, timers, commands, or UI behind.
- [ ] Relevant `lat.md/` sections are updated and `lat check` passes.

#### Completion gate

- [ ] The example plugin works without any core-file edits and cannot access capabilities outside the documented host API.

#### Notes

- PR/commit:
- Decisions:

### M11 — Performance, themes, and platform hardening

**Outcome:** The expanded desktop remains responsive, quiet at idle, accessible, secure, and supportable across packaged platforms.

#### Performance

- [ ] Record baseline startup, idle CPU, active streaming, memory, and long-transcript measurements.
- [ ] Eliminate active polling and animation timers in idle hidden windows.
- [ ] Use CSS/compositor-driven progress indicators.
- [ ] Add transcript virtualization only where measurements show it is needed.
- [ ] Evaluate React Compiler only after profiling and compatibility checks.
- [ ] Add performance regression coverage for long transcripts, multiple windows, terminals, bots, and voice.

#### Appearance and accessibility

- [ ] Add glass/frost options with an accessible solid-background fallback.
- [ ] Add plugin-provided theme tokens through the contribution framework.
- [ ] Verify keyboard operation for every new pane, dialog, queue, and window.
- [ ] Respect reduced motion and platform contrast preferences.
- [ ] Verify screen-reader labels and focus restoration.

#### Security and packaging

- [ ] Re-audit CSP, context isolation, sandboxing, navigation, URLs, paths, terminals, Git, artifacts, and plugins.
- [ ] Run packaged smoke tests on macOS, Windows, and Linux.
- [ ] Verify signing, notarization, updater feeds, and independent Agent update behavior.
- [ ] Publish a desktop-to-Agent compatibility matrix.
- [ ] Publish user-facing migration notes and release notes for every release train.

#### Verification

- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Packaged platform smoke tests pass.
- [ ] `lat check` passes.
- [ ] `git diff --check` passes.

#### Completion gate

- [ ] The app has no persistent idle work, maintains responsive streaming under the agreed stress fixture, and passes accessibility and security review on all supported platforms.

#### Notes

- PR/commit:
- Decisions:

---

## Release gates

Each release train must satisfy these checks before merging into a stable release.

- [ ] Focused unit and integration tests pass.
- [ ] Main/preload IPC contract tests pass.
- [ ] Local, direct Remote, SSH, and Docker smoke paths pass where applicable.
- [ ] Compatibility checks pass against the oldest supported and latest recommended Hermes Agent.
- [ ] Critical Playwright flows pass in a packaged build.
- [ ] No renderer exposure of credentials, cookies, webhook secrets, PTY handles, or unrestricted filesystem operations.
- [ ] User-visible changes have release notes and upgrade guidance.
- [ ] Architecture and test behavior are documented in `lat.md/`.
- [ ] `lat check`, typecheck, tests, build, and `git diff --check` pass.

## Upstream refresh checklist

Run this before beginning each release train so the roadmap does not implement an already-replaced protocol.

- [ ] Fetch the latest `NousResearch/hermes-agent` release notes and desktop changes.
- [ ] Record the inspected release/tag/commit and date below.
- [ ] Compare capability contracts before comparing UI implementation.
- [ ] Update this roadmap when upstream removes, renames, or supersedes a feature.
- [ ] Prefer the current Hermes Agent public contract over copying upstream desktop internals.

| Inspected on | Upstream release/tag/commit                                  | Roadmap impact  |
| ------------ | ------------------------------------------------------------ | --------------- |
| 2026-08-23   | Audit baseline through the previously reviewed release notes | Initial roadmap |

## Upstream behavioral references

These paths are behavioral references in the sibling Hermes Agent checkout, not code-copy requirements.

- `../hermes-agent/apps/desktop/electron/connection-config.ts`
- `../hermes-agent/apps/desktop/src/contrib/plugin.ts`
- `../hermes-agent/apps/desktop/src/contrib/plugins.ts`
- `../hermes-agent/apps/desktop/src/store/artifacts.ts`
- `../hermes-agent/apps/desktop/electron/session-windows.ts`
- `../hermes-agent/apps/desktop/electron/quick-entry.ts`
- `../hermes-agent/apps/desktop/electron/git-review-ops.ts`
- `../hermes-agent/apps/desktop/src/lib/voice-barge-in.ts`
- `https://github.com/NousResearch/hermes-agent/releases`

## Deferred until evidence requires them

These are intentionally not prerequisites for the roadmap.

- A second renderer state system for secondary windows
- A desktop-owned Bot Mode protocol
- Desktop-owned webhook execution or secret storage
- Arbitrary untrusted renderer plugins
- A custom Git parser framework or terminal protocol when the platform tools suffice
- React Compiler adoption without a measured performance case
- Rewriting existing attachments, preview, worktree, schedules, or command systems
