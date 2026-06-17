<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# docs

## Purpose

Long-form planning documents, design specs, and release-process notes. This directory is **not** auto-generated API docs — those are kept in code.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `superpowers/` | Planning and spec docs produced via the `superpowers` skill workflow (see `superpowers/AGENTS.md`) |

## For AI Agents

### Working In This Directory

- Treat existing plans/specs as historical artifacts — they describe past decisions and shouldn't be edited without reason.
- When adding new planning docs, follow the date-prefixed naming convention used in `superpowers/plans/` (e.g. `2026-04-30-feature-name.md`).
- Do **not** write per-session task notes or working memory here — those belong in `.omc/` or local scratch files.

### Testing Requirements

None — this directory is documentation only.

### Common Patterns

- Markdown only, with H1 title, status header, and dated entries.
- Cross-link related plans/specs explicitly.

## Dependencies

### Internal

- Plans may reference work in `src/` or `tests/` — keep references as relative paths.

### External

None.

<!-- MANUAL: -->
