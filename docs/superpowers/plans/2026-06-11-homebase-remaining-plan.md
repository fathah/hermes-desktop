# Home Base — Remaining Work Plan

**As of 2026-06-11. `origin/main` @ `80736113`. Phases 1 + 2 + 3 COMPLETE.**

This is the durable, actionable plan for everything still pending in the "Home Base"
transformation. It supersedes the forward-looking sections of the two older docs for
_remaining_ work; those stay authoritative for history:

- **Living tracker (authoritative):** auto-memory `homebase-transformation.md` (loads each
  session via its `MEMORY.md` index line).
- **In-repo handoff:** `docs/superpowers/plans/HANDOFF-homebase-transformation.md`.
- **Canonical original plan (P0–P5):** `docs/superpowers/plans/2026-06-10-homebase-transformation.md`.

## The thesis (why the remaining work matters)

The Home Base unifies scattered LLM conversations / code / notes into one place. We've built
**stability** (P1), **a single SPS workspace + thin admin** (P2), and **intake** — import
ChatGPT/Claude.ai/Grok/Gemini exports into a redacted, fenced, searchable index (P3). The payoff
the user actually _feels_ is **P4 federated search**: one query that reaches vault notes, imported
transcripts, and Hermes sessions at once. Until then the imports sit in their own modal — built,
but not yet woven into daily flow.

## Recommended order

1. **P1.7 vault-mirror failure COUNT** — small, owed since Phase 1, standalone. Clears the debt.
2. **P4 federated search** — the keystone. Design-first (reality-check + brainstorm), then implement.
3. **P5 live capture / streaming** — later; 5.2/5.3 droppable.
4. **(Optional)** import worker_thread offload — deferred hardening, only if large-export main-thread
   stalls become a real complaint.

---

## Working conventions (LOCKED — apply to every item below)

- **Reality-check the premise vs current `main` FIRST.** Repeatedly through P1–P3, plan premises were
  stale or inverted (the "blank" thing already seeded, the "missing" surface already live, the
  worker_thread "freeze" not a renderer freeze). Close stale items; don't build them. Delegate the
  reality-check sweep to an Explore subagent (Sonnet) — conclusions to the main thread, not file dumps.
- **One worktree, serial branches.** Reuse `.claude/worktrees/p1.1-gateway-supervision`. Per item:
  `git checkout -b worktree-pX origin/main` (keeps `node_modules` — do NOT `npm ci`/symlink). Integrate:
  `git fetch origin` → `git merge-base --is-ancestor origin/main HEAD` ff-check → `git push origin HEAD:main`.
- **Per-item gate:** `npm run typecheck` (×2: node + web) → `npx eslint <touched>` → `npx vitest run`
  → `npm run verify:note-index` → `npm run build` → plus the item's relevant probe
  (`verify:external-context` / `external-context-smoke` / `sps-smoke` / `verify-admin-overlay` /
  `verify:firstrun-seed`). **Build BEFORE any Electron UI probe** — they drive the built `out/`.
- **All external/ingestion writes go through `applyFragments`** (the single writer; index-time redaction
  is a structural invariant — `verify:external-context` asserts a seeded key never reaches
  `messages`/`messages_fts`). Adapters are pure node (no electron/sqlite), vitest-testable.
- **Keep PRs small + single-purpose.** Merge-as-you-go.
- **Known flakes (NOT regressions):** `verify-admin-overlay` a1/a2 (cold-start GROUPS=0; a3/a4/a5 pass);
  `sps-smoke` 02b/02c/03 (fresh-seed collapsed nav; 01/02 pass); `verify:note-index` prints a
  SemanticIndex "helper not running" stderr line (checks still pass).
- **adm-zip + vitest:** any test touching adm-zip must be pinned `// @vitest-environment node` at the top
  — jsdom breaks adm-zip's zlib deflate (test-env only; real node + electron fine).

---

## ITEM 1 — P1.7 vault-mirror failure COUNT (owed; small; do first)

