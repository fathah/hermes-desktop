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

### SSH tunnel profile routing

SSH tunnel chat must retarget the tunnel to the selected profile's configured API port before sending a turn.

[[src/main/ipc/register.ts]] resolves the selected profile's remote `platforms.api_server.extra.port` and calls [[src/main/ssh-tunnel.ts#ensureSshTunnel]] with that port before legacy/basic SSH chat sends. [[src/main/ssh-remote.ts#sshResolveApiServerPort]] auto-allocates and persists a remote profile port when one is missing, while [[src/main/dashboard.ts]] applies the same profile-aware tunnel resolution before dashboard-over-SSH probes. This prevents a dashboard fallback from reusing a default-profile tunnel and making non-default profile chats answer as default.

## Profile detail modal

A single global modal (80vw × 80vh) with a left-section nav views and edits a profile, opened from anywhere via a context hook so future profile features share one surface.

[[src/renderer/src/components/profile/ProfileModalProvider.tsx#ProfileModalProvider]] mounts [[src/renderer/src/components/profile/ProfileModal.tsx#ProfileModal]] at the app root and exposes `openProfile(name, opts)` through [[src/renderer/src/components/profile/ProfileModalContext.ts#useProfileModal]]. The sidebar popover's active profile (a button in [[src/renderer/src/screens/Layout/ProfileSwitcher.tsx#ProfileSwitcher]]) and each card's edit control in [[src/renderer/src/screens/Agents/Agents.tsx]] both call `openProfile`, passing `onChanged` to refresh their lists and `onDeleted` to fall back to the default profile when the active one is removed. The header shows the profile avatar and name; the icon'd left nav (`PROFILE_SECTIONS`) switches the right pane between **Profile** (avatar upload/remove, colour, and lucide provider/model/skills/gateway chips), **Persona** (a profile-scoped copy of [[src/renderer/src/screens/Soul/Soul.tsx#Soul]]), **Agent Memory** (a profile-scoped copy of [[src/renderer/src/screens/Memory/MemoryEntries.tsx#MemoryEntries]] loaded through `readMemory(profile.name)`), **Wallet** (a profile-scoped Base wallet pane in [[src/renderer/src/components/profile/ProfileWalletPane.tsx#ProfileWalletPane]]), and **Advanced** (the delete danger zone). Every profile — including default — is editable; only the default profile can't be deleted, so its Advanced pane just says so. The modal self-loads via `listProfiles()` and re-reads after every mutation, replacing the former inline `agents-appearance` modal.

### Profile wallets

Profile wallets are local Base-network Ethereum wallets, capped per profile and kept separate from chat/provider credentials.

[[src/renderer/src/components/profile/ProfileWalletPane.tsx#ProfileWalletPane]] lists public wallet metadata from `listWallets(profile)`, opens a create/import modal, and only displays a recovery phrase in the one-time success state after `createWallet` or `importWallet`. [[src/main/wallet-store.ts#createWallet]] generates a BIP-39 recovery phrase with Node crypto entropy, derives the Ethereum address with `ethers`, and stores public metadata plus an encrypted recovery phrase in `wallets.json` under the profile home. [[src/main/wallet-store.ts#importWallet]] validates an existing recovery phrase, rejects duplicate addresses in the same profile, and uses the same Base wallet metadata shape from [[src/shared/wallets.ts#ProfileWallet]].

### Shared modal shell

Reusable modals use a single animated shell so dialogs open and close consistently.

[[src/renderer/src/components/modal/AppModal.tsx#AppModal]] wraps Radix Dialog with Motion's `AnimatePresence`, keeping focus trapping, escape/outside-close behavior, and exit transitions in one memoized component. The shell keeps its Radix portal present through the exit phase and animates the backdrop plus content with visible fade, scale, slide, and blur. Profile modal is the first consumer: [[src/renderer/src/components/profile/ProfileModalProvider.tsx#ProfileModalProvider]] keeps its target profile mounted until `AppModal` finishes the close animation, then clears the modal state.

## Footer action row

Administrative destinations sit beside the profile switcher so the conversation nav stays short.

[[src/renderer/src/screens/Layout/Layout.tsx#Layout]] keeps Providers, Settings, Gateway, Capabilities, and Memory out of the main sidebar list and renders them as icon-only footer actions immediately above [[src/renderer/src/screens/Layout/ProfileSwitcher.tsx#ProfileSwitcher]]. Each button exposes a styled hover/focus tooltip and accessible label, preserving discoverability while freeing vertical room for recent conversations.

When the sidebar is collapsed, those footer actions stay in a single centered icon rail anchored to the bottom of the 64px sidebar, with the compact profile switcher below them and no divider line above the footer.

## Provisional fresh sessions

Fresh chat session ids are provisional until a turn produces output or completes successfully, so provider errors do not create visible recent-session rows.

The main-process transports still send a generated `X-Hermes-Session-Id` on fresh requests to avoid gateway fingerprint collisions, but [[src/main/hermes.ts#sendMessageViaApi]] and the runs transport announce that id to the renderer only after visible output, tool/reasoning activity, or successful completion. Resumed sessions are announced immediately because the renderer already knows they are existing conversations. This keeps [[src/renderer/src/screens/Chat/hooks/useChatIPC.ts#useChatIPC]] from binding a failed first turn to a new sidebar entry.
