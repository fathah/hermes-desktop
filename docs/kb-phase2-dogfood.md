# KB Phase-2 Dogfood — the trigger evaluation (BACKLOG item 9)

**Date:** 2026-06-05 · **Model under test:** xai-oauth / grok-4.3, via the live local
Hermes gateway (`127.0.0.1:8642`) · **Harness:** `scripts/kb-dogfood/` (run with
`run.sh`; reproducible).

## TL;DR — the gate verdict inverted

The backlog's bet (item 1) was: _most KB failures will be **depth** (the right doc is
retrieved but the model can't read far enough) → build an RLM navigate-and-read loop;
recall is secondary._ The dogfood shows the opposite of the actionable half:

- **Depth is already solved in production.** The agentic gateway reads the _full file_
  via its file tool when the injected excerpt is insufficient — using the absolute paths
  the grounding message already exposes. Proven by a controlled experiment, not inferred.
  Every depth question (answer buried past the 1500-char excerpt clamp) was answered
  **correctly**.
- **Recall is the residual gap** — and it is exactly the failure the file tool _cannot_
  fix, because you can't read a file retrieval never surfaced. The only two live failures
  were recall misses.

So the targeted next step is **not** a depth-oriented read loop (that exists). It is
**agentic re-search** — let the agent reformulate and re-query the vault (and follow
wikilinks) so the right doc enters the candidate set in the first place. Embeddings stay
demoted: a possible backing for that search tool, only if FTS reformulation leaves a
_measured_ recall gap.

## Method

A designed 5-doc security-guarding corpus (`scripts/kb-dogfood/corpus/`) — an SOP, a
guard handbook, a master service agreement, site post orders, and an incident-response
matrix — with deliberate cross-references, shared vocabulary, long sections (to bury
facts past the excerpt clamp), and planted synonym mismatches (to force recall misses).
11 questions (`questions.json`), each tagged with the failure mode it was designed to
probe and a distinctive answer fragment.

The harness drives the **real** pipeline verbatim: `groundingTerms` → `getSpsNoteIndex()
.search(terms, 5, "any")` → `buildRetrievalSystemMessage` → `buildSpsAssistantMessages`,
then posts the exact SPS payload (`model: "hermes-agent"`, `stream: false`) to the live
gateway. A throwaway `HERMES_HOME` isolates the corpus from the real `~/.hermes`.

- **Phase A (offline):** for each question, is the answer-bearing doc in the top-5 FTS5
  hits, and is the answer inside the 1500-char excerpt? → a mechanical recall-vs-depth
  prediction.
- **Phase B (live):** send the grounded request to grok-4.3, grade the answer.

## Results

| Question          | designed  | Phase A predicted | Phase B live | doc retrieved | answer offset | in excerpt |
| ----------------- | --------- | ----------------- | ------------ | ------------- | ------------- | ---------- |
| pass-checkcall    | pass      | pass              | ✅ correct   | yes           | 1196/3408     | yes        |
| pass-uniform      | pass      | pass              | ✅ correct   | yes           | 480/3097      | yes        |
| pass-coderesponse | pass      | pass              | ✅ correct   | yes           | 981/2670      | yes        |
| depth-codered     | depth     | depth-clamp       | ✅ correct   | yes           | **2797**/3408 | **no**     |
| depth-notice      | depth     | depth-clamp       | ✅ correct   | yes           | **2717**/3097 | **no**     |
| depth-creditcap   | depth     | depth-clamp       | ✅ correct   | yes           | **1724**/2670 | **no**     |
| depth-liability   | depth     | depth-clamp       | ✅ correct   | yes           | **2360**/2670 | **no**     |
| multihop-medical  | multi-hop | pass              | ✅ correct   | yes           | 725/1737      | yes        |
| multihop-penalty  | multi-hop | depth-clamp       | ✅ correct   | yes           | **1572**/2670 | **no**     |
| recall-holiday    | recall    | recall            | ❌ wrong     | **no**        | n/a           | n/a        |
| recall-aed        | recall    | recall            | ❌ wrong\*   | **no**        | n/a           | n/a        |

