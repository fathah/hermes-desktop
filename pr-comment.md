## Summary

This PR fixes the production white-screen regression and adjusts the GPU fallback so the Office tab does not get stuck on slow software rendering on macOS.

## What Changed

- Fixed packaged renderer loading after the main-process refactor.
  - `electron-vite` emits the bundled main process at `out/main/index.js`.
  - The release app must resolve `../renderer/index.html` from that runtime directory, not `../../renderer/index.html`.
  - This fixes the production error: `Not allowed to load local resource: .../renderer/index.html`.

- Added production diagnostics for startup failures.
  - `HERMES_OPEN_DEVTOOLS=1` opens DevTools on launch.
  - Release builds expose `Help -> Toggle Developer Tools`.

- Aligned packaged renderer CSP with the main-process CSP.
  - Allows file-backed startup assets for images, media, fonts, and frames.
  - Keeps object loading blocked and base URI constrained.

- Tuned GPU fallback behavior.
  - macOS now ignores and clears stale `disable-gpu.flag` by default to avoid permanently forcing the Office tab onto SwiftShader/software rendering.
  - Windows/Linux still honor the persistent GPU fallback by default for GPU crash-loop protection.
  - `HERMES_GPU_FALLBACK=1` can force the persistent fallback on any platform.
  - `HERMES_DISABLE_GPU=0` still force-enables hardware acceleration and clears the stale flag.

## Verification

- `npm run test -- tests/electron-security.test.ts tests/dashboard-csp.test.ts tests/gpu-fallback.test.ts`
- `npm run test -- tests/gateway-restart.test.ts`
- `npm run build`
- `lat check`

## Notes

For immediate local recovery from the Office lag on macOS:

```bash
rm "$HOME/Library/Application Support/hermes-desktop/disable-gpu.flag"
```

Then relaunch Hermes One.
