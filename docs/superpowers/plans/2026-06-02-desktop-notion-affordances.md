# Desktop Notion Affordances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Electron desktop workspace from a local Markdown/database foundation into a Notion-style, agent-first workspace with real page, block, database, search, history, and agent review affordances.

**Architecture:** Keep the app local-first. Main-process workspace modules own filesystem state, metadata, history, page graph, templates, proposals, and database migrations. Renderer components own interaction affordances and call preload APIs only; Hermes Agent engine changes are out of scope except for consuming local workspace context and reviewable proposals.

**Tech Stack:** Electron, React, TypeScript, TipTap, YAML, chokidar, Vitest, Testing Library, existing preload IPC boundary.

---

## Scope And Constraints

- This plan is for `/Users/amar/Desktop/MyCode/fathah_hermes`, the Electron desktop app that connects to Hermes Agent.
- Do not add Notion API sync, cloud collaboration, remote SSH sync, or production Hermes Agent engine changes.
- Preserve existing file APIs for backward compatibility.
- Keep local workspace files under the resolved Hermes profile workspace.
- Implement small, verified vertical slices. Commit after each task.
- Reference basis: Notion docs for sidebar/subpages, slash commands, search, database views/properties, version history, offline pages, synced blocks, buttons/automations, comments/reminders, suggested edits, and Notion Agent.

## File Structure

- Modify `src/main/workspace.ts`: keep path safety and file operations; delegate page graph, history, proposals, templates, synced blocks, and database-specific work to focused modules.
- Create `src/main/workspace-page-graph.ts`: page IDs, parent/child order, backlinks, aliases, recents, favorites, trash, sidebar collapsed state.
- Create `src/main/workspace-history.ts`: snapshots, restore, version metadata, content diff summaries.
- Create `src/main/workspace-proposals.ts`: block-level agent proposal queue and accept/reject/apply-all operations.
- Create `src/main/workspace-templates.ts`: page templates, database row templates, button/workflow templates.
- Create `src/main/workspace-synced-blocks.ts`: synced block registry, references, update propagation.
- Create `src/main/workspace-database.ts`: YAML database migration, validation, view settings, filters, sorts, row pages.
- Modify `src/main/index.ts`: register new IPC handlers.
- Modify `src/preload/index.ts` and `src/preload/index.d.ts`: expose typed APIs.
- Modify `src/renderer/src/screens/Workspace/Workspace.tsx`: orchestrate page state, tabs/history, agent review, templates, offline/status panels.
- Modify `src/renderer/src/screens/Workspace/WorkspaceEditor.tsx`: replace static snippets with block-aware commands and menus.
- Create `src/renderer/src/screens/Workspace/blockExtensions.ts`: TipTap extensions for block IDs, handles, slash commands, synced blocks, links, comments, and suggestions.
- Create `src/renderer/src/screens/Workspace/BlockCommandMenu.tsx`: `/`, inline `+`, turn-into, color, duplicate/delete/move commands.
- Create `src/renderer/src/screens/Workspace/PageMentionMenu.tsx`: `@` and `[[` page/person/date/reminder/link insertion.
- Modify `src/renderer/src/screens/Workspace/WorkspaceTree.tsx`: polished page tree, subpage creation, reorder, collapsible sections, resize/collapse.
- Modify `src/renderer/src/screens/Workspace/WorkspaceHeader.tsx`: breadcrumbs, page menu, template, history, offline, publish/export actions.
- Modify `src/renderer/src/screens/Workspace/CommandPalette.tsx`: ranked search, filters, quick actions, command execution, open tab/window.
- Modify `src/renderer/src/screens/Workspace/DatabaseBlock.tsx`: render true table/board/list/gallery/calendar/timeline and settings.
- Create `src/renderer/src/screens/Workspace/DatabaseSettingsPanel.tsx`: view settings, filters, sorts, grouping, property visibility, open mode.
- Create `src/renderer/src/screens/Workspace/DatabaseRowPeek.tsx`: side/center/full row page editing.
- Create `src/renderer/src/screens/Workspace/AgentSuggestedEditsPanel.tsx`: block-level suggested edits, comments, accept/reject.
- Create `src/renderer/src/screens/Workspace/WorkspaceActivityPanel.tsx`: activity/provenance timeline.
- Create `src/renderer/src/screens/Workspace/WorkspaceTemplatesPanel.tsx`: page/database template picker.
- Create or update tests under `tests/` and renderer tests under the existing renderer test location.

