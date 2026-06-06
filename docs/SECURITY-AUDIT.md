# Security Audit — npm advisory baseline

This document records the project's `npm audit` posture: what was remediated, and the
**intentionally-accepted residual** with the rationale for each. It exists so that a non-empty
`npm audit` is an interpretable, reviewable baseline rather than ambient noise.

Last reviewed: 2026-06-06 (Hermes Desktop 0.5.4).

## Summary

|        | Low | Moderate | High | Total                            |
| ------ | --- | -------- | ---- | -------------------------------- |
| Before | 1   | 13       | 5    | 19                               |
| After  | 1   | 9        | 3    | **13 (all accepted, see below)** |

Remediation was deliberately **surgical**: scoped `overrides` for the cleanly-patchable
dev/build-time advisories, no semver-major bumps, and **no** `@excalidraw/excalidraw` downgrade
(its only npm-known "fix" is 0.17.6, which requires React 17/18 and is incompatible with this
React 19 app). `npm audit fix --force` is therefore unsafe here and must not be run.

## Remediated (via `overrides` in `package.json`)

All dev/build-time, pinned forward within the same semver major (low risk):

| Package                 | Fixed to  | Owner                                     | Advisory                                        |
| ----------------------- | --------- | ----------------------------------------- | ----------------------------------------------- |
| `@xmldom/xmldom`        | `^0.8.13` | electron-builder → plist                  | DoS / XML injection (was `<0.8.13`)             |
| `tmp`                   | `^0.2.6`  | electron-builder → flatpak-bundler        | path traversal (was `<0.2.6`)                   |
| `ip-address`            | `^10.2.0` | electron-builder → node-gyp               | XSS in Address6 (was `<=10.1.0`)                |
| `ws`                    | `^8.21.0` | vitest → jsdom                            | uninitialized memory disclosure (was `<8.20.1`) |
| `postcss`               | `^8.5.15` | vite                                      | XSS via unescaped `</style>` (was `<8.5.10`)    |
| `nanoid` (3.x)          | `^3.3.12` | `@excalidraw/excalidraw` (pinned `3.3.3`) | predictable IDs (was `<3.3.8`)                  |
| `brace-expansion` (5.x) | `5.0.6`   | minimatch@10 (eslint toolchain)           | ReDoS via numeric range (was `>=5.0.0 <5.0.6`)  |

Notes on scoping:

- `nanoid` and `brace-expansion` are **version/parent-scoped** overrides, not global. A global
  `nanoid` override would clobber excalidraw's transitive `nanoid@4.x`; a global `brace-expansion`
  override would force CommonJS consumers of 1.x/2.x onto the **ESM-only** 5.x line. The overrides
  target only the vulnerable instances (`nanoid@3.3.3`, and `brace-expansion` under `minimatch@^10`).

## Accepted residual (13) — not fixable without breaking the app

### 1. `lodash` (high) + `lodash-es` (high) — no patched 4.x exists

GHSA-r5fr-rjxr-66jc (`_.template` code injection), GHSA-xxjr-mmjv-4gpg / GHSA-f23m-r3pf-42rh
(`_.unset`/`_.omit` prototype pollution). The advisories' vulnerable range is `<=4.17.23` with **no
fixed 4.x published** — the only "fix" is a hypothetical lodash 5 that does not exist as a stable
release. There is no override that clears these.

- `lodash` is **dev-only** (electron-winstaller → electron-builder; runs at Windows-installer build time).
- `lodash-es` **ships**, but is reachable only through Mermaid diagram parsing
  (`mermaid`/`@excalidraw` → `@mermaid-js/parser` → `langium` → `chevrotain`). chevrotain uses lodash
  internally for **parser construction**, not to evaluate user-controlled template strings or
  `_.unset`/`_.omit` array paths. Real exploitability against our usage is low. Diagram source is
  authored locally by the user, not remote/multi-tenant input.

### 2. Excalidraw / Mermaid subtree (moderate ×7) — pinned by `@excalidraw/excalidraw@0.18.1`

`@excalidraw/excalidraw`, `@excalidraw/mermaid-to-excalidraw`, `@mermaid-js/parser`, `langium`,
`chevrotain`, `@chevrotain/gast`, `@chevrotain/cst-dts-gen`, and `nanoid@4.x`
(GHSA-mwcw-c2x4-8c55, "predictable results when given non-integer values").
These are transitively pinned by excalidraw's own dependency tree. npm's only proposed fix is to
**downgrade `@excalidraw/excalidraw` to 0.17.6**, which declares a React 17/18 peer and is
**incompatible with this React 19 app** — it would break the build. The `nanoid@4.x` advisory in
particular requires jumping to the **ESM-only `nanoid@5.0.9`**, which `mermaid-to-excalidraw` does
not support; the practical impact is nil because excalidraw never calls `nanoid()` with a
non-integer size. Re-evaluate when a future `@excalidraw/excalidraw` release moves these forward.

### 3. `vite` (high/moderate/low) + `esbuild` (moderate) — dead build-time deps of `@wesbos/code-icons`

GHSA-c27g-q93r-2cwf (launch-editor command injection on Windows), GHSA-67mh-4wv8-2f99 (esbuild dev
server), and related path-traversal advisories. **Our own** toolchain `vite` (7.3.5) and `esbuild`
(0.27.x) are patched. The residual comes entirely from `@wesbos/code-icons@1.2.4`, which lists
`vite@^4` + `vite-plugin-dts@1.7.3` as regular `dependencies` (a packaging mistake on their part).
code-icons ships **pre-built icon assets**; that bundled `vite@4.5.14` / `esbuild@0.18.20` is never
executed by our dev server, build, or runtime. Vite 4.x has no in-major fix, and code-icons'
`vite-plugin-dts@1.7.3` cannot move to vite 7, so forcing it would break nothing real but is not
worth the churn. Accepted as non-executing dead weight.

### 4. `@wesbos/code-icons` (low) — fix is a semver-major

GHSA chain via the bundled vite above; the only "fix" is a major bump of code-icons. Deferred with
the rest of the code-icons build-tooling residual.

## Operational notes

- **Do not run `npm audit fix --force`** — it downgrades `@excalidraw/excalidraw` to a React-17/18
  release and breaks the React 19 build.
- The remediation is fully reversible: delete the `overrides` block in `package.json` and
  `npm install` to revert.
- There is currently **no CI `npm audit` gate**; if one is added, allowlist the advisory IDs above
  (e.g. via `audit-ci` / `.nsprc`) so the gate fails only on _new_ advisories.
