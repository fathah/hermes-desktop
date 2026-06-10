# Weekly External-Sessions Digest — Dogfood Report (2026-06-10)

**Feature under test:** the weekly digest (`3bb3eb59` and the 4 commits before it) —
a recurring, review-first job that smart-merges the period's external AI-tool
sessions into a living KB page.

**Method:** black-box end-to-end against a **throwaway `HERMES_HOME`** + a seeded
fake Claude Code source, with the app pointed (remote mode) at a **local stub
gateway** so the only mocked piece is the external LLM. Every line of the digest
feature ran for real: backfill → `+ Weekly digest` → Run now → `runDigest` →
`listConversationsSince` → source assembly → `mergeBriefAndQueue` → pending →
Apply → page render. Harness: `scripts/digest-dogfood.mjs` (3 modes). The real
`~/.hermes` and real transcripts were never touched.

## What I tested

| Journey                                                                   | Result                                                                                                                                    |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Happy path** — enable Claude Code → `+ Weekly digest` → Run now → Apply | ✅ Digest page "External Sessions Digest" created with `## Highlights / ## Decisions / ## Sources (provenance, no URL) / ## Updates`      |
| Schedule presentation                                                     | ✅ "Digest" chip + "External sessions" label + "Weekly · Mon 08:00 · today · **app-open only**" (no paired cron — correct)                |
| Review-first                                                              | ✅ Run now produced a **Pending update** ("Weekly digest — 1 external session") with Apply/Dismiss; nothing written to the KB until Apply |
| **Empty period** — session 14 days old (outside the weekly window)        | ✅ No pending, no page, no crash; digest short-circuits **before** the LLM call (0 synthesis calls)                                       |
| **Gateway failure** — stub returns 500                                    | ✅ No pending, no crash, schedule persists; error handled in `runDigest`'s catch                                                          |

Screenshots in `/tmp/digest-dogfood`, `/tmp/digest-empty`, `/tmp/digest-fail`.

## Issues found

### 1. Research-flavored copy leaks into the digest UX — **Severity: Medium**

- **What:** The management modal is titled **"Scheduled research"**, the create row reads **"Research this topic on a schedule…"**, and digest run outcomes flash research wording — empty period → **"No new info this run"**, failure → **"Run failed"**. A digest doesn't research a topic, so this reads as the wrong feature.
- **Repro:** Create a digest via `+ Weekly digest`; the Scheduled modal opens titled "Scheduled research". Run now on an empty period → toast "No new info this run".
- **Why it matters:** User-facing clarity. A user managing a digest sees "research" everywhere and may not trust they're in the right place. Pure copy, no functional impact.
- **Suggested fix (one line):** Neutralize the modal title to "Scheduled" and branch run-outcome toasts on `item.kind` (digest → "No external sessions this period").

### 2. Empty-period outcome is indistinguishable from no-material-change — **Severity: Low**

- **What:** Both "no sessions in the window" and "sessions present but nothing material to merge" surface as the same `no-change` → "No new info this run". The user can't tell whether the digest had nothing to look at vs. looked and found nothing new.
- **Repro:** Run a digest in a week with no sessions vs. re-run after an applied digest (dedupe) — identical toast.
- **Why it matters:** Minor diagnosability; a user wondering "did it even see my sessions?" gets no signal.
- **Suggested fix:** `runDigest` already returns "No external sessions this period" for the empty case — surface that summary in the toast instead of the generic `no-change` string.

### 3. Digest pending/apply is logged as WikiLog op "research" — **Severity: Low**

- **What:** `onApply` calls `spsAppendWikiLog("research", …)` and the digest reuses the "research" WikiLogOp (a deliberate v1 choice to avoid widening the union). The wiki evolution log therefore labels a digest commit as "research".
- **Why it matters:** Provenance accuracy in the wiki log only; no functional effect. Already documented as a v1 trade-off.
- **Suggested fix:** Add a "digest" WikiLogOp when the union is next touched.

### 4. Digest creation + scope are under-exposed in the management modal — **Severity: Low / Nice-to-have**

- **What:** A digest can only be _created_ from the External Sessions modal's `+ Weekly digest` (good discovery), but the Scheduled modal itself offers only the research topic input — no "new digest" there. Cadence is hardcoded weekly and the `scope` (source/project) plumbed through the types is not exposed in any UI.
- **Why it matters:** Discoverability + flexibility. Acceptable for v1 (documented), but a user who wants a daily digest or a Codex-only digest can't get one from the UI.
- **Suggested fix:** Offer cadence/scope on the `+ Weekly digest` action (or a small digest-create row in the Scheduled modal).

### 5. Observation (not a bug): the digest skips the LLM when there are no sessions

- In the empty-period run the stub received **0 synthesis calls** — `runDigest` returns before `mergeBriefAndQueue`. This is correct and cost-saving (no wasted gateway call on an empty week). Noted as a positive.

## Architectural / invariant check

- **Review-first (pending → Apply)** preserved — correct for the default `blob` storage mode where direct vault writes aren't read back. ✅
- **Untrusted fencing** — the digest source is wrapped in `<digest_source>` with the never-follow-instructions preamble (verified in code + ingest test). ✅
- **Provenance-only `## Sources` (no URLs)** — confirmed in the rendered page ("Claude Code · project: proj"). ✅
- **App-open-only digests (no paired cron)** — confirmed in the schedule label. ✅
- No invariant weakened; the change reuses the Scheduled-Research pending/merge path rather than adding a parallel one.

## Summary

- **Tested:** happy path (create → run → review → apply → page), empty-period, gateway-failure, schedule presentation, review-first gating.
- **Issues:** 0 Critical, 0 High, 1 Medium (research-flavored copy), 3 Low, 1 positive observation.
- **Confidence: High** — the full pipeline works as designed and both failure modes degrade gracefully; the only mocked component was the LLM itself.
- **Recommendation:** Ship as-is functionally; the Medium copy issue (#1) is the one worth a quick follow-up for clarity. To fix any of these, start a new turn with `/remediate` (or `bugfix` for #1).

---

_Report only — no code was changed in this run._
