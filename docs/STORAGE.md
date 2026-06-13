# SPS Agent storage substrate

How the **SPS Agent** workspace persists its content. The design goal: match
Notion's databases / wikis / forms / backlinks affordances while keeping
**plain markdown on disk as the single source of truth**, with SQLite as a
purely derived, rebuildable query index.

## The one rule

**Markdown on disk is the only source of truth. SQLite is a rebuildable index.
Writes go file‑first.** Delete the index and it rebuilds from the markdown with
no data loss. Nothing reads the index back as authoritative.

## On‑disk layout

Everything lives under the active profile's home directory
(`<profileHome>` — `HERMES_HOME` for the `default` profile, else
`<HERMES_HOME>/profiles/<name>/`):

```
<profileHome>/sps-agent/
  workspace.json              # the JSON blob (see "Storage modes")
  vault/
    <pageId>.md               # one markdown file per page (frontmatter + blocks)
    <dbFolder>/<rowId>.md      # rows of a folder-backed query database (S4)
    _manifest.json            # structure the page files can't hold (see below)
    .note-index.db            # the derived better-sqlite3 index (rebuildable)
```

- **Page files** (`<pageId>.md`): YAML‑style frontmatter (`title` / `icon` /
  `cover`) + the block body. The page's basename **is** its `pageId`; that's how
  `[[wikilinks]]` resolve in the graph.
- **Query‑database rows** (`<dbFolder>/<rowId>.md`): frontmatter holds the row's
  properties (`title` / `status` / `prio` / …); the body is an optional note. A
  database block opts into this folder‑backed mode by carrying a `source` field.
- **`_manifest.json`**: the page tree, trash, comments, and current page — the
  structure that individual page files can't represent on their own.

## Storage modes (the `storageMode` flag)

`lib/storageMode.ts`, persisted in `localStorage` under
`sps-agent-storage-mode-v1`. Default **`blob`** — nothing changes until the user
explicitly migrates.

- **`blob`** (default): `workspace.json` is authoritative. The vault is an
  **additive mirror** — SPS edits are also written to `vault/<pageId>.md` so the
  substrate and its index materialize, but the mirror is never read back as
  truth (`lib/persistence.ts` → `mirrorPage`).
- **`vault`**: the markdown vault (page files + `_manifest.json`) is
  authoritative; the editor loads from it and the blob is kept as a backup
  (`lib/vaultStore.ts`).

Both modes are always present and reversible — migrating never rips out the blob
or the embedded data.

## Serializers (round‑trip markdown ↔ blocks)

- `editor/blockMarkdown.ts` — block‑tree ↔ markdown, two tiers:
  - **Tier 1** (clean, Obsidian‑compatible): `p`, `h1‑3`, `li`, `numli`, `todo`,
    `quote`, `code`, `divider`, `image` with only markdown‑expressible inline
    marks.
  - **Tier 2** (lossless fallback): callout, toggle, bookmark, page, database,
    and anything carrying colour/bg or inline HTML markdown can't express →
    a single `<!-- sps:… -->` metadata comment that reconstructs the block.
  - `id` is a runtime handle, **not** content — normally dropped on serialize
    and regenerated on parse. **Exception (F2):** a block an open comment is
    anchored to keeps a stable id across the round‑trip — an Obsidian‑style
    trailing ` ^<id>` on inline tier‑1 blocks, or the id retained inside the
    tier‑2 meta. Non‑anchored output stays byte‑identical (the golden tests pin
    this).
- `editor/pageMarkdown.ts` — page (frontmatter + blocks) ↔ markdown file.
- `editor/rowMarkdown.ts` — a query‑database row's properties ↔ a markdown file.
- `editor/workspaceVault.ts` — whole workspace ↔ vault snapshot (page files +
  manifest), plus the **parity gate** (below).

## The note index (derived, rebuildable)

`src/main/note-index.ts` — a `better-sqlite3` database over the markdown:

