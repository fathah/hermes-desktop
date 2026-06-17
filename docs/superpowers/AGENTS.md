<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# superpowers

## Purpose

Planning and design-spec documents produced via the `superpowers` skill workflow. Each plan describes a discrete project (date-prefixed); each spec captures the design decisions for the same project. These are **historical artifacts** — they describe what we chose to build and why, not what we are currently building.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `plans/` | Implementation plans (one large markdown per project, date-prefixed) |
| `specs/` | Design specs paired with the plans |

## Current Contents

| File | Project |
|------|---------|
| `plans/2026-04-30-windows-winget-fedora-rpm-release.md` | Plan: ship Windows winget + Fedora RPM release artifacts |
| `specs/2026-04-30-windows-winget-fedora-rpm-release-design.md` | Design spec for the same project |

## For AI Agents

### Working In This Directory

- **Don't edit historical plans/specs** without a strong reason. They document past decisions and serve as audit trail.
- **Adding a new plan**: use `YYYY-MM-DD-short-slug.md` in `plans/`, paired with `YYYY-MM-DD-short-slug-design.md` in `specs/`.
- **Don't use these for session notes.** Working memory belongs in `.omc/` or local scratch files. Plans here are durable, shared with the team.
- Cross-link between plan and spec, and reference relevant code paths with relative paths.

### Testing Requirements

None.

### Common Patterns

- Markdown with H1 title, status/owner header, dated entries, and explicit "Open Questions" / "Decisions" sections.
- Heavy use of code-fenced examples and command snippets.

## Dependencies

### Internal

- May reference code in `src/main/installer.ts`, `scripts/generate-winget-manifests.mjs`, `build/winget/`, `.github/workflows/release.yml`.

### External

None.

<!-- MANUAL: -->
