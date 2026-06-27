# Dogfood report — Tasks-Dump + Contacts (8-phase base + 3 follow-ons)

**Date:** 2026-06-27
**Build:** worktree `feat/kanban-status-badge` @ `05ccd47d` (== origin/main), fresh `npm run build`.
**Method:** Playwright-Electron driver (`scripts/dogfood-driver.mjs`, untracked harness) against a
throwaway seeded `HERMES_HOME`. Backends stubbed: a fake OpenAI-compatible gateway on `127.0.0.1:8642`
(canned enrichment + classify completions) and the python shim extended to answer `kanban list/show/create`
via argv. 21 functional checks + 2 computed-contrast probes. Screenshots under the run's `SMOKE_OUT`.

## Verdict

**All four features function end-to-end** — 21/21 functional checks pass. **One real, verified bug**
(dark-theme text illegibility) and one **strong-suspected systemic extension** of the same root cause.
No crashes, no data loss, graceful degradation everywhere it was tested.

---

## What was tested (and passed)

### Feature A — live agent-status badge on delegated rows (follow-on #1)

- 🤖 badges render in **Board, Table, and List** views for delegated rows (Queued / Running / Blocked / Done). ✅
- Unknown Kanban status **and** an orphan `delegatedTo` (id absent from the board) both **hide** the badge — no crash. ✅
- TaskDrawer shows an **"Agent"** field with the live badge; orphan delegation shows **"Delegated · status pending…"**. ✅

### Feature B — nag snooze / acknowledge (follow-on #3)

- Human task with an active nag shows a **"Reminders"** section with **Snooze 1 day / Snooze 1 week / Stop reminders**. ✅
- **Snooze** writes `snoozedUntil` to `task-nag-state.json` and swaps in a **"Resume now"** control. ✅
- **Resume now** clears the snooze; **Stop reminders** removes the record (ack) and the section disappears. ✅
- Human task **without** a nag, and AI-routed tasks, correctly show **no** Reminders section. ✅

### Feature C — AI contact-enrichment "Suggest details" (follow-on #2)

- `@mention` menu shows the **✨ "Suggest details"** affordance on a contact row. ✅
- ✨ → gateway → toast **"Suggested N fragment(s) + M tag(s)"**; lands an `enrich-contact` proposal in the **Review Queue**. ✅
- **Apply selected** writes the new fragments + tags to the person row, **preserving** existing fragments (append-dedupe). ✅
- A contact with **no mentioning notes** → graceful **"No new contact details to suggest"** (no-context path). ✅
- Re-proposing after Apply → **"nothing-new"** (idempotent dedupe against the now-updated row). ✅

### Feature D — task classifier (Tasks-Dump base)

- `spsClassifyTask` returns a gateway-backed classification (`route`, `risky`, `nagCadence`, `assigneeId`, …). ✅
  _(Driven via the IPC surface; the separate Quick-Capture BrowserWindow was not driven — see Limitations.)_

---

## Findings

### F1 — [Medium] Review-Queue enrich-contact preview is invisible in the dark theme — VERIFIED

**What.** In the AI Review Queue, an `enrich-contact` proposal's per-operation preview (the proposed
fragments + tags, and the op-kind label) renders in `var(--ink-1)` (`#14161A`) on the dark panel
background (`#161616`). Computed contrast ≈ **1.05:1** (WCAG AA needs 4.5:1). The text is in the DOM
(`"Leads the Series A round at Acme Corp · Prefers email over phone · #series-a · #acme"`, 458px wide)
but effectively unreadable.

**Repro.** Dark theme (the default). @mention a contact who is described in the current note → ✨ →
open Review Queue. You see the proposal title, "ENRICHMENT" badge, count summary, and the gold
`people/<id>` link — but **not** the actual fragments/tags you're about to apply.

**Why it matters.** This is a human-in-the-loop "nothing lands until you review and apply it" gate. If
the reviewer can't see _what_ will be written to the contact, they either apply blind (defeating the
gate) or get confused. Undermines the core promise of follow-on #2.

**Root cause.** `.health-mono-text { color: var(--ink-1) }` (`screen.css:562`). `--ink-1` is defined
once as `#14161A` in `sps-tokens.css:21` with **no `[data-theme="dark"]` override**, unlike the
theme-aware `--tx-1`/`--tx-2` (flip to light in dark mode). The sibling pageId link is visible because
it uses `var(--accent)` (theme-aware).

**Fix (1 token).** `var(--ink-1)` → `var(--tx-1)` for on-surface text. Faithful to intent (`--ink-1`
≈ light-theme `--tx-1` = `#1b1d21`) and legible in dark themes (`--tx-1` = `#ece7d8`/`#e8e8e8`).

### F2 — [Medium, suspected-systemic] The same `--ink-1` misuse spans Inbox + Health surfaces

**What.** F1 is one instance of a pattern. All **15** `var(--ink-1)` usages in `screen.css` are
`.inbox-*` / `.health-*` **page-content** classes (titles, textareas, card titles, section labels,
mono text). Each either has no background (inherits the dark surface) or sits on
`var(--surface)` / `transparent` / `var(--row-hover)` — **all dark**. None is on a light chip, so each
renders `#14161A`-on-dark (≈1.1:1) in the default dark theme.

Affected selectors: `.inbox-title`, `.inbox-tab-btn:hover/.active`, `.inbox-textarea`,
`.inbox-card-title`, `.inbox-teach-result pre`, `.inbox-proposal-title`, `.inbox-pill-input`,
`.health-title`, `.health-help-btn:hover`, `.health-help-card-title`, `.health-help-card-close:hover`,
`.health-help-item-title`, `.health-sec-label`, `.health-mono-text`.

**Status.** `.health-mono-text` (the Review Queue) is **behaviorally verified** via a live computed-style
probe. The other 13 are **statically confirmed** (no light background + non-theme-aware token) but were
not each rendered. Mechanism and fix are identical.

**Fix.** Replace every `var(--ink-1)` in `screen.css` with `var(--tx-1)`. Zero-risk (no usage is on a
light background; light-theme appearance is unchanged since `--tx-1` light ≈ `--ink-1`). Single root
cause, single mechanical change. `--ink-1` in `equity.css` is **out of scope** (not verified; may sit on
a light surface) and left untouched.

---

## Limitations of this pass

- **Quick-Capture window not driven.** Capture opens a separate `BrowserWindow` via a global OS hotkey
  (`Alt+Space` / `Cmd+Shift+Space`), which Playwright-Electron can't trigger; the classifier was instead
  exercised through its IPC (`spsClassifyTask`). The capture _UI_ (textarea, kind selector, Save Task)
  was not visually walked.
- **Backends are stubbed**, not a live Hermes gateway/Kanban. The contracts (request/response shapes)
  match the production code paths, but a real gateway's latency/error behavior wasn't exercised.
- **Mac contacts sync (P6)** not tested (optional native module not installed; out of the 4 surfaces).

## Confidence

**High** for the functional pass and for F1 (behaviorally verified). **High** for F2's mechanism,
**Medium** that every listed F2 selector is user-visibly broken (static, not each rendered).

## Recommendation

Fix F1 + F2 together as one single-purpose change (`screen.css`: `--ink-1` → `--tx-1`) with a
regression guard. Both stem from one token defect; the fix is mechanical and risk-free.
