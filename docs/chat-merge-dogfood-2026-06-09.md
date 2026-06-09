# Dogfood — merged Chat surface + Developer-mode toggle

**Date:** 2026-06-09
**Scope:** commits `0e0ac52` (surface merge), `634db48` (Developer mode), `1c093b0`
(three-tier ChatHeader + "⋯" overflow) on `main`.
**Method:** black-box, Playwright-Electron against the built app, throwaway
`HERMES_HOME` (`/tmp/hermes-dogfood`) seeded with a 2-message chat session in
`state.db`. No real data. The Hermes gateway does NOT run in this harness (fake
venv markers), so live message send / approvals / diffs could not be exercised —
see Coverage gaps.

## What passed (clean)

- **Rail IA** — the AI Assistant section shows exactly `Chat`, `Search workspace`,
  `You`. The old `Advanced (Developer)` entry is gone. No empty/dead surface.
- **Persistence + resume (the core of the merge)** — the seeded session appears in
  Recents as "Dogfood test chat"; clicking it loads the full 2-message history into
  the single Chat surface. Confirms all chats now route through the session-backed
  path.
- **Overflow "⋯" menu — correct items by state:**
  - empty chat → `[Fast Mode]`
  - populated chat → `[Fast Mode, Compress context, Clear chat]`
  - populated + Developer mode ON → `[Fast Mode, Compress context, Checkpoints (/rollback), Clear chat]`
  - No dev-only item ever leaks when Developer mode is OFF.
- **Overflow a11y** — trigger has `aria-haspopup="menu"`, `aria-expanded` flips on
  open; `role="menu"`/`menuitem` present; Esc closes; focus returns to the trigger
  after Esc; ArrowDown roves focus (`Fast Mode → Compress context`).
- **Clear chat** — opens the themed `ConfirmDialog` ("Clear this conversation? This
  cannot be undone." with Cancel + danger-red Clear chat), NOT a native dialog.
- **Developer mode** — default OFF (checkbox unchecked, localStorage null); toggling
  persists (`hermes-developer-mode-v1="true"`); gating is reactive live — Checkpoints
  appears/disappears in the open-able overflow as the flag flips, no reload needed.
  Control is well-placed in Settings → Advanced with a clear hint.
- **Regression** — Graph / You / Home navigation still works; workspace boots fine.

## Issues

### 1. First-run checklist overlaps the chat input — Medium
- **What:** The "Get started · 0/5" onboarding card (from D7) is fixed at
  bottom-left and overlaps the bottom of the Chat surface — it sits over the
  left portion of the chat input row / "Choose a model in Models →" banner.
- **Repro:** Fresh profile (checklist not yet dismissed) → open Chat → the card
  covers part of the input area.
- **Why it matters:** Obscures chat controls for exactly the new users the checklist
  targets. Not from the chat-merge commits — a D7 placement issue surfaced here.
- **Suggested fix:** Anchor the checklist clear of the chat input (e.g. above the
  input, or hide it on the chat surface), or make it dismiss-on-first-chat.
- **Severity:** Medium.

### 2. Chat header shows the session-id suffix, not the human title — Low (pre-existing)
- **What:** With the "Dogfood test chat" session open, the header reads
  "Session food-1" (last 6 chars of `sess-dogfood-1`) while Recents shows the real
  title "Dogfood test chat".
- **Repro:** Open any titled session from Recents → compare header vs Recents label.
- **Why it matters:** Mild inconsistency; the title is the more useful label. The
  merge didn't cause this (the `<Chat>` component only receives `sessionId`, not the
  title) but now that all chats route through this path it's more visible.
- **Suggested fix:** Pass the session title into `<Chat>`/`ChatHeader` and prefer it
  over the id suffix when present.
- **Severity:** Low.

### 3. OpenClaw migration banner shows on every Settings tab — Low / Nice-to-have (pre-existing)
- **What:** The "OpenClaw Installation Detected" banner renders on the Advanced tab
  (and every other tab) because it is intentionally not section-gated.
- **Repro:** Settings → any tab → banner present.
- **Why it matters:** Minor visual repetition; by design from the B3 tab split.
- **Suggested fix:** Gate the banner to the General (or Connection) tab only.
- **Severity:** Nice-to-have.

## Coverage gaps (not defects — could not be exercised in this harness)

- **Live chat round-trip** — sending a message, approvals/diffs rendering, and a
  brand-new chat appearing in Recents (the documented once-on-mount freshness gap)
  all need a running Hermes gateway, which the seeded harness does not start.
- **Worktree control** — gating it ON was verified for Checkpoints; the worktree
  toggle additionally requires a bound context folder, which needs the native folder
  picker (not drivable headless). The gating *logic* is shared with Checkpoints
  (verified), but the worktree control itself was not visually exercised.

## Summary

- **Tested:** rail IA, session persistence + resume, overflow item sets across
  empty/populated/dev-on states, overflow keyboard a11y, themed clear-confirm,
  Developer-mode default/persist/reactive-gating, light regression.
- **Issues:** 0 Critical · 0 High · 1 Medium (checklist overlap) · 2 Low/Nice-to-have.
- **Confidence:** High for the merge's IA, the overflow menu, and the Developer-mode
  behavior (all directly observed, including persistence-resume from a seeded
  session). Medium overall, because gateway-dependent flows (live send, approvals,
  diffs, new-chat Recents freshness, worktree-with-folder) were not exercised.
- **Recommendation:** The chat-merge + Developer-mode work is solid and ship-ready as
  landed. The one actionable item from this run is the **Medium** first-run-checklist
  overlap (a D7 regression, not a chat-merge defect). The two Low items are
  pre-existing polish.

> Hard stop — report only. To fix any of the above, start a new turn with
> `/remediate` (by severity/id), `bugfix`, or `diagnose`.
