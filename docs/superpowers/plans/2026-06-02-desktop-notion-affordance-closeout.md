# Desktop Notion Affordance Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining Notion-style workspace affordance gaps with tested renderer interactions on top of the existing local-first workspace APIs.

**Architecture:** Keep the already-added page graph, database, template, synced-block, search, history, and proposal APIs. Add focused renderer components and small main-process extensions only where the UI needs durable state, especially hunk-level proposal actions and comments/reminders. Avoid Hermes Agent engine changes.

**Tech Stack:** Electron, React, TypeScript, TipTap, YAML, Vitest, Testing Library.

---

## Files

- Modify `src/renderer/src/screens/Workspace/WorkspaceEditor.tsx`: use block IDs, block controls, inline menus.
- Create `src/renderer/src/screens/Workspace/BlockHandleBar.tsx`: duplicate/delete/turn/color/move controls for Markdown blocks.
- Create `src/renderer/src/screens/Workspace/PageMentionMenu.tsx`: searchable `@` and `[[` insertion menu.
- Modify `src/renderer/src/screens/Workspace/DatabaseBlock.tsx`: database search, settings panel, row open actions.
- Create `src/renderer/src/screens/Workspace/DatabaseSettingsPanel.tsx`: filter/sort/group/property visibility/open mode controls.
- Create `src/renderer/src/screens/Workspace/DatabaseRowPeek.tsx`: side peek row page editor.
- Modify `src/main/workspace.ts`: hunk-level proposal accept/reject helpers.
- Modify `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`: hunk action IPC/preload surface.
- Modify `src/renderer/src/screens/Workspace/AgentReviewPanel.tsx`: per-hunk accept/reject/apply-all controls.
- Create `src/main/workspace-comments.ts`: comments and reminders store.
- Create `src/renderer/src/screens/Workspace/WorkspaceCommentsPanel.tsx`: comments/reminders UI.
- Create `src/renderer/src/screens/Workspace/WorkspaceSyncedBlocksPanel.tsx`: synced block creation/list/unsync UI.
- Modify `src/renderer/src/screens/Workspace/PageCreateDialog.tsx`: template picker.
- Create `src/renderer/src/screens/Workspace/WorkspaceOfflinePanel.tsx`: local status panel.
- Modify `src/renderer/src/screens/Workspace/CommandPalette.tsx`: filters, command execution, open in tab/window actions.
- Add tests beside components plus `tests/workspace-comments.test.ts` and proposal hunk tests.

## Tasks

### Task 1: Block Controls And Inline Menus

- [x] Write tests for `BlockHandleBar` duplicate/delete/turn/color/move callbacks.
- [x] Write tests for `PageMentionMenu` filtering and insert callbacks.
- [x] Implement `BlockHandleBar.tsx`.
- [x] Implement `PageMentionMenu.tsx`.
- [x] Integrate both into `WorkspaceEditor.tsx`.
- [x] Validate with `npm test -- src/renderer/src/screens/Workspace/BlockHandleBar.test.tsx src/renderer/src/screens/Workspace/PageMentionMenu.test.tsx tests/workspace-blocks.test.ts`.

### Task 2: Database Settings And Row Peek

- [x] Write renderer tests for database search, filtered display, row side peek, row page edit, and open mode controls.
- [x] Implement `DatabaseSettingsPanel.tsx`.
- [x] Implement `DatabaseRowPeek.tsx`.
- [x] Update `DatabaseBlock.tsx` to show settings/search/row open buttons.
- [x] Validate with `npm test -- src/renderer/src/screens/Workspace/DatabaseBlock.test.tsx tests/workspace-database.test.ts`.

### Task 3: Hunk-Level Agent Review

- [x] Extend proposal tests for `acceptAgentWorkspaceProposalHunk` and `rejectAgentWorkspaceProposalHunk`.
- [x] Implement hunk-level helpers in `src/main/workspace.ts`.
- [x] Wire IPC/preload/types.
- [x] Update `AgentReviewPanel.tsx` with hunk accept/reject/apply-all.
- [x] Validate with `npm test -- tests/workspace-meta.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts`.

### Task 4: Templates, Synced Blocks, Comments, Reminders, Status

- [x] Add comments/reminders main-process tests.
- [x] Implement `workspace-comments.ts` and IPC/preload/types.
- [x] Add template picker to page creation.
- [x] Add `WorkspaceSyncedBlocksPanel.tsx`.
- [x] Add `WorkspaceCommentsPanel.tsx`.
- [x] Add `WorkspaceOfflinePanel.tsx`.
- [x] Validate with component tests plus `npm test -- tests/workspace-templates.test.ts tests/workspace-synced-blocks.test.ts tests/workspace-comments.test.ts`.

### Task 5: Command Palette Actions

- [x] Write tests for command result execution, search scopes, copy link, and open-in-tab/window callbacks.
- [x] Add filter controls and action buttons to `CommandPalette.tsx`.
- [x] Preserve keyboard navigation.
- [x] Validate with `npm test -- src/renderer/src/screens/Workspace/CommandPalette.test.tsx`.

### Task 6: Final Validation

- [x] Run `npm test`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Commit all closeout slices.

## Acceptance Criteria

- Every previously listed gap has at least one implemented UI surface or durable state API.
- New behavior is covered by focused tests.
- Existing workspace APIs remain backward compatible.
- Full validation passes, with only existing lint warnings if any.

## Deliberate Simplifications

- “True Notion parity” is interpreted as local-first functional affordances, not pixel-perfect Notion behavior.
- Block drag/reorder is implemented through explicit move controls unless a full drag implementation is already low-risk.
- Calendar/timeline remain local renderers based on date fields; no external calendar sync.
- Comments/reminders are local workspace metadata, not system notifications or automations.
