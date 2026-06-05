# Hermes Desktop — Roadmap / Deferred Backlog

**Last updated:** 2026-06-05 · **Default branch:** `main` (local commit-to-main; remote `origin` = github.com/saxster/hermes-desktop)

This is the **remaining work** for the SPS-Agent knowledgebase / agent-aware / skills surface — the deferred items behind the features already shipped. Each item records *current state* (with file pointers), *what's left*, and the *rationale / gate* so any contributor can pick one up cold. Items are independent; ship one per worktree + commit.

---

## Already shipped (context — read the commits, don't redo)

| Commit                          | Feature                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `96bcc67`, `0dd8783`, `6096df3` | KB Phase 0+1: PDF→markdown→vault ingestion + grounded chat (FTS5 OR-mode retrieval)   |
| `d069868`                       | Agent-aware templates: `"button"` block fires the grounded co-author; 7 templates     |
| `bf87b8e`                       | Skills management: author / browse-registry / edit / enable-disable / harvest-local   |
| `07aede0`                       | Generate a skill from a repo (bounded digest → one gateway completion → review modal) |
| `904ec3d`                       | Untracked generated `graphify-out/` (now gitignored)                                  |

Read those commit messages + diffs for the shipped design; this doc references files but doesn't re-explain them. Note: the original "Upstream Templates And Skills Import Plan" was **deliberately reframed** — the copy/provenance/manifest machinery was rejected in favour of original content; nothing is owed there.

---

## Deferred items (the backlog)

Ordered roughly by value.

### 1. KB Phase 2 — RLM (agentic navigation), NOT vector RAG ⟵ the big one, GATED

**Direction decided:** do **RLM** — let the co-author _navigate_ the vault (search → read → re-search → recurse → synthesize) — instead of a vector-RAG pipeline. Embeddings are **demoted to an optional tool**, added only if a measured recall gap demands it. Short version: RLM reuses what's already built, dodges the entire vector tax, and wins exactly where top-k stuffing fails (multi-hop, whole-doc, follow-the-thread).

**Framing that must not be lost:** vector RAG is a _retrieval architecture_; RLM is an _inference/control strategy_. They sit on different axes — (A) **control:** one-shot retrieve-and-stuff vs. agentic navigate-and-recurse; (B) **search primitive:** keyword (FTS5) vs. vector vs. both. The decision is **agentic (RLM) on axis A**, keeping **keyword on axis B for now**. "RLM instead of vectors" really means: pick agentic control; don't build the vector subsystem yet.

**Status today:** retrieval is FTS5 keyword, **one-shot**. `NoteIndex.search(text, limit, mode)` (`src/main/note-index.ts`, `"any"`/OR mode); `groundingTerms()` + `buildRetrievalSystemMessage()` (`src/main/hermes.ts`) inject a single system message; the SPS path `spsAssistant()` (`src/main/sps-agent.ts`) is `stream:false` and expects a **structured JSON** result — it does **not** run a tool loop.

**What "do RLM" actually means here (the real work):**

- **Expose the vault as a first-class navigable toolset to the Hermes agent** — `vault_search` (the existing FTS5 index), `vault_read_page`, `vault_follow_wikilink` — and let the agent iterate. On-thesis: Hermes is already agentic (`file`, `session_search`, `delegation`/`moa` toolsets in `src/main/tools.ts`); KB-as-agent-skill belongs in Hermes, not as an embedding ETL in Electron.
- **The architectural cost is the agentic control loop + latency, not vectors.** The catch: the SPS co-author is one-shot/non-agentic today. RLM means either (a) re-architect `spsAssistant` to run a tool-calling loop, or (b) **route KB questions through the full agentic chat path** (which already can call tools) instead of the one-shot assistant. Decide this routing before coding — it's the bigger lift, bigger than "add a vector index."

