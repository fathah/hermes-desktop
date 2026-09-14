# Loading Indicators

All renderer loading states use the [thinking-orbs](https://www.npmjs.com/package/thinking-orbs) dotted-orb canvas animations through one theme-aware wrapper, replacing the old `react-loader-spinner` Grid and the CSS `.loading-spinner` circle.

## OrbLoader wrapper

[[src/renderer/src/components/OrbLoader.tsx#OrbLoader]] pins the orb theme from Hermes' own theme registry instead of the library's auto-detection.

The library's `auto` mode only recognises `data-theme="dark|light"` (or `.dark`/`.light` classes) and otherwise falls back to `prefers-color-scheme`. Hermes writes theme **ids** ("dracula", "nord", …) to `data-theme`, so auto-detection would follow the OS instead of the picked theme (e.g. light OS + Dracula theme would render dark ink on a dark background). The wrapper reads the resolved theme id from [[src/renderer/src/components/ThemeProvider.tsx#ThemeProvider]] and maps it to `dark`/`light` via each `ThemeDef.appearance` in `THEMES` ([[src/renderer/src/constants.ts]]).

The wrapper also accepts **any numeric `size`**, not just the two shipped presets. ThinkingOrb's `resolvePreset` throws on any size other than 20 or 64, but callers still need arbitrary pixel footprints (e.g. a 30px chat avatar). So `OrbLoader` snaps the *design* (dot count / tuning) to the nearest preset around `PRESET_MIDPOINT` (42) while setting the *visual* footprint from the requested number via `style` — an explicit `style` from the caller still wins. Any number is therefore safe and never a runtime throw.

An `invert` prop flips the ink relative to the app theme (light-theme ink while the app is dark, and vice versa). Use it when the orb sits on an inverted surface — a light circle on a dark page — so the ink contrasts the circle rather than the page.

## Usage conventions

The library ships two tuned size *designs* (separate tunings, not a scale factor): `20` inline with text, `64` for pane/screen-level loading. `OrbLoader` picks the design from the nearest of those two; the number given is the rendered footprint.

- Chat reasoning summary ("Thinking…"): `state="solving"`, size 20 — [[src/renderer/src/screens/Chat/HistoryRow.tsx]].
- Chat tool-call summary and slash-command pending bubble: `state="working"`, size 20 — [[src/renderer/src/screens/Chat/HistoryRow.tsx]], [[src/renderer/src/screens/Chat/MessageRow.tsx]].
- Screen/pane data fetches (Discover, Memory, Tools, Schedules, Agents, Sessions, Skills, Soul, Kanban, registry browser, profile modal panes): `state="searching"`, size 64 (size 20 for the inline Kanban detail loader).
- Streaming conversation tab chip: `state="composing"`, size 20, in the avatar slot — [[src/renderer/src/screens/Layout/ActiveSessionsBar.tsx]] (see [[window-chrome]]).
- Generating agent turn avatar: `state="solving"` (nearest preset → the 64 design), `invert`ed on a `--text-primary` disc, scaled to the ~30px avatar footprint via `style={{ width, height }}` — [[src/renderer/src/screens/Chat/MessageRow.tsx#HermesAvatar]].

This replaced the former `loadingo.gif` avatar animation — the orb needs no loop-boundary stop dance (a canvas frame never freezes mid-loop the way the gif did), so `HermesAvatar` swaps straight to the agent's [[src/renderer/src/components/common/ProfileAvatar.tsx]] the instant `active` goes false, and falls back to the orb when no agent identity is known (the live typing indicator).

Because the orb ink is monochrome and can wash out against the near-black page, the loading avatar carries a `.chat-avatar-orb` class that backs it with an **inverted circle** — `--text-primary`, which is light on dark themes and dark on light themes — and passes `invert` to [[src/renderer/src/components/OrbLoader.tsx#OrbLoader]] so the ink flips to match: a dark orb on a white disc under a dark theme, a light orb on a dark disc under a light theme. The canvas is inset slightly so the dots sit inside the circle instead of clipping at its edge.

Tests mock `thinking-orbs` in [[src/renderer/src/test/setup.ts]] because its canvas + IntersectionObserver rendering has no jsdom equivalent.