**Goal:** observability for the load-bearing vault write path — surface how many times a vault-mirror
write FAILED so a user/operator knows their markdown-on-disk source-of-truth is silently diverging.

**Reality-check first (delegate):**

- Where does the vault mirror actually write, and where can it fail? Expected: `src/main/sps-vault.ts`
  and the `sps-export-page` handler in `src/main/ipc/notes.ts`. Confirm the exact failure points
  (catch blocks that currently swallow) and whether a counter already exists.
- Confirm `storageMode` semantics: the mirror is the additive vault write in `blob` mode; in `vault`
  mode markdown is authoritative. The counter should cover the path that can silently drop.

**Build:**

- A persistent counter (process-lifetime or persisted to a small JSON under `HERMES_HOME` — prefer
  persisted so it survives restarts and is meaningful) incremented at each mirror-write failure, with
  the last error message + timestamp.
- New IPC `spsGetMirrorFailCount` → `{ count, lastError?, lastAt? }`. Preload bridge + `index.d.ts`
  parity (`tests/preload-api-surface.test.ts` enforces two-way).
- Surface in `TweaksPanel.tsx` **Storage** section (the "Workspace settings" panel) — a small line that
  only shows when count > 0 (e.g. "⚠ N vault-mirror writes failed — last: …").

**Why held until now:** deliberately kept out of every UI commit to avoid touching the storage
substrate in a mixed change. It gets its OWN small commit.

**Acceptance:** a forced mirror failure (inject a write error in a test/probe) increments the counter;
`spsGetMirrorFailCount` returns it; TweaksPanel shows the warning. Storage round-trip + parity tests green.

**Gate:** standard + `verify:note-index` (storage substrate) + `sps-smoke` (TweaksPanel renders).

---

## ITEM 2 — P4 federated search (the keystone)

**Goal:** one query reaches **all** the user's knowledge at once — vault notes, imported/scanned
external transcripts, and Hermes chat sessions — merged into a single ranked result surface, each hit
routing to the right place on click.

### 4.1 Reality-check + design (DO THIS BEFORE ANY CODE — delegate the sweep, then brainstorm)

Map the search surfaces that exist today and their result shapes:

- **Vault/notes:** `src/main/note-index.ts` (`.note-index.db`, FTS5) — consumed by `useNoteIndex`
  hooks, the **Ask pane**, `SidebarRecents` search. (KB pages are vault pages, so KB ⊂ this.)
- **External transcripts:** `external-context-search` IPC over `external-context.db` (FTS5) —
  `ExternalSessionsModal`. Already redacted + fenced.
- **Hermes sessions:** `searchSessions` (session cache) — `SidebarRecents`, `AskPane`.

Open design questions to resolve in brainstorming (present strongest case for each, recommend one):

1. **Aggregation: fan-out-and-merge vs unified index.** Strong recommendation = **fan-out-and-merge**
   (parallel-call the 3 existing IPCs, normalize, merge, rank). The indices are rebuildable and separate
   for good reasons; a unified index is migration + sync cost for little gain. Reject unified unless the
   reality-check surfaces a blocker.
2. **Ranking across heterogeneous FTS scores.** Normalize each source's score to [0,1], then apply a
   recency boost. Keep the ranking function PURE (vitest-testable). Decide tie-breaks + per-source caps
   so one chatty source can't drown the others.
3. **Which surface hosts it.** Candidates: the **Ask pane** (already the "search your workspace" entry),
   **⌘K**, or a dedicated "Search everything" surface. Reality-check what the Ask pane does today —
   extending it is likely lowest-friction and most discoverable. Avoid a new top-level surface if an
   existing one fits (P2 lesson: discoverability > new screens).
4. **Untrusted-content boundary.** External transcripts are UNTRUSTED (prompt-injection highway). In a
   merged list they MUST keep the provenance label + fence treatment; never auto-inject a transcript hit
   into a chat turn. This invariant rides along into the federated surface.

