# Sidebar recent sessions

The sidebar starts with New Chat, keeps app destinations pinned, then gives conversations and projects their own scroll area.

[[src/renderer/src/screens/Layout/Layout.tsx#Layout]] renders a New Chat action before Discover, Office, Kanban, and Schedules from `PINNED_NAV_ITEMS`, then renders [[src/renderer/src/screens/Layout/SidebarRecentSessions.tsx]] inside a flexible `.sidebar-chat-section`. New Chat is active when the visible Chat view has no session id yet. The standalone `sessions` view is still absent from the `View` union; the full list opens from the Cmd/Ctrl+K menu action.

## Collapse toggle brand mark

The sidebar header's collapse control doubles as the brand mark: collapsed it shows a circular dot that swaps to the expand icon on hover; expanded it shows the full wordmark beside the collapse icon.

[[src/renderer/src/screens/Layout/Layout.tsx#Layout]] renders `.sidebar-collapse-toggle`. Collapsed, it holds a fixed-size `.sidebar-collapse-swap` box stacking a `.sidebar-collapse-mark` circle (filled with `--text-primary`, so white on dark themes and dark on light) over the `PanelLeftOpen` icon; only opacity toggles on hover/focus, so the button never reflows. Expanded, the maskable `.sidebar-logo` wordmark shows next to the `PanelLeftClose` icon.

## Infinite sidebar list

The inline list lazily loads cached sessions in pages as the user scrolls, so the sidebar can expose the full chat history without a fixed inline cap.

[[src/renderer/src/screens/Layout/SidebarRecentSessions.tsx]] fetches `RECENT_SESSIONS_PAGE_SIZE + 1` rows from the `sessions.json` cache to detect whether another page exists. [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] passes the chat scroll container ref down, and the sidebar loads the next page when that container nears the bottom. The initial sync still refreshes `state.db`, then paints the first page.

Session titles in the inline list are constrained to the sidebar width and truncate with ellipses, while the chat section only scrolls vertically. This keeps long generated titles from creating a horizontal scrollbar.

The native sidebar scrollbar is hidden to avoid layout shifts. [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] measures the chat scroll container and renders an absolutely positioned overlay thumb only while the user is scrolling, so showing or hiding the scrollbar never changes row width.

## Project grouping

Workspace-linked conversations are grouped under project rows so repository chats stay together without hiding ordinary chats.

[[src/main/session-cache.ts#syncSessionCache]] attaches each row's context folder in one batched [[src/main/session-context-folder-store.ts#getSessionContextFolders]] read and persists `contextFolder` into the `sessions.json` cache. [[src/main/session-cache.ts#listCachedSessions]] stays a DB-free cache read — it returns the persisted `contextFolder` without re-querying the store. The sidebar groups rows with a `contextFolder` under a Projects section by folder basename, while rows without one remain under Chats.

When [[src/renderer/src/screens/Chat/Chat.tsx#Chat]] saves a session context folder, it emits a renderer event that [[src/renderer/src/screens/Layout/SidebarRecentSessions.tsx]] uses to force-refresh the cache. This keeps project grouping visible immediately after a workspace is linked.

Projects and Chats are top-level collapsible sections, and each project folder can also be expanded or collapsed. [[src/renderer/src/screens/Layout/SidebarRecentSessions.tsx]] persists those disclosure states in `localStorage`; the sidebar CSS keeps section and folder rows on the same left rail, keeps disclosure arrows right-aligned, animates each disclosure with grid-row transitions, and removes hidden rows from keyboard tab order.

## Row context menu

Each sidebar session row exposes a ChatGPT-style options menu — Pin, Rename, Move to project, and Delete — opened from a hover-revealed `…` button or by right-clicking the row.

[[src/renderer/src/screens/Layout/SidebarRecentSessions.tsx]] renders each row as a `div role="button"` (so the trailing `.sidebar-recent-session-options` button is valid nested markup) and tracks the open row in `menuTarget`. [[src/renderer/src/screens/Layout/SidebarSessionMenu.tsx#SidebarSessionMenu]] renders the menu in a `document.body` portal at clamped viewport coordinates so it escapes the sidebar's clipped scroll container, and closes on outside click, Escape, a scroll of the sidebar list's own `scrollContainer`, or window blur. The scroll listener is scoped to that one container (not a global capture listener) so the chat's streaming auto-scroll — which fires window-level scroll events on every chunk — no longer dismisses the menu mid-stream. "Move to project" swaps the menu to a second in-place page listing every distinct context folder (`projectChoices`) plus **New folder…** ([[src/preload/index.ts]] `selectFolder`) and **Remove from project**, rather than a hover flyout.

Transitions are `motion/react`-driven (the same library as [[src/renderer/src/components/modal/AppModal.tsx#AppModal]]): the whole menu fades/scales/blurs from its top-left anchor on open, and an internal `open` flag plays the exit before the parent unmounts it (`AnimatePresence onExitComplete` → `onClose`). Switching between the main and project pages cross-slides them (direction-aware) inside a `.sidebar-session-menu-body` wrapper whose `layout` prop animates the height difference; the wrapper clips the sliding pages. Viewport clamping measures the offset box, not `getBoundingClientRect`, so an in-flight scale/height animation doesn't skew positioning.

Each action calls an existing desktop API with an optimistic local update and rollback on failure: Rename → `updateSessionTitle` (inline `.sidebar-recent-session-rename` input), Move → [[src/main/session-context-folder-store.ts#setSessionContextFolder]] then a `hermes-session-context-folder-changed` event so other surfaces re-group, Delete → a confirmation dialog (portal overlay) then [[src/main/sessions.ts#deleteSessionRows|deleteSession]]. Deleting the open chat calls `onSessionDeleted`, which [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] uses to drop to a fresh New Chat.

Pinned rows are a desktop-only affordance: their ids live in `localStorage` (`hermes.sidebar.pinnedSessions`), and pinned sessions are pulled out of the normal grouping into a collapsible **Pinned** section at the top of the list.

## Full-list modal

The Cmd/Ctrl+K menu action opens an 80%×80% modal that reuses the existing Sessions screen rather than a separate route.

The modal in [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] renders [[src/renderer/src/screens/Sessions/Sessions.tsx]] inside a `.sessions-modal` over the shared `.models-modal-overlay` backdrop. Resuming a session or starting a new chat from the modal closes it; Esc and a backdrop click also close it. Because the Sessions screen owns its own fetching gated on `visible`, it loads only while the modal is open.

## Profile switch and active chat

The footer profile switcher keeps the selected shell profile aligned with the visible chat run, while preserving older conversations under their original profiles.

[[src/renderer/src/screens/Layout/ProfileSwitcher.tsx#ProfileSwitcher]] persists the selected profile through main-process profile switching, then [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] applies [[src/renderer/src/screens/Layout/chatRuns.ts#selectProfileRunTransition]] before rendering Chat. If the active chat is blank, it is re-homed to the selected profile; if it already belongs to another profile, the shell activates an existing blank run for the selected profile or creates a fresh one. This prevents the footer, Settings, recent sessions, and chat transport from disagreeing about which agent is active.

Opening a sidebar session after switching profiles consumes that blank selected-profile run instead of appending beside it. [[src/renderer/src/screens/Layout/chatRuns.ts#openSessionRunTransition]] replaces the active scratch run when it belongs to the same profile as the resumed session, so the tab strip shows the previous session without an extra "New conversation" tab.

The switcher trigger preserves the old app-brand label for an unrenamed default profile: when `listProfiles` returns the fallback `name === id === "default"`, the button shows `common.appName`; once a custom name is stored, it shows that user-facing name.

The same per-profile appearance also drives the agent avatar inside the transcript. [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] passes `getAppearance(run.profile)` to each [[src/renderer/src/screens/Chat/Chat.tsx]] as `agentAppearance`, which forwards `{ name, color, avatar }` through [[src/renderer/src/screens/Chat/MessageList.tsx]] to every [[src/renderer/src/screens/Chat/MessageRow.tsx#HermesAvatar]] (and the reasoning/tool-activity rows in [[src/renderer/src/screens/Chat/HistoryRow.tsx]]). `HermesAvatar` plays the looping `loadingo.gif` only while a turn is generating (`active`); once generation stops it runs out the current gif loop, then swaps to the agent's [[src/renderer/src/components/common/ProfileAvatar.tsx]] so idle turns are identified by who produced them. The live typing indicator has no resolved agent yet, so it falls back to the gif.

### SSH tunnel profile routing

SSH tunnel chat must retarget the tunnel to the selected profile's port before sending a turn — the dashboard port for dashboard transport, or the api_server port on the gateway-only fallback.

The primary path tunnels to the remote **unified machine dashboard** (see [[main-process#SSH dashboard transport]]): ONE dashboard on a single port serves every profile (scoped via `?profile=`), so [[src/main/ipc/register.ts#getSshDashboardSessionConfig]] / [[src/main/dashboard.ts#sshDashboardConnectionFromConfig]] / the send-message preamble all call [[src/main/ssh-tunnel.ts#ensureSshTunnel]] with that **same** port regardless of profile. This is essential: the single global tunnel can only point at one remote port, so per-profile dashboard ports (an earlier attempt) made concurrent profile queries thrash it. On the gateway-only fallback (no dashboard), the tunnel instead targets the profile's `platforms.api_server.extra.port` via [[src/main/ssh-remote.ts#sshResolveApiServerPort]], which auto-allocates and persists a remote profile port when one is missing. Tunnel starts are serialized by target, and stale SSH process exit/error callbacks cannot clear a newer retargeted tunnel.

### Remote launcher profile resolution

Managed SSH installs can store Hermes outside the SSH user's home or under a different `HERMES_HOME`, so Office/Agents must read profiles from the actual remote runtime rather than a `~/.hermes` filesystem scan.

[[src/main/ssh-remote.ts#buildRemoteHermesCmd]] probes per-user launcher hooks (`$HOME/.config/hermes-desktop/remote-hermes`, `$HOME/.hermes/desktop-remote-hermes`) before the default venv/PATH locations, letting a deployment supply its own wrapper that sets the right command, service user, and `HERMES_HOME`. [[src/main/ssh-remote.ts#sshListProfiles]] detects whether such a launcher actually exists in one round trip, then [[src/main/ssh-remote.ts#selectSshProfiles]] treats a present launcher as authoritative — preferring its profiles over the scan even on an equal count, so a managed `default`-only install shows live gateway state instead of stale home-directory data. Named-profile Schedules route the same way through [[src/main/ssh-remote.ts#sshRunCron]], while the default profile keeps the existing HTTP `/api/jobs` path.

Every SSH-invoked `hermes` command resolves the CLI through `buildRemoteHermesCmd`, never a bare `hermes` — a non-interactive SSH shell does not source the profile that puts the CLI on PATH, so a bare invocation fails with "command not found" on otherwise-healthy remotes. This covers gateway lifecycle ([[src/main/ssh-remote.ts#buildGatewayStartCommand]] / [[src/main/ssh-remote.ts#buildGatewayStopCommand]] non-systemd branch, for both named and default profiles), skills ([[src/main/ssh-remote.ts#sshInstallSkill]], [[src/main/ssh-remote.ts#sshUninstallSkill]], [[src/main/ssh-remote.ts#sshSearchSkills]]), and profile create/delete ([[src/main/ssh-remote.ts#sshCreateProfile]] / [[src/main/ssh-remote.ts#sshDeleteProfile]], which also use the **singular** `profile` subcommand). The systemd branch still prefers `systemctl` when a `hermes.service` unit exists, and [[src/main/ssh-remote.ts#buildGatewayStatusCommand]] remains a pid-file liveness check. The non-systemd branch launches the gateway with `gateway run` (foreground, backgrounded via `nohup`), **not** `gateway start` — `gateway start` drives the systemd/launchd service and fails with "Gateway service is not installed" on a bare VPS that never ran `hermes gateway install`, whereas `gateway run` launches the gateway and its api_server directly and writes the pid file the status/stop commands read.

### Remote-mode skills routing

In remote (HTTP) mode the Skills surface must read and mutate the REMOTE machine's skills — the handlers used to fall through to the local CLI, showing (and installing into!) the wrong machine's skills.

[[src/main/remote-skills.ts]] routes the four skills IPC handlers to the dashboard API when `conn.mode === "remote"`: list via `GET /api/skills`, content via `GET /api/skills/content?name=`, install/uninstall via `POST /api/skills/hub/install|uninstall`. Remote skills are keyed by NAME + PROFILE on the API but the desktop keys content lookups by path alone, so listed skills carry a `remote-skill:<profile>:<name>` marker path ([[src/main/remote-skills.ts#remoteSkillPath]]) that [[src/main/remote-skills.ts#remoteGetSkillContent]] unwraps. The profile MUST ride in the path (mirroring how local/SSH paths carry the full location) — the content IPC has no profile argument, and falling back to the globally active profile would query the wrong profile whenever the Skills screen is scoped to a named one. Named profiles ride as `?profile=` (the unified-dashboard scoping convention); `default` sends no param. All query params go through `URL.searchParams` so encoding stays consistent whether or not a profile param is appended.

Two deliberate asymmetries: bundled skills stay local in remote mode (that list is the shipped catalog, not per-machine state), and the hub install/uninstall endpoints SPAWN the CLI on the remote and return `{ok, pid}` immediately — success means "started", not "completed", unlike the local/SSH paths which await and classify the CLI output.

## Profiles page

The Profiles page lists every workspace as table-style rows and creates new ones from a modal that can clone a chosen source profile.

[[src/renderer/src/screens/Agents/Agents.tsx]] renders one `agents-row` per profile (avatar, user-facing `name`, stable `id` when it differs, `provider · skills`, a monospace model chip, and a `Running`/`Off` gateway pill), marking the active profile with a left green bar. Selecting a row switches by profile `id` ([[src/main/ipc/register.ts#registerIpcHandlers]]'s `set-active-profile`), which starts that profile's gateway asynchronously — so the status reads from a pid file that isn't written yet at switch time. In **SSH mode** this persists the selection to the local `~/.hermes/active_profile` (so it survives relaunch instead of resetting to `default`) and starts the profile's gateway on the remote via [[src/main/ssh-remote.ts#sshStartGateway]] (previously SSH was a no-op, so named-profile gateways never started and the selection never stuck). [[src/main/profiles.ts#setActiveProfile]] guarantees that persistence with a read-back fallback: the local `hermes profile use` CLI raises when the profile exists only on the remote (or there is no local install) and that error is swallowed, so when the CLI didn't move `active_profile`, the desktop writes the file directly — otherwise the selection silently never persisted and `activeSshProfile()` scoped the unified dashboard's data to `default`. `list-profiles` over SSH also overrides `isActive` from the local active profile (not the remote CLI's `◆` marker) so the persisted selection is the one highlighted. The page therefore polls `listProfiles` (~700ms, capped near 10s) after a switch until the selected profile reports running, flipping its pill to `Running` on its own rather than only after a manual refresh or revisit. While that poll runs (and the gateway wasn't already up), the switched row shows a `Starting…` pill with a spinner; it settles on the real `Running`/`Off` status once the gateway reports in or the poll gives up. **New Agent** opens an [[src/renderer/src/components/modal/AppModal.tsx#AppModal]] with a user-facing agent-name field, a "clone config & API keys" toggle, and — when cloning — a source-profile `<select>` defaulting to the active profile id. Create calls `window.hermesAPI.createProfile(name, cloneFrom)` where `name` is the user-facing label and `cloneFrom` is the chosen source id or `null` for a fresh profile; the modal stays open on failure so the error is visible and the user can retry. [[src/main/profiles.ts#createProfile]] generates a CLI-safe internal id from that label, stores the label as profile metadata, then maps a non-null `cloneFrom` to the agent CLI's `hermes profile create <id> --clone-from <source>` (which implies `--clone`), validating the source as `default` or a valid named profile. Once the CLI create succeeds, metadata write failures are logged and treated as display-only degradation so the desktop does not report a false create failure or nudge a retry that would generate a second id. [[src/main/ssh-remote.ts#sshCreateProfile]] keeps the remote create path's `{ success, error }` shape and surfacing behavior. [[src/main/registry.ts]] installs a published agent by cloning from `default`.

The profile modal's inline name editor saves on Enter/blur, but Escape is a real cancel path: it restores the current saved name and suppresses the blur-save that browsers fire as the input unmounts.

## Office profile labels

The Office scene shows each profile's user-facing name while keeping profile ids stable for routing.

[[src/renderer/src/screens/Office/Office.tsx]] loads profiles through `listProfiles()` and maps them with [[src/renderer/src/screens/Office/office3d/agents.ts#profileToOfficeAgent]]. The mapped Office agent keeps `id = profile.id` for selection, CEO persistence, and One Chat routing, but uses `profile.name` as `agent.name`, so the 3D speech bubble, details sidebar, and One Chat labels match the renamed agent. The visible-tab poll uses [[src/renderer/src/screens/Office/office3d/agents.ts#officeAgentsChanged]] so name changes refresh without requiring a manual Office reload.

## Profile detail modal

A single global modal (80vw × 80vh) with a left-section nav views and edits a profile, opened from anywhere via a context hook so future profile features share one surface.

[[src/renderer/src/components/profile/ProfileModalProvider.tsx#ProfileModalProvider]] mounts [[src/renderer/src/components/profile/ProfileModal.tsx#ProfileModal]] at the app root and exposes `openProfile(id, opts)` through [[src/renderer/src/components/profile/ProfileModalContext.ts#useProfileModal]]. The sidebar popover's active profile (a button in [[src/renderer/src/screens/Layout/ProfileSwitcher.tsx#ProfileSwitcher]]) and each profile row's edit control in [[src/renderer/src/screens/Agents/Agents.tsx]] both call `openProfile`, passing `onChanged` to refresh their lists and `onDeleted` to fall back to the default profile when the active one is removed. `opts.initialSection` deep-links to a specific left-nav section on open — the Office tab's bank ATMs use it to jump straight to **Wallet** (see [[office-3d-interiors#Office 3D Interiors#Interactables]]). The header shows the profile avatar and user-facing name; the icon'd left nav (`PROFILE_SECTIONS`) switches the right pane between **Profile** (inline name editing in the identity title, avatar upload/remove, colour, and lucide provider/model/skills/gateway chips), **Persona** (a profile-scoped copy of [[src/renderer/src/screens/Soul/Soul.tsx#Soul]]), **Agent Memory** (a profile-scoped copy of [[src/renderer/src/screens/Memory/MemoryEntries.tsx#MemoryEntries]] loaded through `readMemory(profile.id)`), **Wallet** (a profile-scoped Base wallet pane in [[src/renderer/src/components/profile/ProfileWalletPane.tsx#ProfileWalletPane]]), and **Advanced** (the delete danger zone). Every profile — including default — is editable; only the default profile can't be deleted, so its Advanced pane just says so. The modal self-loads via `listProfiles()` and re-reads after every mutation, replacing the former inline `agents-appearance` modal.

Agent names are desktop metadata in `profile-meta.json`, surfaced as `ProfileInfo.name` from [[src/main/profiles.ts#listProfiles]] and mutated through [[src/main/profile-meta.ts#setProfileName]]. They do not rename the stable profile id or directory, so profile-scoped memory, wallets, sessions, active profile selection, and gateway routing continue to use `profile.id`. If the save IPC rejects, the inline editor remains open, clears its Saving tag, and shows the name-update error instead of trapping the user in a pending state.

Legacy renderer state can still contain a run without a profile id during upgrades. Profile avatars and the active-session strip treat a missing profile as `default`, and profile-name IPC handlers accept omitted names as an empty value, so stale state cannot trip a `.trim()` exception and black-screen the app.

### Profile wallets

Profile wallets are local Base-network Ethereum wallets, capped per profile and kept separate from chat/provider credentials.

[[src/renderer/src/components/profile/ProfileWalletPane.tsx#ProfileWalletPane]] lists public wallet metadata from `listWallets(profile)`, opens a create/import modal, and only displays a recovery phrase in the one-time success state after `createWallet` or `importWallet`. [[src/main/wallet-store.ts#createWallet]] generates a BIP-39 recovery phrase with Node crypto entropy, derives the Ethereum address with `ethers`, and stores public metadata plus an encrypted recovery phrase in `wallets.json` under the profile home. [[src/main/wallet-store.ts#importWallet]] validates an existing recovery phrase, rejects duplicate addresses in the same profile, and uses the same Base wallet metadata shape from [[src/shared/wallets.ts#ProfileWallet]].

### Shared modal shell

Reusable modals use a single animated shell so dialogs open and close consistently.

[[src/renderer/src/components/modal/AppModal.tsx#AppModal]] wraps Radix Dialog with Motion's `AnimatePresence`, keeping focus trapping, escape/outside-close behavior, and exit transitions in one memoized component. The shell keeps its Radix portal present through the exit phase and animates the backdrop plus content with visible fade, scale, slide, and blur. Profile modal is the first consumer: [[src/renderer/src/components/profile/ProfileModalProvider.tsx#ProfileModalProvider]] keeps its target profile mounted until `AppModal` finishes the close animation, then clears the modal state.

## Footer action row

Administrative destinations sit beside the profile switcher so the conversation nav stays short.

[[src/renderer/src/screens/Layout/Layout.tsx#Layout]] keeps Providers, Gateway, Tools, and Memory out of the main sidebar list and renders them as icon-only footer actions immediately above [[src/renderer/src/screens/Layout/ProfileSwitcher.tsx#ProfileSwitcher]]. Each button exposes a styled hover/focus tooltip and accessible label, preserving discoverability while freeing vertical room for recent conversations. Settings is no longer a `View`: its footer gear button opens the global settings modal (below) instead of switching panes.

When the sidebar is collapsed, those footer actions stay in a single centered icon rail anchored to the bottom of the 64px sidebar, with the compact profile switcher below them and no divider line above the footer.

## Settings modal

A single global modal (80vw × 80vh) with a grouped left nav presents every app/agent setting, opened from anywhere rather than as a sidebar tab.

[[src/renderer/src/components/settings/SettingsModalProvider.tsx#SettingsModalProvider]] mounts [[src/renderer/src/components/settings/SettingsModal.tsx]] at the app root (inside `ProfileModalProvider`) and exposes `openSettings(section?, { profile })` through [[src/renderer/src/components/settings/SettingsModalContext.ts#useSettingsModal]]. Three entry points call it: the sidebar-footer gear, the `/settings` command's `onOpenDiagnose` path, and a global **Cmd/Ctrl+,** keydown handler in [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] — each passes the active profile so the modal reads/writes the right config. The modal reuses the shared [[src/renderer/src/components/modal/AppModal.tsx#AppModal]] shell (see [[sidebar-navigation#Profile detail modal#Shared modal shell]]).

The left nav is two labelled groups — **General** (Appearance, Language, Privacy, Connection, Data) and **Hermes Agent** (About & Updates, Community, Logs & Diagnostics) — and `SETTINGS_NAV`/`resolveSection` in [[src/renderer/src/components/settings/SettingsModal.tsx]] map ids to panes. Network settings (Force IPv4 + proxy) are not a separate tab: they apply to every outgoing connection, so they live as a `Network` subsection at the bottom of [[src/renderer/src/components/settings/ConnectionPane.tsx]], and `resolveSection` aliases the legacy `/settings network` argument to the Connection pane. All shared state, the config-load effect, and the mutation handlers live in [[src/renderer/src/components/settings/useSettingsData.ts#useSettingsData]] (relocated wholesale from the former `Settings` screen) and reach each pane through [[src/renderer/src/components/settings/SettingsDataContext.ts#useSettings]], so the panes (`AppearancePane`, `ConnectionPane`, `AboutPane`, …) stay purely presentational. One exception: `AppearancePane`'s hardware-acceleration field reads `getGpuStatus` from the preload bridge directly, because GPU state is per-launch main-process state rather than profile config (see [[main-process#GPU Fallback#User preference]]). The modal's chrome is `user-select: none` (drag-selection highlighting nav labels and field captions read as broken UI); form fields and `pre`/`code` output — notably the Logs pane — opt back into text selection so they stay copyable.

## Provisional fresh sessions

Fresh chat session ids are provisional until a turn produces output or completes successfully, so provider errors do not create visible recent-session rows.

The main-process transports still send a generated `X-Hermes-Session-Id` on fresh requests to avoid gateway fingerprint collisions, but [[src/main/hermes.ts#sendMessageViaApi]] and the runs transport announce that id to the renderer only after visible output, tool/reasoning activity, or successful completion. Resumed sessions are announced immediately because the renderer already knows they are existing conversations. This keeps [[src/renderer/src/screens/Chat/hooks/useChatIPC.ts#useChatIPC]] from binding a failed first turn to a new sidebar entry.
