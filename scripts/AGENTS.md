<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# scripts

## Purpose

Build-time Node scripts that produce release artifacts. Run by CI or manually after a release.

## Key Files

| File | Description |
|------|-------------|
| `generate-winget-manifests.mjs` | Generates Microsoft winget package manifests (Installer / Locale / Version YAML) from `build/winget/*.template.yaml` for the latest release |

## For AI Agents

### Working In This Directory

- Scripts are ESM (`.mjs`) and use Node 22+ built-ins only — no external dependencies should be added without checking `package.json` first.
- The winget generator reads the version from `package.json` and the installer URL/SHA from a GitHub release; keep both inputs explicit.
- Output of the generator is intended for submission to [`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs); do not commit the generated YAMLs into this repo.

### Testing Requirements

- `tests/winget-generator.test.ts` exercises the template substitution path.

### Common Patterns

- Scripts log progress to stdout, exit non-zero on failure, and write artifacts to a path passed via CLI args (no implicit cwd writes).

## Dependencies

### Internal

- `build/winget/*.template.yaml` — input templates
- `package.json` — version source

### External

- Node 22+ standard library only

<!-- MANUAL: -->