**Why RLM over vector RAG (the case):** reuses the vault + FTS5 + wikilink graph + file tools (no new subsystem); **no embedder at all** → privacy gets _easier_, and no `sqlite-vec`/`better-sqlite3`-ABI/chunking/re-embed-on-edit/model-drift tax; and it beats top-k stuffing on multi-hop / whole-doc / follow-the-thread queries (cf. _Recursive Language Models_, Zhang et al., MIT, late 2025 — context-as-REPL; doesn't degrade as context grows).

**Honest counter-case (budget for these):** (1) **latency/cost** — multi-turn = several model calls per question; matters for an interactive co-author. (2) **wander/reliability** — agentic nav can miss a file or loop; top-k is bounded. (3) **keyword recall** — RLM's search primitive is still FTS5, so a pure-synonym miss is the one place vectors keep an edge (mitigated, not erased, by the agent reformulating queries).

**Embeddings — only if earned:** add local embeddings **as one more search tool the RLM can call** (never the foundation, never cloud) **iff** dogfooding shows recall — not depth — is the bottleneck. If so: `sqlite-vec` (mind the `better-sqlite3` ABI: index-opening code can't run under vitest → `verify:note-index` harness) or a Python embedding subprocess in Hermes.

**GATE — do not build until evidenced (and the diagnosis picks the tool):** dogfood one-shot keyword grounding first (item 9). Then fork on _why_ it failed:

- wrong/no chunk came back (synonym miss) → **recall** problem → consider embeddings-as-a-tool;
- model needed to read more / follow a thread / read a whole doc → **depth** problem → that's **RLM**, and vectors wouldn't have helped.

Bet (to verify, not assert): with SOP/contract corpora (shared vocab, cross-refs) most failures are _depth_ → RLM. And don't skip the cheap win: one-shot FTS5 grounding may already suffice for many questions — build the loop only when one-shot demonstrably can't look far enough.

### 2. OCR for scanned PDFs

**Status:** `extractPdfToMarkdown()` (`src/main/pdf-extract.ts`) detects a missing text layer via `hasUsableTextLayer()` and the UI flags "needs OCR, not imported" (`importPdf` in `screens/SpsAgent/store/slices/workspace.ts`).
**Left:** add an OCR path (tesseract.js, or a native/Python OCR) so scanned books actually ingest. Larger effort; isolate it (extraction quality, language packs).

### 3. Remote / SSH grounding

**Status:** grounding is **local-mode only** by construction — `buildRetrievalSystemMessage` is called only when `!isRemoteMode()` in both `src/main/hermes.ts` (chat) and `spsAssistant()` (`src/main/sps-agent.ts`).
**Left:** in remote/SSH mode the vault lives on the desktop and the remote agent can't read those paths. Either inline retrieved excerpts into the request (no path handoff) or run retrieval on the desktop and ship results. Decide the transport before coding.

### 4. "Sources" folder + scanned-PDF UX

**Status:** `importPdf` drops the ingested page under the _current_ parent (`templatesOpen.parent`), not a dedicated home; scanned PDFs surface only a transient flash.
**Left:** create/reuse a **"Sources"** tree folder for ingested docs; make the scanned-PDF outcome clearer (persistent notice + maybe an OCR CTA once item 2 exists).

### 5. Generate-from-repo — large-repo quality

**Status & finding (from a real dogfood on a medium repo via the live gateway + an x.ai model):** medium repos produce an accurate `SKILL.md`. But `buildRepoDigest()` (`src/main/skills.ts`) is bounded (~40 KB, walk-order file selection), so **large repos go tree-heavy / source-light** — hermes-desktop itself inlined only ~4 file bodies (tree + README + manifests ate the budget).
**Left:** a smarter file-selection heuristic — prioritise entrypoints/exports/most-imported files over walk order. Optionally a second mode that hands the repo path to the agent's file tools (agentic, streaming) for depth instead of the one-shot digest.

### 6. Per-button grounding + general-purpose buttons

**Status:** the agent-action `"button"` block (`screens/SpsAgent/types.ts`, `editor/ButtonBlock.tsx`) inherits the single global grounding setting and only does `agentPrompt`.
**Left:** optional per-button "ground on/off"; non-agent button actions (e.g., insert template, run a non-LLM action).

### 7. Grounding toggle in the SPS Assistant panel

**Status:** the toggle exists only in the Chat header (`screens/Chat/ChatHeader.tsx`); the SPS co-author reads the same persisted setting but has no in-panel control.
**Left:** add a small grounding toggle to `screens/SpsAgent/assistant/AgentBody.tsx` header (reads/writes `getGroundInWorkspace`/`setGroundInWorkspace`).

### 8. Grounding refactors (tech debt — low risk, do alongside item 7)

- **Cross-screen import smell:** `screens/SpsAgent/assistant/providers/BridgeAssistant.ts` imports `getGroundInWorkspace` from `../../../Chat/lib/grounding` — SPS (the product) depending on Chat (legacy), backwards. **Hoist** the setting to a shared module both import (e.g. `src/renderer/src/lib/grounding.ts` or `src/shared`).
- **`sps-agent → hermes` coupling:** `src/main/sps-agent.ts` imports `buildRetrievalSystemMessage` from `./hermes` (one-way, no cycle, but pulls the heavy hermes graph). Optional: extract `buildRetrievalSystemMessage` / `formatRetrievalSystemMessage` / `groundingTerms` into `src/main/grounding.ts` and **re-export from `hermes.ts`** so existing test imports (`tests/workspace-grounding.test.ts`) keep working.

### 9. KB dogfooding — the Phase-2 trigger evaluation ⟵ do this BEFORE item 1

Ingest several real business docs (SOPs, a contract, a handbook) and ask the co-author real questions with grounding on. **Don't just judge pass/fail — classify each failure** so the diagnosis picks the tool (see item 1's gate):

- **recall** failure (the right source existed but a synonym/paraphrase query missed it) → points at embeddings-as-a-tool;
- **depth** failure (the right source came back but the model needed to read more, follow a thread, or read a whole doc) → points at **RLM** (agentic navigation), which is the decided direction.

Until one-shot keyword grounding demonstrably fails, **build nothing** — it may already suffice. When it fails, the failure _type_ tells you whether to build the RLM loop (depth) or also add a vector tool (recall).

---

## Process / environment (project rules)

- **Worktree-per-task is mandatory.** Never edit/commit in the primary tree. Per feature: create a worktree off `main` → `npm install` + `npx electron-builder install-app-deps` (fresh worktrees need a native rebuild for Electron's ABI) → implement → gate → commit → fast-forward `main` (`git fetch . <branch>:main`) → `git push origin main:main` → clean the worktree.
- **Full verification gate** (see `docs/STORAGE.md`): `npm run typecheck` (BOTH projects) → `eslint` touched files → `npx vitest run` → `npm run verify:note-index` (only if the SQLite substrate is touched) → `npm run build` → a Playwright-Electron smoke for UI changes (`scripts/sps-smoke.mjs`, `scripts/sps-import-smoke.mjs`, `scripts/skills-smoke.mjs` are the patterns; smokes stub the OS dialog / gateway `fetch` via `app.evaluate`).
- **better-sqlite3 ABI split:** anything that _opens_ the note index can't run under vitest — pure logic + IPC-mocked hooks → vitest; index-opening code → `verify:note-index` (`ELECTRON_RUN_AS_NODE=1`); renderer UI → the smoke harnesses.
- **Preload parity is enforced** — every IPC method must be in BOTH `src/preload/index.ts` and `index.d.ts` or `tests/preload-api-surface.test.ts` fails.
- **Keep commits scoped**; never stage `graphify-out/` (gitignored) or `out/`.
- **Dogfooding the gateway path:** there's no auto-running gateway. Start it (e.g. run the Hermes agent in a terminal): `API_SERVER_ENABLED=true API_SERVER_PORT=8642 API_SERVER_KEY=<key> hermes gateway`. A harness can run the REAL functions and redirect only the `/v1/chat/completions` transport to that port with `Authorization: Bearer <key>` — this is how generate-from-repo was dogfooded end-to-end.

## Suggested skills

- **`rlm-strategies`** — the decided direction for item 1 (chunk / sample / filter / parallelize / delegate; "treat large context as an environment to explore, not data to consume"). Read it before designing the vault-navigation toolset.
- **`brainstorming`** — before designing item 1 or the large-repo heuristic (item 5); the solution space is wide.
- **`adversarial-review`** — stress-test the RLM plan (latency/UX, agentic wander, and the recall-vs-depth call are easy to get wrong).
- **`test-driven-development`** — pure functions (digest heuristics, retrieval) are well-suited to test-first.

## Pointers

- Substrate rules: `docs/STORAGE.md`. Project guidance: `CLAUDE.md` (repo root).
