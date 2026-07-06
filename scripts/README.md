# Dev scripts — CDP-based E2E harness

This directory hosts dev-only one-shot scripts that drive the running
dev Electron over the Chrome DevTools Protocol. Use it to reproduce
bugs, verify fixes, or probe runtime state — much faster and more
deterministic than screenshot-driven testing.

The harness is **opt-in**: nothing about it touches production builds
or normal `npm run dev` workflows.

## Quickstart

1.  Start dev electron with CDP enabled:

    ```bash
    ENABLE_CDP=1 npm run dev
    ```

    (Or any other free port: `ENABLE_CDP=1 CDP_PORT=9223 npm run dev`.)

2.  In a separate shell, run a script:

    ```bash
    node scripts/e2e-attach.js
    ```

    The shared `attach()` helper connects Playwright to the running
    renderer over `http://127.0.0.1:9222` (or `$CDP_PORT`). You can
    drive the UI with DOM-aware selectors, evaluate IPC calls in the
    renderer, or read state from the running main process.

## Full live visual regression suite

For reconciliation work, use the reusable full-suite driver instead of
assembling one-off snippets:

```bash
npm run test:live-visual
```

It attaches to the running Electron app over CDP and drives the visible
Chat, Sessions, Models, model picker, and attachment controls for
local, remote HTTP, and SSH. It covers:

- valid prompt + restored session
- bad -> good -> bad -> good in one session + restored session
- add/remove model persistence + chat selector availability
- pasted image display live + restored
- generated image display live + restored
- duplicate/missing-message checks for every restored transcript

Reports and screenshots are written to
`.sandbox/live-visual-regression/<run-id>/`.

Useful flags:

```bash
node scripts/drive-live-regression-suite.js --modes=local,remote,ssh
node scripts/drive-live-regression-suite.js --skip-generated
node scripts/drive-live-regression-suite.js --paste-image=C:\path\to\image.png
node scripts/drive-live-regression-suite.js --remote-url=http://127.0.0.1:19080 --remote-token=<token>
```

## How the opt-in works

`src/main/index.ts` reads `process.env.ENABLE_CDP` at startup and, when
set to `"1"`, appends `--remote-debugging-port=<CDP_PORT|9222>` to the
Chromium command line. Without the env var the switch is never added,
so production builds (and normal dev) never expose the port.

```ts
if (process.env.ENABLE_CDP === "1") {
  app.commandLine.appendSwitch(
    "remote-debugging-port",
    process.env.CDP_PORT || "9222",
  );
}
```

Three properties this gives us:

- **Off by default.** A user running the shipped app sees no CDP
  port. An attacker who sets the env var on a prod install still
  hits the existing Electron security model (sandbox,
  contextIsolation, preload allowlist) — they get whatever a regular
  user would.
- **Per-developer.** Whoever wants the harness flips one env var;
  everyone else has zero footprint.
- **Multi-window safe.** `CDP_PORT` lets you run multiple dev
  electron instances side-by-side (a clean profile + a real profile,
  for instance) without port collisions.

## Writing a repro script

The convention used by the existing scripts:

```js
// scripts/repro-my-bug.js
const { attach } = require("./e2e-attach");

(async () => {
  const { browser, page } = await attach();
  // …drive the app via page.click / page.fill / page.evaluate…
  // …observe DOM, IPC return values, on-disk state…
  const verdict = /* boolean check */;
  console.log(`[VERDICT] ${verdict ? "✅" : "🔴"} <what was tested>`);
  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e.stack || e.message || e);
  process.exit(1);
});
```

Naming conventions:

| Prefix | Purpose | Lives long? |
|---|---|---|
| `repro-<short-name>.js` | Reproduce a specific bug. Pair with an issue number or commit. Print `[VERDICT] 🔴 REPRODUCED` (pre-fix) or `[VERDICT] ✅ FIXED` (post-fix). | Until the fix is shipped + a regression test exists; then it can be deleted or kept as a manual reference. |
| `drive-<flow>.js` | Walk through a user flow end-to-end (e.g. OAuth sign-in, model switch + chat). | Keep alongside the feature so future contributors can re-run. |
| `probe-<aspect>.js` | Read-only inspection. No state mutation. Useful for understanding a bug before writing a repro. | Useful long-term as documentation. |
| `verify-<feature>.js` | Live verifier paired with a PR. Asserts `[VERDICT A/B/C/D]` lines for each contract the PR claims. | Lives with the PR; can be repurposed as a manual smoke test. |

## Things to remember

- **The harness is a Node CommonJS script**, not part of the TS build.
  Use `require()`. The project's ESLint config ignores
  `scripts/e2e-attach.js`, `scripts/repro-*.js`, `scripts/probe-*.js`,
  `scripts/drive-*.js`, and `scripts/verify-*.js` so the
  `no-require-imports` rule doesn't fire here.

- **`page.evaluate(async () => window.hermesAPI.foo())` is your friend.**
  The renderer's `hermesAPI` is exposed via contextBridge, so the
  harness can call any IPC the UI can. This is often more reliable
  than driving clicks, especially for tests of main-process state.

- **Don't close the dev electron from the script** —
  `browser.close()` detaches Playwright but leaves the app running.
  If you need the app gone, kill it separately.

- **Restart `npm run dev` after main-process changes.**
  electron-vite hot-reloads renderer files, but main-process changes
  don't always restart the bundled main binary. When in doubt, kill
  the electron processes and restart dev.

- **Port 9222 can get stuck in a zombie LISTEN state** on Windows
  after a force-kill. If `bind() returned an error` shows up in the
  dev log, switch to `CDP_PORT=9223` (or any other free port).

## A real example

The patterns above came out of triaging the v0.5.1 bug reports
("Session continuation requires API key authentication", session
proliferation, Edit Model dialog API-key bug, Nous Portal silent
misconfiguration). Each reproducible bug got a `repro-*.js` that
flipped from 🔴 pre-fix to ✅ post-fix in under a minute — vs the
multi-minute screenshot loop the same flow used to require.

If you write a useful repro, add it to this directory and link it
from the related PR / issue. The next contributor will thank you.