### 4.2 Aggregator (main-side, pure ranking)

- New `src/main/federated-search.ts` (or similar): `federatedSearch(query, opts)` parallel-calls the 3
  source searches, normalizes each hit to a common shape:
  ```
  FederatedHit { kind: 'note' | 'transcript' | 'session', title, snippet, source?, ts, ref, score }
  ```
  merges, ranks (normalized score + recency boost), applies per-source + total caps. The merge/rank
  logic is PURE → vitest-tested with synthetic per-source results (no sqlite).
- New IPC `federated-search` ({ query, opts }) wiring the aggregator. Preload bridge + `index.d.ts`
  parity.

### 4.3 UI surface

- Host federated results in the chosen surface (likely the Ask pane). Render grouped or interleaved with
  a **type chip** per hit (Note / Transcript / Session) + provenance for transcripts. Clicking routes:
  note → open vault page; transcript → open the untrusted `ConversationViewer`; session → resume.
- Keep the untrusted banner/fence on transcript hits.

### 4.4 Dogfood + smoke

- Seed a term that exists in a vault note, an imported transcript, AND a Hermes session; one query
  returns all three kinds in one ranked list; each routes correctly; transcript hit stays fenced + no
  secret leak.
- Extend `external-context-smoke` (or a new `federated-search-smoke`) to assert the merged surface.

**Gate:** standard + `verify:note-index` + `verify:external-context` + the federated smoke.

---

## ITEM 3 — P5 live capture / streaming (later; 5.2/5.3 droppable)

**Goal:** close the loop from a one-time intake to a _living_ Home Base — capture conversations as they
happen and stream responses.

Sub-items (reality-check each premise first — formats/ABIs drift):

- **5.1 paste-capture** — paste a raw conversation (incl. **Perplexity**, which has no export — this is
  where descoped 3.5 lands) → parse heuristically → stage → index through the same `applyFragments` path.
  Reuse the import pipeline; the only new bit is a paste → normalized-payload parser + a paste UI in the
  Import surface.
- **5.2 Telegram gateway** (droppable) — messaging intake/outtake so Hermes is reachable from Telegram.
  Builds on the existing gateway lifecycle (`src/main/hermes/`). Larger; only if the owner wants it.
- **5.3 streaming** (droppable) — streaming response surfacing improvements. Only if a concrete gap is felt.

**Gate:** standard + whatever probe matches the sub-item (paste-capture → `verify:external-context` +
smoke).

---

## ITEM 4 — Deferred hardening: import worker_thread offload (optional)

The P3.6 import parses on the main thread (matches the live `gemini` whole-file source). The renderer
can't freeze (async IPC); only the main process could stall on a pathologically-large `JSON.parse`. If
that becomes a real complaint, offload the parse to a `worker_thread`:

- No existing worker pattern in the repo — `electron.vite.config.ts` main has a single default entry
  (`src/main/index.ts`), no worker input. Adding a worker means emitting a worker entry to `out/` and
  resolving it at runtime; budget for that build integration.
- The worker runs the PURE adapter parser (no electron/sqlite), returns `{ conversations, messages,
skipped }`; the main thread calls `applyFragments` (still the single writer). Idempotency + the file
  cursor are unchanged.
- Only worth it for truly huge exports; document what was measured before building.

---

## Quick status table

| Item                    | State      | Size | Risk                    | Notes                            |
| ----------------------- | ---------- | ---- | ----------------------- | -------------------------------- |
| P1.7 vault-mirror count | owed       | S    | low (storage substrate) | do first; own commit             |
| P4 federated search     | next major | L    | med (design-heavy)      | design-first; fan-out-and-merge  |
| P5.1 paste-capture      | pending    | M    | low                     | Perplexity lands here            |
| P5.2 Telegram           | droppable  | L    | —                       | only if owner wants              |
| P5.3 streaming          | droppable  | M    | —                       | only if a gap is felt            |
| Import worker_thread    | optional   | M    | build-integration       | only if large-export stalls felt |