**9/11 correct. 0 depth failures. 2 recall failures.** Phase A had predicted 5 depth
failures — every one was rescued live.

\* recall-aed is a _partial_: the agent named the defibrillator by pulling it from the
incident-response-matrix (which _was_ retrieved and mentions it in passing), but lost the
location detail ("outside the management suite") that lived only in the non-retrieved post
orders. In a cross-referential corpus, some recall misses are partially masked by
incidental mentions in retrieved neighbours; doc-specific details are still lost.

## The mechanism proof (`verify-mechanism.ts`)

The depth-question successes had one of two explanations: (a) the agent read the full file
via the file tool, or (b) the excerpt wasn't really truncated. A single-variable
experiment settled it — hold the grounding excerpt constant, flip only the absolute path
validity:

- Excerpt contains the buried tail (`within 5 minutes` / `flash report`): **false**
  (confirmed truncated; 5 paths exposed).
- **Valid** paths → answer includes the buried tail, verbatim, citing "section 6.1".
- **Bogus** paths (`/nonexistent/missing.md`), identical excerpt → _"the specific steps
  and minute-by-minute details are not provided in the excerpts."_

Only the path changed. **The gateway reads the full file via the file tool.** The
grounding message's instruction — "If an excerpt is insufficient, read the full file at
its absolute path with the file tool" — is _live behaviour_, not a dead string. The
`spsAssistant` client is one-shot (`stream:false`), but the **server** (the Hermes agent)
runs a tool loop before returning the final completion.

This is why item 1's premise — "the SPS path does not run a tool loop, so depth needs
building" — is wrong about the system even though it's right about the client.

## What this does and does not establish (caveats — read before acting)

- **Model-dependent.** Proven for grok-4.3, which reliably escalates to a file read. A
  weaker configured model (e.g. a small local Ollama) may not call the tool, which would
  reintroduce the depth gap. The capability rides on the model choosing to use the tool.
- **Reliability at scale unmeasured.** 5/5 depth successes + one causal proof is enough to
  show the mechanism _exists and fires_, not that it's robust across a large vault or
  never wanders/loops (the backlog's reliability counter-case stands, untested here).
- **Recall base-rate is not 2/11 in the wild.** Both recall misses used _deliberately_
  disjoint vocabulary ("vacation/yearly" vs _holiday/annum_; "life-saving device" vs
  _defibrillator_). Natural phrasing usually shares enough keywords to retrieve the doc.
  The finding is the failure **type** that survives the file tool, not its frequency.
- **Latency not quantified.** Depth answers visibly took longer (extra tool round-trips).
  For an interactive co-author this is the real cost of the existing depth mechanism —
  worth measuring before leaning on it harder.
- **Local mode only.** Grounding is gated `!isRemoteMode()`, and the file tool reads
  local paths — consistent: in the only mode that grounds, the paths are readable.
  Remote/SSH grounding (backlog item 3) is a separate, still-open transport problem.

## Recommendation for item 1

1. **Do not build a depth-oriented RLM read loop.** It already exists (agentic gateway +
   file tool + absolute paths in grounding) and worked on every depth probe. Building it
   would be re-implementing a shipped capability.
2. **Attack recall instead.** The residual failure is "right doc never retrieved." Cheapest
   first moves, in order: (a) measure whether query _reformulation_ by the agent closes it
   — i.e. give the agent a `vault_search` tool it can re-call with rephrased terms (this is
   the "navigate" half of RLM and also handles multi-hop _discovery_ of non-retrieved,
   wikilinked docs); (b) only if a measured recall gap remains after reformulation, add
   local embeddings as one more search tool the agent can call.
3. **Harden the existing depth path** for weaker models / scale before relying on it:
   confirm the file-tool escalation fires on the models users actually run, and quantify
   the latency it adds.

The corpus, harness, question bank, and mechanism test are committed under
`scripts/kb-dogfood/` and are re-runnable against any gateway.

---

## Addendum — real-PDF run (2026-06-05)

The synthetic run used hand-written 3 KB markdown. To stress the depth mechanism at
real-document scale and through the **real ingestion path**, the harness was re-run over
three real PDFs via the product's own `extractPdfToMarkdown` (new step:
`scripts/kb-dogfood/ingest-pdfs.ts`): Coase, _The Nature of the Firm_ (20 pp, 57 KB text),
Google, _Anatomy of a Personal Health Agent_ (148 pp, **355 KB text**), and a Buffett
article. 9 questions, graded live against the same gateway (grok-4.3), then **source-verified
by hand**.