- **FTS5** full‑text search over page bodies.
- **Wikilink graph**: `backlinks(relPath)` (who links to this page) and
  `links()` (all resolved `{source, target}` edges, used by the graph view).
- **Property queries**: filter/sort/scope over frontmatter (JSON column).
- A `chokidar` watcher keeps it live as files change; `rebuild()` rebuilds it
  from disk (proving markdown is the sole truth).

Renderer access is via IPC‑backed hooks in `hooks/useNoteIndex.ts`
(`useVaultQuery`, `useVaultBacklinks`, `useVaultSearch`, `useVaultGraph`) — all
best‑effort (empty when the index/gateway is unavailable).

## Migrate / rollback / backup

`lib/storageActions.ts` (`toggleStorageMode`) is the single safe path, shared by
the command palette and the **Storage** section of the Tweaks panel:

- **Migrate (blob → vault)**: runs the **parity gate** first
  (`workspaceParity`) and **refuses** if content/structure wouldn't round‑trip
  losslessly. Then it timestamp‑backs‑up `workspace.json`
  (`workspace.json.bak-<stamp>`, surfaced as the "last backup" path) before
  writing the vault.
- **Rollback (vault → blob)**: reconstructs the blob from the vault and makes it
  authoritative again. The blob is never deleted.

**Parity (`workspaceParity`)** round‑trips a live workspace through the vault and
reports `ok` = content + metadata + structure all survive. It also reports
`blockAnchorsOk` (F2): every comment anchored to a _real_ source block keeps its
id through the round‑trip. Dangling anchors (a `blockId` with no matching block)
are pre‑existing breakage and don't gate cutover.

## Orphan cleanup (F3)

`deletePage` moves a page to **trash** (restorable, including across reload — its
`vault/<pageId>.md` is intentionally retained, and `_manifest.json` scoping stops
it resurrecting). When pages leave the workspace entirely (e.g. _Reset workspace
to sample_), `resetWorkspace` removes their now‑orphaned vault files via
`spsDeletePage` / `sps-vault.ts:deletePageIn` (id‑validated, traversal‑safe,
best‑effort).

## Surfaces

- **Graph view** (F4): a dependency‑light radial SVG of the wikilink graph
  (`graph/GraphView.tsx`); nodes are pages, edges from the index, clicking a node
  opens it.
- **Storage settings** (F5): the Tweaks panel's **Storage** section shows the
  current mode, a live parity readout, the migrate/rollback control, and the last
  backup path.
- **Folder‑backed query databases** (F1): the same board/table/list/gallery/
  calendar views as the embedded `TasksDB`, with inline edits written back to the
  row files.

## Testing — the native‑module caveat

`better-sqlite3` is compiled for **Electron's** node ABI, not vitest's, so any
code that opens the index **cannot run under vitest**. The split:

- **Pure logic + IPC‑mocked hooks/components** → vitest (jsdom). Renderer
  serializer code may use the DOM (available in jsdom and the renderer).
- **Anything that opens the index** → proven by the electron‑node script
  `scripts/verify-note-index.ts`, run via **`npm run verify:note-index`**
  (`ELECTRON_RUN_AS_NODE=1` so the Electron‑ABI binary loads). This covers
  `query` / `search` / `backlinks` / `links` / `rebuild`.
- **The renderer UI** (never exercised by the unit suite) → the Playwright‑
  Electron smoke harness `scripts/sps-smoke.mjs` (`npm run build` first), which
  boots the built app against a throwaway seeded profile and screenshots the key
  surfaces.

## Full verification gate

```bash
npx tsc --noEmit -p tsconfig.node.json --composite false   # main + preload
npx tsc --noEmit -p tsconfig.web.json  --composite false   # renderer
npx eslint <touched files>
npx vitest run                                             # full unit suite
npm run verify:note-index                                  # electron-node index proof
npm run build                                              # typecheck + bundle
```

Every new preload method must appear in **both** `src/preload/index.ts` and
`src/preload/index.d.ts`, or `tests/preload-api-surface.test.ts` fails.
