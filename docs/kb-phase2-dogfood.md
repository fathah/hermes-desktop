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