**Headline: depth holds at scale. 9/9 substantively correct, 0 depth failures, 0
hallucinations.** The agentic file-read recovered exact figures from deep inside the 355 KB
file — e.g. the DE-agent differential-diagnosis "top-1 accuracy of 46.1% vs DDx 41.4%" at
offset ~253k, and the precise effort breakdown "559 + 561 = 1,120 hours" (deeper and _more_
precise than the abstract's rounded "1,100"). Two answers initially looked wrong but were
the model reading **deeper, more-specific real data** than the anchor fragment — both
confirmed present in the source (lines 158–159, 784–786). Several answers explicitly cited
`[full file: …]`. So the file-tool depth mechanism does not just read the start of a long
file — it locates specific facts ~100 pages in, without confabulating.

**Three new findings the synthetic run could not surface:**

1. **An ingestion-quality bug (not OCR).** The Buffett PDF has a custom font with no
   ToUnicode cmap, so `extractPdfToMarkdown` produced **garbage text** (`!" #$%#& "'()…`) —
   yet `hasUsableTextLayer` returned **true** (it only counts non-space chars), so the
   garbage would silently enter the KB and ground answers on nonsense. This is distinct from
   the scanned-PDF/OCR case (item 2): a text layer that _exists_ but is unmappable. The
   detector needs a real "is this text intelligible" check (e.g. dictionary-word ratio), not
   a char count. In this run the garbage was inert (its tokens never matched English queries,
   so it was never retrieved) — but on a vault where it _did_ rank, it would poison grounding.
   **Recommend a new backlog item.**

2. **Recall is not testable below the retrieval cap.** With only 3 docs (< `GROUNDING_HITS`
   = 5), every on-topic query retrieves the relevant doc; both deliberately-synonym recall
   probes still retrieved their gold doc. Confirming the recall gap (the residual failure
   from the synthetic run) requires a corpus **larger than 5 docs**. The real test of item
   1's recommended direction (agentic re-search) still needs a bigger corpus.

3. **Answer specificity on figure-dense docs.** When a long doc reports many similar numbers
   (the Google paper has dozens of accuracy figures), an under-specified question
   ("what accuracy did the DE agent achieve?") gets _an_ correct figure, not necessarily
   _the_ one the user meant. Not a grounding failure — a UX consideration for the co-author
   on quantitative source material.

Net: the depth-already-solved conclusion **strengthens** — it survives a 355 KB / 148-page
document with deep, figure-dense content and no hallucination. The open work is unchanged:
attack **recall** (needs a >5-doc corpus to even measure), harden ingestion (the garbage-text
bug), and quantify latency. Real-run corpus/questions/results were kept out of the repo; only
the reusable `ingest-pdfs.ts` step is committed.

---

## Addendum — recall experiment (2026-06-05): cheapest fix measured

The recall direction from item 1 was finally **measured**, not assumed. Harness:
`scripts/kb-dogfood/recall-experiment.ts` over an 8-doc corpus
(`scripts/kb-dogfood/recall-corpus/`, > the top-5 retrieval cap) with two engineered
**keyword-recall misses** — the gold doc shares no salient term with the question, so it
falls outside the top-5 and is never handed to the agent (RM-holiday: "vacation/yearly"
vs the handbook's "holiday/annum"; RM-keys: "safe/access code" vs the policy's
"cabinet/combination") — plus two controls. Two arms, 5 trials each, live (grok-4.3):

- **baseline** — current grounding (top-5 excerpts + paths).
- **vault-nav** — the cheapest possible fix: append one paragraph naming the vault
  **directory** so the agent can list/read other files to discover the missed doc with its
  existing file tools. (Kept entirely in the harness — production grounding is unchanged.)

| question      | baseline | vault-nav         |
| ------------- | -------- | ----------------- |
| RM-holiday    | 0/5      | 5/5 (100%)        |
| RM-keys       | 0/5      | 3/5 (60%)         |
| controls (×2) | 5/5      | 5/5 (no breakage) |

**Findings:**

1. **The recall gap is real and the file tool cannot close it.** Baseline 0% on both misses:
   with the gold doc absent from the top-5, no path is handed over, and (unlike depth) the
   agent has nothing to read. This is the residual failure the depth mechanism leaves behind.
2. **The cheapest fix helps a lot — but is stochastic.** vault-nav lifts recall 0 → 80% mean.
   But the **agentic gateway is non-deterministic**: across runs the agent navigated the vault
   on an obvious reformulation (vacation→holiday, 100%) and only _sometimes_ on a harder one
   (safe→cabinet, 60%) — and an earlier single-shot run closed **0/2**. (This itself is a
   methodology lesson: n=1 per arm flipped between "ship it" and "useless" on consecutive
   runs; agent behaviour must be measured as a **rate**.)
3. **Controls are unaffected** — the hint never broke an easy retrieval.

**Conclusion / next step.** vault-nav is a cheap, strictly-positive, but **unreliable**
mitigation — it can't be the primary fix because you can't promise a co-author it will find a
synonym-phrased fact. The **reliable** lever is **app-side query expansion**: broaden the FTS
query (synonyms / term variants) so the gold doc enters the candidate set and its path is
handed over — which the agent reads ~deterministically (controls 100%, and the proven depth
mechanism). That sits squarely in this repo's "app selects candidates" role, needs no upstream
change, and is testable with this same harness. **Embeddings remain unjustified** until FTS
query expansion is shown to leave a residual synonym gap. The vault-nav hint may later be added
as a cheap belt-and-braces, but only on top of the deterministic fix, not instead of it.

### Query expansion — built & measured (2026-06-05)

Implemented the reliable fix: `buildRetrievalSystemMessage` now asks the model for a few
**synonym-rephrased keyword queries** (`expandQueryVariants` → `parseQueryVariants`), searches
each, and **fuses the ranked lists by reciprocal rank** (`fuseRankings`) so a doc surfaced by
any variant enters the top-K and its path is handed to the agent. Best-effort and bounded by a
12 s timeout — any failure (no gateway, timeout) degrades to the original-query behaviour.
Re-measuring with the same harness (`recall-experiment.ts`, now `expand=false` vs `expand=true`,
5 trials/arm):

| question                                                      | no-expansion | query-expansion   |
| ------------------------------------------------------------- | ------------ | ----------------- |
| RM-holiday (vacation→holiday, clean synonym)                  | 0/5          | 4/5 (80%)         |
| RM-keys (safe/access-code→cabinet/combination, semantic leap) | 0/5          | 1/5 (20%)         |
| controls (×2)                                                 | 5/5          | 5/5 (no breakage) |

**It reliably closes clean synonym misses** (0 → 80%; the answers cite the gold doc the original
query missed) and **leaves a residual on hard semantic gaps** (RM-keys: "safe" → "key cabinet" is
a concept leap, not a synonym — keyword expansion can't reliably bridge it). That residual is the
**measured justification for embeddings** as the gated next tier — exactly the gate's condition.
Controls are unaffected. **Shipped on** (default, within the already-opt-in grounding path).

Honest costs / limits, recorded:

- **+1 model call per grounded question** (serial, before retrieval). We accept it because
  recall misses are indistinguishable from successful retrieval (a miss returns a full set of
  _wrong_ docs), so there's no cheap "expand only when needed" signal — documented as a future
  optimisation hook.
- **Expansion quality is itself stochastic** (the variant model may not produce the bridging
  vocabulary), so this is a strong-mitigation, not a guarantee — embeddings are the path to a
  semantic (non-keyword) guarantee.
- Pure logic (`parseQueryVariants`, `fuseRankings`) is unit-tested in
  `tests/workspace-grounding.test.ts`; end-to-end efficacy is the harness measurement above.
