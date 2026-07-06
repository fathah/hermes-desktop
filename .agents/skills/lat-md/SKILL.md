---
name: lat-md
description: >-
  Writing and maintaining lat.md documentation files — structured markdown that
  describes a project's architecture, design decisions, and test specs. Use when
  creating, editing, or reviewing files in the lat.md/ directory.
---

# lat.md Authoring Guide

This skill covers the syntax, structure rules, and conventions for writing `lat.md/` files. Load it whenever you need to create or edit sections in the `lat.md/` directory.

## What belongs in lat.md

`lat.md/` files describe **what** the project does and **why** — domain concepts, key design decisions, business logic, and test specifications. They do NOT duplicate source code. Think of each section as an anchor that source code references back to.

Good candidates for sections:
- Architecture decisions and their rationale
- Domain concepts and business rules
- API contracts and protocols
- Test specifications (what is tested and why)
- Non-obvious constraints or invariants

Bad candidates:
- Step-by-step code walkthroughs (the code itself is the walkthrough)
- Auto-generated API docs (use tools for that)
- Temporary notes or TODOs

## Section structure

Every section **must** have a leading paragraph — at least one sentence immediately after the heading, before any child headings or other block content.

The first paragraph must be ≤250 characters (excluding `[[wiki link]]` content). This paragraph is the section's identity — it appears in search results, command output, and RAG context.

```markdown
# Good Section

Brief overview of what this section documents and why it matters.

More detail can go in subsequent paragraphs, code blocks, or lists.

## Child heading

Details about this child topic.
```

```markdown
# Bad Section

## Child heading

This is invalid — "Bad Section" has no leading paragraph.
```

`lat check` enforces this rule.

## Section IDs

Sections are addressed by file path and heading chain:

- **Full form**: `lat.md/path/to/file#Heading#SubHeading`
- **Short form**: `file#Heading#SubHeading` (when the file stem is unique)

Examples: `lat.md/tests/search#RAG Replay Tests`, `cli#init`, `parser#Wiki Links`.

## Wiki links

Cross-reference other sections or source code with `[[target]]` or `[[target|alias]]`.

### Section links

```markdown
See [[cli#init]] for setup details.
The parser validates [[parser#Wiki Links|wiki link syntax]].
```

### Source code links

Reference functions, classes, constants, and methods in source files:

```markdown
[[src/config.ts#getConfigDir]]          — function
[[src/server.ts#App#listen]]            — class method
[[lib/utils.py#parse_args]]             — Python function
[[src/lib.rs#Greeter#greet]]            — Rust impl method
[[src/app.go#Greeter#Greet]]            — Go method
[[src/app.h#Greeter]]                   — C struct
```

`lat check` validates that all targets exist.

## Code refs

Tie source code back to `lat.md/` sections with `@lat:` comments:

```typescript
// @lat: [[cli#init]]
export function init() { ... }
```

```python
# @lat: [[cli#init]]
def init():
    ...
```

Supported comment styles: `//` (JS/TS/Rust/Go/C) and `#` (Python).

Place one `@lat:` comment per section, at the relevant code — not at the top of the file.

## Test specs

Describe tests as sections in `lat.md/` files. Add frontmatter to require that every leaf section has a matching `@lat:` comment in test code:

```markdown
---
lat:
  require-code-mention: true
---
# Tests

Authentication test specifications.

## User login

Verify credential validation and error handling.

### Rejects expired tokens

Tokens past their expiry timestamp are rejected with 401, even if otherwise valid.

### Handles missing password

Login request without a password field returns 400 with a descriptive error.
```

Each test references its spec:

```python
# @lat: [[tests#User login#Rejects expired tokens]]
def test_rejects_expired_tokens():
    ...
```

Rules:
- Every leaf section under `require-code-mention: true` must be referenced by exactly one `@lat:` comment
- Every section MUST have a description — at least one sentence explaining what the test verifies and why
- `lat check` flags unreferenced specs and dangling code refs

## Frontmatter

Optional YAML frontmatter at the top of `lat.md/` files:

```yaml
---
lat:
  require-code-mention: true
---
```

Currently the only supported field is `require-code-mention` for test spec enforcement.

## Validation

Always run `lat check` after editing `lat.md/` files. It validates:
- All wiki links point to existing sections or source code symbols
- All `@lat:` code refs point to existing sections
- Every section has a leading paragraph (≤250 chars)
- All `require-code-mention` leaf sections are referenced in code
