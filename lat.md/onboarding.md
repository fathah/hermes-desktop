# Onboarding Chrome

The first-run screens (Welcome, Install) share one cinematic shell — a dark aurora backdrop, twinkling starfield, and an animated Hermes emblem — provided by [[src/renderer/src/components/common/OnboardHero.tsx#OnboardHero]]. Titles are upright sans; the design intentionally runs dark regardless of theme.

## OnboardHero

[[src/renderer/src/components/common/OnboardHero.tsx#OnboardHero]] renders the shared `onboard-*` chrome: aurora + vignette + starfield backdrop, a glowing emblem, an uppercase `eyebrow` label, an upright `title`, and page-specific `children` inside a reveal-on-settle body.

Props: `eyebrow`, `title`, `children`, `intro` (play the full intro), `wide` (widen the column for the installing terminal). All visual tokens live under the `ONBOARDING HERO (shared)` block in `main.css`.

The screens are `user-select: none` chrome; only `input`, `textarea`, `code`, and `[data-selectable]` stay selectable (so the install path and log can still be copied).

### Intro choreography

When `intro` is set (the Welcome screen), the emblem draws itself **big in the centre**, then flies up and shrinks into its settled slot before the content cascades in.

The component holds a `phase` of `draw → settle → done`. On mount a timer at `DRAW_MS` (the stroke-draw + fill completes) measures the settled emblem's `getBoundingClientRect`, sets the flying logo's transform to translate/scale into that slot, and switches to `settle`; a second timer at `DRAW_MS + SETTLE_MS` switches to `done`, which removes the flying overlay and runs the reveal cascade via the `[data-phase="done"]` CSS rules. `prefers-reduced-motion` skips straight to `done` with no fly.

The stroke-draw itself is pure CSS: each emblem path animates `onboardDraw` (dash offset) → `onboardFill` (fill-opacity) → `onboardStrokeOut`, staggered per path via the `.onboard-fp{1..4}` classes.

## Welcome

[[src/renderer/src/screens/Welcome/Welcome.tsx#Welcome]] is the default first-run view. Its no-error state renders through `OnboardHero intro`.

The hero carries the "HERMES ONE" eyebrow, subtitle, a gradient "Get Started" pill, and glass "Connect via SSH" / "Connect to Remote Hermes" pills. The install-error state and the SSH / remote connect panels keep the legacy `.welcome-screen` layout.

## Install confirm + progress

[[src/renderer/src/screens/Install/Install.tsx#Install]] renders both the pre-install confirmation and the running progress through `OnboardHero` (no intro — the emblem fades in place).

The confirm view (eyebrow "SETUP", title "Before installing") shows the target path in an `.onboard-field`, a `.onboard-note-card` describing the fresh/update/replace state, and Install / Use-existing / Cancel actions.

The progress view (`wide`) shows a step + percent header with a progress bar, then a **fixed-size** terminal log window (`.onboard-terminal`): its body has a constant height and scrolls internally, so streaming log lines never reflow the surrounding layout. The log auto-scrolls to the newest line.

## Startup splash

The very first frame on launch is still [[src/renderer/src/screens/SplashScreen/SplashScreen.tsx]], shown by [[src/renderer/src/App.tsx#App]] while `runInstallCheck` runs. It is separate from the onboarding chrome above — see [[main-process]] for its "Switch to local mode" escape hatch.
