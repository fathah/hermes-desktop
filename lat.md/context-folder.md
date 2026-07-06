# Linked working folder

A conversation can be bound to a working folder (issue #27) — a desktop-only binding that scopes the agent's work. It is sent to the agent per message as a system message, and persisted per session so re-opening a conversation restores its folder.

## Desktop-only persistence

The folder isn't part of hermes-agent's session schema, so it lives in a desktop-owned table in the active profile's `state.db`, keyed by `session_id`.

[[src/main/session-context-folder-store.ts]] holds `desktop_session_context_folders` (mirroring [[src/main/session-continuation-store.ts]]): [[src/main/session-context-folder-store.ts#setSessionContextFolder]] upserts or, for a null folder, deletes the row; [[src/main/session-context-folder-store.ts#getSessionContextFolder]] reads it. The row is dropped with the rest of a session's data in [[src/main/sessions.ts#deleteSessionRows]] so a deleted session leaves no orphan binding.

## Restore and save in the chat

The chat loads the stored folder when resuming a session and saves it whenever it changes, once the conversation has a gateway session id.

In [[src/renderer/src/screens/Chat/Chat.tsx#Chat]] a load effect fetches the folder for `initialSessionId` on mount; a save effect writes `contextFolder` via `setSessionContextFolder` on every change. The save is gated on a "loaded" ref so the initial null can't overwrite a resumed session's stored folder before the load resolves. A brand-new chat saves once its session id resolves after the first message, binding the pre-selected folder to the new session.

## Recent folders dropdown

The context folder picker displays recently used project folders first, allowing quick selection across sessions without opening the OS folder dialog.

[[src/renderer/src/screens/Chat/ContextFolderChip.tsx#ContextFolderChip]] presents a dropdown menu populated by [[src/main/session-context-folder-store.ts#getRecentSessionContextFolders]] via the `list-recent-session-context-folders` IPC channel, combining distinct database folder bindings with cached session paths.

## Resizable tree panel

The context-folder tree panel uses a compact header and can be resized from its left edge, mirroring the in-app browser panel.

[[src/renderer/src/screens/Chat/WorktreePanel.tsx#WorktreePanel]] stores its width in `localStorage` under `hermes:worktreePanelWidth`, clamps it between a usable minimum and the available chat width, and updates it through a pointer-drag handle styled by `.worktree-resize-handle`.

## Remote folder picker

Remote and SSH chats use an in-app picker so users do not accidentally select a local macOS folder for a remote session.

[[src/renderer/src/screens/Chat/RemoteFolderPicker.tsx#RemoteFolderPicker]] provides a scrollable folder list, horizontally scrollable breadcrumbs, manual path entry, Escape-to-close, and arrow/Enter keyboard navigation. [[src/main/ipc/register.ts#registerIpcHandlers]] routes `read-directory` to [[src/main/ssh-remote.ts#sshReadDirectory]] for SSH connections and returns no listing for pure Remote Gateway mode until the backend exposes a directory-list endpoint, so the picker still allows typed remote paths.

## Muted tree icons

The tree keeps file-type icon shapes but normalizes their colors so the explorer reads quietly in the chat sidebar.

The `@wesbos/code-icons` SVGs render inside `.worktree-file-icon-wrapper`; CSS overrides inline fills/strokes to `currentColor` while preserving `fill:none` outlines, and folder icons use the same low-opacity white tone.
