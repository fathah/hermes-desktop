# Dark-theme legibility audit — 2026-06-27

**Trigger:** "launch it and use Computer Use to audit the app and correct any issues autonomously."
**Method:** Playwright-Electron harness against a throwaway, seeded `HERMES_HOME` (real vault
treated as RED — not touched). Forced the worst-case dark surface (`data-theme=dark` +
`data-skin=black`, surface `#161616`/rail `#0a0a0a`) and ran an **empirical computed-style
contrast probe** across 7 surfaces (Home, QueryDB, Journal, Teach Me, Content Studio, Graph,
⌘K palette): for every text node, WCAG ratio vs effective (ancestor) background, flagged below
AA (4.5:1 normal / 3:1 large). Root causes pinned by dumping the offending element's ancestry
background chain; fixes re-probed and screenshotted to confirm.

This audit started from a static discovery: the **entire numbered `--ink-1..--ink-4` family**
is defined once in `sps-tokens.css` with **no `[data-theme]` override** — so any `--ink-N` used
as text colour is frozen at a near-black light value and goes invisible-to-poor on dark surfaces.
The theme-aware twin is `--tx-1..--tx-4`.

## Fixed (shipped to main, test-first, full gate green)

| #   | Issue                                                                                                                                                                                                                                                                      | Evidence                                                                         | Fix                                                                                          | Sev  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---- |
| 1   | **equity.css** basket/alert/calibration text used `--ink-1/-2/-3` (17 usages)                                                                                                                                                                                              | `--ink-1` 1.0–1.1:1, `--ink-2` 1.6–1.8:1, `--ink-3` 3.2–3.6:1 on dark            | swap all 17 → `--tx-1/-2/-3` (`f9c0042b`)                                                    | High |
| 2   | **screen.css** `.inbox-*/.health-*` muted text still on `--ink-2/-3` (15) — the 3cd7570e fix did only `--ink-1`                                                                                                                                                            | same family, same surfaces                                                       | swap 15 → `--tx-2/-3`; **left `--ink-4` ×1** (`.inbox-card-badge`, see Flagged) (`898163e7`) | High |
| 3   | **QueryDB toolbar** — `.db-tool` buttons ("Table View" switcher, "Add Row", more-options) had **no `background`** → fell through to Chromium's default `ButtonFace` (#efefef), light in dark mode; `.db-view-dropdown-btn` text is `--tx-1` (light) → **1.07:1 invisible** | live ancestry probe: `button.db-tool=rgb(239,239,239)`; before/after screenshots | `background:none; border:none` on base `.db-tool` (intent matched its `:hover`) (`6a80985c`) | High |

Regression guards added to `tests/sps-dark-theme-legibility.test.ts`: bans `--ink-1/-2/-3` in
both screen.css and equity.css; asserts the `--tx-*` dark contrast contract; asserts `.db-tool`
declares an explicit background. 4 it-blocks, all green.

## Flagged — NOT auto-fixed (design / brand judgment; your call)

These are genuine sub-AA contrasts but they are **deliberate design tokens / brand colours**, not
non-theme-aware accidents. Changing them is a design-system decision, so I'm reporting rather than
overstepping.

- **F-B — White-on-gold CTAs (~2.74:1).** "New chat", "Add Row" form button, palette `⌘O` —
  white text on the gold accent `#c79400`. Present in **both** themes (the accent is
  theme-independent). Below AA. _Options:_ darken the accent, or use a darker accent-text. Brand call.
  **Sev: Medium.**
- **F-C — `--tx-4` faint text on the black skin (~2.3–2.66:1).** `#555` on the near-black rail —
  ⌘-hints, "No recent chats", empty-states, and notably the instructional **"Obsidian vault path
  is not configured. Set it in Tweaks Panel → Storage"**. `--tx-4` is the _intentionally faint_
  tier; the black skin sets it to `#555`. Acceptable for kbd hints, borderline for instructional
  text. _Options:_ lift the black-skin `--tx-4`, or use `--tx-3` for instructional copy. Token call.
  **Sev: Low–Medium** (the instructional line is the one worth reconsidering).
- **F-A-residual — `.inbox-card-badge` (`--ink-4`, light-mode).** Left out of fix #2 on purpose:
  `#9ba0a9` reads ~6.8:1 on dark (fine) but ~2.6:1 on **white** (poor in _light_ mode), and its
  twin `--tx-4` would regress dark to ~2.4:1. Its light-mode faintness is a separate, low-severity
  item. **Sev: Low.**

## What I tested / didn't

- **Tested (driveable):** the 7 surfaces above, in the harshest dark skin, with empirical contrast.
- **Not driveable here:** the Quick-Capture global-hotkey window (separate BrowserWindow, OS hotkey);
  real classifier/enrichment/delegation **quality** (needs real LLM + real data — that's the owner's
  `real-use-validation.md` protocol, deliberately not run against the real vault).

## Confidence & recommendation

**High** for the three fixes — each is verified by contrast math, a source-level test, and (for #3)
a live before/after re-probe + screenshot. The remaining sub-AA items are design/brand decisions
surfaced for your call. Recommend deciding F-B (brand accent) and the F-C instructional-text line;
the rest are acceptable-by-design.
