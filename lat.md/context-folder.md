# Linked working folder

A conversation can be bound to a working folder (issue #27) — a desktop-owned binding that scopes the agent's tools and persists per session so re-opening a conversation restores its folder.

## Runtime working directory

The selected folder is applied as the agent runtime's real working directory before a local turn, including when a stored Hermes session is resumed.

[[src/main/hermes.ts#moveTuiStoredSessionContextFolder]] moves a stored workspace before TUI resume, then [[src/main/hermes.ts#syncTuiSessionContextFolder]] verifies the live cwd before prompt submission. If a live session changes folders, it is closed and resumed once so Hermes rebuilds its cached system prompt with the new cwd.

The renderer hydrates a resumed run's folder before mounting Chat. Its dashboard transport also closes and resumes an already-built runtime after `session.cwd.set`, preventing tools from using the project while the cached prompt still names the Hermes install tree.

If the TUI transport is unavailable, [[src/main/hermes.ts#localChatWorkingDirectory]] anchors CLI fallback with both its process `cwd` and `TERMINAL_CWD`; local project chats do not fall through to an API transport that can only describe the folder in prompt text.

## Desktop-only persistence

The folder isn't part of hermes-agent's session schema, so it lives in a desktop-owned table in the active profile's `state.db`, keyed by `session_id`.

[[src/main/session-context-folder-store.ts]] holds `desktop_session_context_folders` (mirroring [[src/main/session-continuation-store.ts]]): [[src/main/session-context-folder-store.ts#setSessionContextFolder]] upserts or, for a null folder, deletes the row; [[src/main/session-context-folder-store.ts#getSessionContextFolder]] reads it. The row is dropped with the rest of a session's data in [[src/main/sessions.ts#deleteSessionRows]] so a deleted session leaves no orphan binding.

## Restore and save in the chat

The chat loads the stored folder when resuming a session and saves it whenever it changes, once the conversation has a gateway session id.

In [[src/renderer/src/screens/Chat/Chat.tsx#Chat]] a load effect fetches the folder for `initialSessionId` on mount; a save effect writes `contextFolder` via `setSessionContextFolder` on every change. The save is gated on a "loaded" ref so the initial null can't overwrite a resumed session's stored folder before the load resolves. A brand-new chat saves once its session id resolves after the first message, binding the pre-selected folder to the new session.

## Recent folders dropdown

The context folder picker displays recently used project folders first, allowing quick selection across sessions without opening the OS folder dialog.

[[src/renderer/src/screens/Chat/ContextFolderChip.tsx#ContextFolderChip]] presents a dropdown menu populated by [[src/main/session-context-folder-store.ts#getRecentSessionContextFolders]] via the `list-recent-session-context-folders` IPC channel, combining distinct database folder bindings with cached session paths.

## Resizable project workspace

The context-folder tree starts compact and expands into a resizable, tabbed [[code-editor]] when a project file opens.

[[src/renderer/src/screens/Chat/WorktreePanel.tsx#WorktreePanel]] stores the expanded dock width in `localStorage` under `hermes:worktreePanelWidth`, clamps it between usable limits, and updates it through the left pointer-drag handle. Closing every file returns the dock to the compact tree width.

## Integrated terminal

Local project chats expose an interactive bottom terminal below the composer, keeping shell work inside Hermes and rooted in the selected project folder.

[[src/renderer/src/screens/Chat/IntegratedTerminalPanel.tsx#IntegratedTerminalPanel]] renders a full-width xterm drawer after the chat input, fits the emulator as its top edge is dragged vertically, and leaves the browser side panel available at the same time. Its default 240px height is also the resize minimum, so saved or dragged sizes never collapse it below a useful working area. `Ctrl+\`` toggles the drawer in the active local project chat, including while xterm is focused; repeats and modified variants are ignored. Its complete normal and bright ANSI palette keeps prompts, commands, and status output colorful and readable against the dark terminal background. Clicks explicitly return focus to xterm, early keystrokes buffer until the PTY session is ready, and steady-state input uses one-way IPC to avoid per-character request latency. [[src/main/integrated-terminal.ts#startIntegratedTerminal]] validates the folder and owns the PTY process; sessions are bound to their renderer owner and are stopped when the drawer, renderer, or app closes. The native PTY module loads only when a terminal starts, so an ABI problem cannot crash desktop startup; install and development scripts rebuild native dependencies for Electron. Remote and SSH chats keep the control disabled because their paths do not belong to the local machine.

## Remote folder picker

Remote and SSH chats use an in-app picker so users do not accidentally select a local macOS folder for a remote session.

[[src/renderer/src/screens/Chat/RemoteFolderPicker.tsx#RemoteFolderPicker]] provides a scrollable folder list, horizontally scrollable breadcrumbs, manual path entry, Escape-to-close, and arrow/Enter keyboard navigation. [[src/main/ipc/register.ts#registerIpcHandlers]] routes `read-directory` to [[src/main/ssh-remote.ts#sshReadDirectory]] for SSH connections and returns no listing for pure Remote Gateway mode until the backend exposes a directory-list endpoint, so the picker still allows typed remote paths.

## Muted tree icons

The tree keeps file-type icon shapes but normalizes their colors so the explorer reads quietly in the chat sidebar.

The `@wesbos/code-icons` SVGs render inside `.worktree-file-icon-wrapper`; CSS overrides inline fills/strokes to `currentColor` while preserving `fill:none` outlines, and folder icons use the same low-opacity white tone.
