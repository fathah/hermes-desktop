# Project code workspace

Linked project folders open into a docked, tabbed code workspace so users can inspect and make small source edits without leaving the conversation.

## Docked explorer and tabs

The file tree expands into a resizable editor dock after the first file opens, preserving the compact explorer when no document is active.

[[src/renderer/src/screens/Chat/WorktreePanel.tsx#WorktreePanel]] owns the ordered open-file list and active tab. Reopening a file deduplicates it, closing the active tab selects its nearest neighbor, and changing the linked folder clears the old workspace.

[[src/renderer/src/screens/Chat/FileViewer.tsx#FileViewer]] renders Codex-style document tabs, a project-relative breadcrumb, View/Edit controls, dirty markers, file status, image previews, and binary-file fallbacks.

## Editing engine

Text files use CodeMirror 6 for line numbers, syntax parsing, selection, history, indentation, search, folding, and platform-native `Cmd/Ctrl+S` saving.

[[src/renderer/src/screens/Chat/CodeEditor.tsx#CodeEditor]] lazy-loads only when a text file opens. JavaScript, TypeScript, JSX, JSON, CSS, HTML, Markdown, and Python receive language support; unknown formats remain editable plain text.

Truncated files stay read-only because saving a partial buffer would erase the unseen tail. Images remain previews and known binary formats direct users to the default application.

## Capability-bound saves

Saving uses an opaque, owner-bound edit capability rather than accepting a renderer-provided destination path.

[[src/main/workspace-file-access.ts#WorkspaceFileAccess]] canonicalizes the selected workspace and file, rejects traversal and symlink escapes, bounds reads, and issues a random token only for a complete regular file. The token is bound to the requesting Electron renderer and released when that renderer is destroyed.

The `save-file` IPC handler accepts only the token and new text. It is local-mode only, limits edited content to 1 MiB, verifies that the on-disk content still matches the read snapshot, and replaces the file atomically while retaining its permissions.

## Draft and conflict safety

Each open tab retains its own saved text, current draft, edit mode, dirty state, and save status while users switch between files.

Closing a dirty tab requires confirmation. Save failures preserve the draft, and an external on-disk change returns a stale conflict instead of overwriting newer work. Successful saves advance the token snapshot so the same tab can save repeatedly.