---

## Task 1: Strengthen Workspace Metadata Into A Page Graph

**Files:**

- Create: `src/main/workspace-page-graph.ts`
- Modify: `src/main/workspace.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Test: `tests/workspace-page-graph.test.ts`
- Test: `tests/ipc-handlers.test.ts`
- Test: `tests/preload-api-surface.test.ts`

- [ ] **Step 1: Write failing page graph tests**

Cover migration from current `.workspace-meta.json`, stable page IDs, parent-child order, favorites, trash, recent visits, backlinks, collapsed sidebar sections, path safety, duplicate-with-children, and move/reorder.

```ts
expect(graph.pages["docs/prd.md"].id).toMatch(/^page_/);
expect(graph.pages["docs/prd.md"].parentPath).toBe("docs");
expect(graph.childOrder["docs"]).toEqual(["docs/prd.md", "docs/spec.md"]);
expect(graph.backlinks["docs/spec.md"]).toContain("docs/prd.md");
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/workspace-page-graph.test.ts`

Expected: FAIL because `workspace-page-graph.ts` does not exist.

- [ ] **Step 3: Implement page graph module**

Define these exported types:

```ts
export interface WorkspacePageGraph {
  version: 2;
  pages: Record<string, WorkspacePageMeta>;
  rootOrder: string[];
  childOrder: Record<string, string[]>;
  favorites: string[];
  recentVisits: Array<{ path: string; visitedAt: number }>;
  backlinks: Record<string, string[]>;
  sidebar: {
    collapsedSections: string[];
    width: number;
    collapsed: boolean;
  };
}
```

Add functions:

```ts
loadPageGraph(root: string): Promise<WorkspacePageGraph>
savePageGraph(root: string, graph: WorkspacePageGraph): Promise<void>
syncPageGraph(root: string): Promise<WorkspacePageGraph>
recordVisit(root: string, path: string): Promise<WorkspacePageGraph>
movePage(root: string, path: string, parentPath: string | null, beforePath?: string): Promise<WorkspacePageMeta>
duplicatePageTree(root: string, path: string): Promise<WorkspacePageMeta>
extractBacklinks(content: string): string[]
```

- [ ] **Step 4: Wire IPC and preload**

Add APIs:

```ts
getWorkspacePageGraph(profile?: string): Promise<WorkspacePageGraph>;
updateWorkspacePageOrder(path: string, parentPath: string | null, beforePath?: string, profile?: string): Promise<WorkspacePageMeta>;
updateWorkspaceSidebarState(state: Partial<WorkspacePageGraph["sidebar"]>, profile?: string): Promise<WorkspacePageGraph>;
getWorkspaceBacklinks(path: string, profile?: string): Promise<string[]>;
```

- [ ] **Step 5: Run validation**

Run:

```bash
npm test -- tests/workspace-page-graph.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/workspace-page-graph.ts src/main/workspace.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts tests/workspace-page-graph.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
git commit -m "feat: add workspace page graph"
```

---

## Task 2: Build Real Sidebar And Page Management Affordances

**Files:**

- Modify: `src/renderer/src/screens/Workspace/WorkspaceTree.tsx`
- Modify: `src/renderer/src/screens/Workspace/Workspace.tsx`
- Modify: `src/renderer/src/screens/Workspace/WorkspaceHeader.tsx`
- Create: `src/renderer/src/screens/Workspace/PageCreateDialog.tsx`
- Create: `src/renderer/src/screens/Workspace/PageMenu.tsx`
- Test: renderer tests for sidebar operations

- [ ] **Step 1: Write failing renderer tests**

Cover create without `window.prompt`, inline rename, duplicate, trash/restore, favorite, drag reorder before/after, drag nest/un-nest, collapsed section persistence, sidebar resize, breadcrumb ancestor navigation.

- [ ] **Step 2: Replace prompt-based flows**

Remove `window.prompt` usage from page create/rename handlers in `Workspace.tsx`. Use `PageCreateDialog` and inline rename state in `WorkspaceTree`.

- [ ] **Step 3: Implement sidebar sections**

Render:

```txt
Favorites
Recent
Workspace
Trash
Agent Control Center
```

Each section must support collapse/expand, keyboard focus, and empty state.

- [ ] **Step 4: Implement page menu**

Actions:

```txt
Rename
Duplicate
Copy link
Favorite / Unfavorite
Move to
Turn into synced block source
Export
Move to trash
```

- [ ] **Step 5: Implement drag reorder**

Use current backend `movePage` support. Add drop targets for before, after, and inside page. Preserve child order in metadata.

- [ ] **Step 6: Validate**

Run:

```bash
npm test -- --run WorkspaceTree
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/screens/Workspace
git commit -m "feat: improve workspace page management"
```

---

## Task 3: Replace Static Markdown Snippets With Block Controls

**Files:**

- Modify: `src/renderer/src/screens/Workspace/WorkspaceEditor.tsx`
- Create: `src/renderer/src/screens/Workspace/blockExtensions.ts`
- Create: `src/renderer/src/screens/Workspace/BlockCommandMenu.tsx`
- Create: `src/renderer/src/screens/Workspace/PageMentionMenu.tsx`
- Test: renderer editor tests

- [ ] **Step 1: Write failing editor tests**

Cover block IDs, slash command insertion, inline `+`, keyboard navigation, block duplicate/delete, turn-into heading/todo/toggle/callout/code/quote/divider/database, block color, page link search, and Markdown serialization.

- [ ] **Step 2: Add block ID extension**

Every top-level block gets a stable `data-block-id`. Markdown serialization preserves IDs in a low-noise compatible form, preferably YAML frontmatter or HTML comments only when needed.

- [ ] **Step 3: Add block handle UI**

On hover/focus, show drag handle and `+` button. Handle menu includes:

```txt
Turn into
Duplicate
Delete
Move up
Move down
Copy link to block
Color
Ask Hermes about this block
Suggest edit with Hermes
```

- [ ] **Step 4: Add slash command menu**

Commands:

```txt
/page
/todo
/toggle
/callout
/quote
/code
/divider
/image
/file
/database
/button
/synced
/template
/color
/turn
```

The menu must be searchable, keyboard-navigable, and dismissible with Escape.

- [ ] **Step 5: Add `@` and `[[` menus**

`@` inserts page, date, reminder, or agent mention. `[[` inserts page links and creates backlinks through the page graph.

- [ ] **Step 6: Validate**

Run:

```bash
npm test -- --run WorkspaceEditor
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/screens/Workspace/WorkspaceEditor.tsx src/renderer/src/screens/Workspace/blockExtensions.ts src/renderer/src/screens/Workspace/BlockCommandMenu.tsx src/renderer/src/screens/Workspace/PageMentionMenu.tsx
git commit -m "feat: add workspace block controls"
```

---

## Task 4: Add Templates, Buttons, And Local Agent Workflow Blocks

**Files:**

- Create: `src/main/workspace-templates.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Create: `src/renderer/src/screens/Workspace/WorkspaceTemplatesPanel.tsx`
- Modify: `src/renderer/src/screens/Workspace/BlockCommandMenu.tsx`
- Test: `tests/workspace-templates.test.ts`

- [ ] **Step 1: Write failing template tests**

Cover built-in templates, custom templates, database row templates, recurring template metadata, and path safety.

- [ ] **Step 2: Implement template storage**

Store templates under workspace internal metadata, not as visible user pages:

```ts
export interface WorkspaceTemplate {
  id: string;
  kind: "page" | "database-row" | "button";
  title: string;
  content: string;
  properties?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 3: Add page template picker**

On new page, show templates:

```txt
Blank
PRD
Meeting notes
Bug report
Research note
Sprint plan
Agent runbook
Decision log
```

- [ ] **Step 4: Add button blocks**

Button block schema:

```yaml
hermesType: button
label: Summarize this page
actions:
  - type: agentPrompt
    prompt: Summarize this page and extract action items.
```

Renderer should execute local actions only after user click.

- [ ] **Step 5: Validate**

Run:

```bash
npm test -- tests/workspace-templates.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/workspace-templates.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/screens/Workspace tests/workspace-templates.test.ts
git commit -m "feat: add workspace templates and buttons"
```

---

## Task 5: Upgrade Database Model And View Settings

**Files:**

- Create: `src/main/workspace-database.ts`
- Modify: `src/renderer/src/screens/Workspace/database.ts`
- Modify: `src/renderer/src/screens/Workspace/DatabaseBlock.tsx`
- Create: `src/renderer/src/screens/Workspace/DatabaseSettingsPanel.tsx`
- Test: `tests/workspace-database.test.ts`

- [ ] **Step 1: Write failing database tests**

Cover migration from current YAML, stable row IDs, filter/sort/group/subgroup, hidden properties, open mode, property editing, malformed YAML recovery, and stringify preserving row pages.

- [ ] **Step 2: Define versioned schema**

```ts
export interface WorkspaceDatabase {
  hermesType: "database";
  version: 2;
  id: string;
  title: string;
  properties: Record<string, WorkspaceDatabaseProperty>;
  views: WorkspaceDatabaseView[];
  items: WorkspaceDatabaseItem[];
  rowPages: Record<string, string>;
  templates: WorkspaceDatabaseTemplate[];
}
```

Property types:

```txt
title, text, number, select, multi_select, status, date, checkbox, url, email, phone, relation, rollup, formula, files, button, unique_id
```

- [ ] **Step 3: Implement view settings**

Each view supports:

```ts
filters: WorkspaceDatabaseFilterGroup;
sorts: Array<{ property: string; direction: "asc" | "desc" }>;
groupBy?: string;
subGroupBy?: string;
hiddenProperties: string[];
openMode: "side" | "center" | "full";
conditionalColors: WorkspaceConditionalColor[];
```

- [ ] **Step 4: Validate**

Run:

```bash
npm test -- tests/workspace-database.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/workspace-database.ts src/renderer/src/screens/Workspace/database.ts src/renderer/src/screens/Workspace/DatabaseBlock.tsx src/renderer/src/screens/Workspace/DatabaseSettingsPanel.tsx tests/workspace-database.test.ts
git commit -m "feat: upgrade workspace database model"
```

---

## Task 6: Build True Database Views And Row Pages

**Files:**

- Modify: `src/renderer/src/screens/Workspace/DatabaseBlock.tsx`
- Create: `src/renderer/src/screens/Workspace/DatabaseRowPeek.tsx`
- Create: `src/renderer/src/screens/Workspace/databaseViews.tsx`
- Test: renderer database tests

- [ ] **Step 1: Write failing renderer tests**

Cover table, board, list, gallery, calendar, timeline, database search, filter application, sort application, property visibility, row side peek, center peek, full-page open, row template creation.

- [ ] **Step 2: Implement real table view**

Features: sticky first column, editable typed cells, add column, hide column, freeze column, property menu.

- [ ] **Step 3: Implement real board view**

Features: grouped columns, card drag between groups, empty group, typed select/status updates.

- [ ] **Step 4: Implement real calendar/timeline**

Calendar requires date property. Timeline requires date or date range. If missing, show a user-facing empty/error state with a one-click “Add date property.”

- [ ] **Step 5: Implement row peek**

Side peek remains interactive with database visible behind it. Center peek opens modal. Full page opens row page as workspace page-like view.

- [ ] **Step 6: Validate**

Run:

```bash
npm test -- --run DatabaseBlock
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/screens/Workspace/DatabaseBlock.tsx src/renderer/src/screens/Workspace/DatabaseRowPeek.tsx src/renderer/src/screens/Workspace/databaseViews.tsx
git commit -m "feat: add rich database views"
```

---

## Task 7: Add Synced Blocks, Backlinks, Comments, And Reminders

**Files:**

- Create: `src/main/workspace-synced-blocks.ts`
- Modify: `src/main/workspace-page-graph.ts`
- Modify: `src/renderer/src/screens/Workspace/blockExtensions.ts`
- Create: `src/renderer/src/screens/Workspace/WorkspaceCommentsPanel.tsx`
- Test: `tests/workspace-synced-blocks.test.ts`

- [ ] **Step 1: Write failing tests**

Cover creating synced block source, pasting synced reference, editing source updates references, unsync single, unsync all, backlink extraction, comments anchored to block IDs, reminders parsed from `@remind`.

- [ ] **Step 2: Implement synced block registry**

```ts
export interface WorkspaceSyncedBlock {
  id: string;
  sourcePath: string;
  sourceBlockId: string;
  content: string;
  references: Array<{ path: string; blockId: string }>;
  updatedAt: number;
}
```

- [ ] **Step 3: Implement comments and reminders metadata**

```ts
export interface WorkspaceComment {
  id: string;
  path: string;
  blockId?: string;
  body: string;
  status: "open" | "resolved";
  createdAt: number;
}
```

Reminders are local metadata only. They should not create external automations.

- [ ] **Step 4: Validate**

Run:

```bash
npm test -- tests/workspace-synced-blocks.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/workspace-synced-blocks.ts src/main/workspace-page-graph.ts src/renderer/src/screens/Workspace/blockExtensions.ts src/renderer/src/screens/Workspace/WorkspaceCommentsPanel.tsx tests/workspace-synced-blocks.test.ts
git commit -m "feat: add synced blocks and comments"
```

---

## Task 8: Upgrade Search, Command Palette, Tabs, And Quick Actions

**Files:**

- Modify: `src/main/workspace.ts`
- Create: `src/main/workspace-search.ts`
- Modify: `src/renderer/src/screens/Workspace/CommandPalette.tsx`
- Modify: `src/renderer/src/screens/Workspace/Workspace.tsx`
- Test: `tests/workspace-search.test.ts`
- Test: renderer command palette tests

- [ ] **Step 1: Write failing search tests**

Cover recent pages before typing, favorites boost, exact phrase matching, workspace/session/admin/command filters, database row hits, backlinks, comments, and snippets.

- [ ] **Step 2: Implement ranking**

Ranking order:

```txt
exact title match
favorite exact match
recent exact match
title prefix
backlink/page mention
database row title/property
body snippet
session result
admin/command result
```

- [ ] **Step 3: Implement command palette actions**

Actions:

```txt
Open
Open in new tab
Open in new window
Copy link
Reveal in sidebar
Run command
Create page
Search only pages
Search only sessions
Search only databases
```

- [ ] **Step 4: Validate**

Run:

```bash
npm test -- tests/workspace-search.test.ts
npm test -- --run CommandPalette
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/workspace-search.ts src/main/workspace.ts src/renderer/src/screens/Workspace/CommandPalette.tsx src/renderer/src/screens/Workspace/Workspace.tsx tests/workspace-search.test.ts
git commit -m "feat: improve workspace search and commands"
```

---

## Task 9: Implement Agent Suggested Edits And Activity Provenance

**Files:**

- Create: `src/main/workspace-proposals.ts`
- Modify: `src/main/workspace.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Create: `src/renderer/src/screens/Workspace/AgentSuggestedEditsPanel.tsx`
- Create: `src/renderer/src/screens/Workspace/WorkspaceActivityPanel.tsx`
- Modify: `src/renderer/src/screens/Workspace/AgentReviewPanel.tsx`
- Test: `tests/workspace-proposals.test.ts`

- [ ] **Step 1: Write failing proposal tests**

Cover external write becomes proposal, block-level diff, accept one block, reject one block, apply all, dirty user edit never overwritten, activity entries created, restore after rejected proposal.

- [ ] **Step 2: Define proposal model**

```ts
export interface AgentWorkspaceProposal {
  id: string;
  path: string;
  baseContent: string;
  proposedContent: string;
  hunks: AgentWorkspaceProposalHunk[];
  createdAt: number;
  status: "pending" | "accepted" | "rejected";
}

export interface AgentWorkspaceProposalHunk {
  id: string;
  blockId?: string;
  before: string;
  after: string;
  status: "pending" | "accepted" | "rejected";
}
```

- [ ] **Step 3: Add suggested edit UI**

Render side rail with per-hunk diff, comment box, accept, reject, apply all, reject all, restore original.

- [ ] **Step 4: Add activity panel**

Activity entries:

```txt
page created
page renamed
user saved
agent proposed edit
agent edit accepted
agent edit rejected
version restored
database row changed
synced block updated
```

- [ ] **Step 5: Validate**

Run:

```bash
npm test -- tests/workspace-proposals.test.ts
npm test -- --run AgentSuggestedEditsPanel
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/workspace-proposals.ts src/main/workspace.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/screens/Workspace tests/workspace-proposals.test.ts
git commit -m "feat: add agent suggested edits"
```

---

## Task 10: Improve History, Offline Status, Recovery, Export

**Files:**

- Create: `src/main/workspace-history.ts`
- Modify: `src/main/workspace.ts`
- Modify: `src/renderer/src/screens/Workspace/WorkspaceHeader.tsx`
- Modify: `src/renderer/src/screens/Workspace/Workspace.tsx`
- Create: `src/renderer/src/screens/Workspace/WorkspaceHistoryPanel.tsx`
- Create: `src/renderer/src/screens/Workspace/WorkspaceOfflinePanel.tsx`
- Test: `tests/workspace-history.test.ts`

- [ ] **Step 1: Write failing history tests**

Cover snapshot before user save, page operation, database edit, proposal apply, restore version, diff summary, partial block recovery metadata, trash restore with history, export Markdown/HTML bundle.

- [ ] **Step 2: Implement history module**

```ts
export interface WorkspaceHistoryEntry {
  id: string;
  pageId: string;
  path: string;
  createdAt: number;
  reason:
    | "user-save"
    | "page-operation"
    | "database-edit"
    | "agent-proposal"
    | "restore";
  content: string;
  summary: Array<{ kind: "added" | "removed" | "changed"; text: string }>;
}
```

- [ ] **Step 3: Implement history UI**

Show version list, changed highlights, restore full version, copy block from previous version, and activity linkage.

- [ ] **Step 4: Implement offline/status UI**

Because storage is local, status should mean:

```txt
Local workspace ready
File watcher active
Unsaved edits
Conflict pending
Agent proposal pending
Last saved timestamp
```

Favorites and recents should be marked “available locally” by default.

- [ ] **Step 5: Implement export**

Export current page or workspace as:

```txt
Markdown bundle
HTML bundle
YAML database CSV files
```

- [ ] **Step 6: Validate**

Run:

```bash
npm test -- tests/workspace-history.test.ts
npm run typecheck
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/workspace-history.ts src/main/workspace.ts src/renderer/src/screens/Workspace tests/workspace-history.test.ts
git commit -m "feat: add workspace history and recovery"
```

---

## Task 11: Visual Polish, Accessibility, And Desktop Smoke

**Files:**

- Modify: `src/renderer/src/screens/Workspace/Workspace.css` or the existing workspace stylesheet
- Modify: relevant Workspace components
- Test: renderer accessibility tests if present

- [ ] **Step 1: Audit states**

Check every workspace surface for:

```txt
loading
empty
error
disabled
dirty
conflict
pending proposal
keyboard focus
narrow width
dark theme
light theme
```

- [ ] **Step 2: Fix nested interactive controls**

Replace nested clickable spans inside buttons in tabs and command results with accessible sibling buttons or menu actions.

- [ ] **Step 3: Verify responsive desktop layouts**

Check:

```txt
split mode
canvas-only mode
chat-only mode
sidebar collapsed
sidebar resized
database side peek
command palette
history panel
agent suggested edits panel
```

- [ ] **Step 4: Run full validation**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: PASS. Existing lint warnings may remain only if already present and unrelated.

- [ ] **Step 5: Manual dev smoke**

Run: `npm run dev`

Verify:

```txt
Create/rename/move/trash/restore page
Use slash menu and block handles
Create page link and see backlink
Create database and switch views
Filter/sort/search database
Open row side peek
Trigger agent proposal and accept/reject a hunk
Restore previous version
Use command palette quick actions
Switch light/dark themes
Resize/collapse sidebar
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/screens/Workspace
git commit -m "chore: polish workspace accessibility"
```

---

## Acceptance Criteria

- Page tree supports polished create, rename, duplicate, favorite, trash, restore, drag nesting, drag reorder, recents, favorites, breadcrumbs, sidebar resize/collapse, and section persistence.
- Editor supports block IDs, block handles, drag/reorder, duplicate/delete, turn-into, color, slash commands, inline add, page links, backlinks, comments, reminders, synced blocks, templates, and local action buttons.
- Databases support versioned YAML migration, typed properties, filters, sorts, grouping, hidden properties, property editing, table/board/list/gallery/calendar/timeline, row pages, side/center/full open modes, row templates, database search, and malformed YAML recovery.
- Command palette supports recents, ranking, exact phrase search, filters, keyboard navigation, copy link, open in tab/window, reveal in sidebar, command execution, admin/app commands, sessions, pages, and database rows.
- Agent review supports block-level suggested edits, accept/reject/apply all, activity provenance, conflict-safe behavior, and undo/history integration.
- History supports snapshots before meaningful writes, restore version, visible change summaries, partial block recovery, and trash restore with history.
- Offline/status UI accurately describes local workspace state, file watcher state, unsaved edits, conflicts, proposals, and last save time.
- Validation passes:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Deliberately Out Of Scope

- Notion API sync.
- Cloud multi-user collaboration.
- Remote SSH workspace sync.
- Changing Hermes Agent engine internals beyond existing chat/context/proposal integration.
- Production permissions and sharing controls.
- Browser/mobile Notion parity.

## Execution Recommendation

Implement in this order:

1. Page graph and sidebar.
2. Block editor controls.
3. Database model and views.
4. Search/navigation.
5. Agent suggested edits and activity.
6. History/offline/export.
7. Accessibility and visual polish.

This order keeps each milestone useful on its own and avoids building UI controls before the main-process state model can support them.
