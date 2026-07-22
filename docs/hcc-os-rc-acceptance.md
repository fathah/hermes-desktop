# HCC OS Release-Candidate Acceptance

Date: 2026-07-22  
Branch: `hcc-os-rc`  
Upstream PR: https://github.com/fathah/hermes-desktop/pull/867

## Integrated desktop gates

- Upstream base: `a335df3`
- HCC integration merge: `857df94`
- Full Vitest suite: `190` files passed; `1855` tests passed; `3` skipped; `0` failed.
- Node and renderer TypeScript checks passed.
- Production renderer/main build passed.
- Production dependency audit reports `0` vulnerabilities.
- `lat check` passed.

## Defects found during installed acceptance

1. HCC reused the remote Hermes gateway URL, routing command-center requests to port `18642` and producing `404` for every HCC API. HCC now owns an independent endpoint: `HCC_API_URL`, defaulting to `http://127.0.0.1:9200`.
2. HCC `Memory` collided with the global sidebar `Memory` accessibility label. Internal targets now use unique `HCC: <view>` labels.
3. The nineteen-item HCC navigation exceeded its viewport. Row sizing now keeps all native targets visible.
4. Native UI Automation readiness was timing-sensitive on heavy views. The harness now waits for the rendered fingerprint and rejects explicit load errors.

## Installed Windows acceptance

Environment limitations:

- Windows Sandbox was unavailable.
- No Hyper-V VM was registered.
- Acceptance therefore used the real per-user NSIS installer with isolated Electron user-data profiles on the Windows host.

Lifecycle results:

| Gate | Result |
|---|---|
| Official `0.7.4-beta.3` clean install | passed |
| Baseline launch with isolated profile | passed |
| Upgrade to HCC RC `0.7.4` | passed |
| Registry version after upgrade | `0.7.4` |
| Existing WSL Hermes gateway connection | passed on `127.0.0.1:18642` |
| Independent HCC command-center connection | passed on `127.0.0.1:9200` |
| Installed native HCC CUA sweep | `19/19` passed |
| HCC unavailable/load errors | `0` |
| RC silent uninstall | passed; registry and executable removed |
| Rollback install to `0.7.4-beta.3` | passed |
| Rollback launch | passed |
| Final rollback uninstall | passed |
| Temporary profile cleanup | passed |

## Final Windows artifacts

Local acceptance artifacts were built with executable editing disabled because Windows Developer Mode was unavailable and electron-builder could not create signing-cache symlinks. CI retains the normal Windows packaging configuration.

```text
hermes-desktop-0.7.4-setup.exe
size: 142644780 bytes
sha256: 81144c06c5467190cf32e33e092e8bf5c9286e210277be196edd0e66d80f5d5c

hermes-desktop-0.7.4-portable.exe
size: 142492614 bytes
sha256: 6e10ed35e8c41048c284f3faa165affb79eb3e047847c65d3483c986c0bfd60b
```

## Delivery controls

Fork `main` requires strict `check` and `windows-package` status checks. Force-push and branch deletion are disabled, and unresolved review conversations block merge.
