<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-05-15 | Updated: 2026-05-15 -->

# locales

## Purpose

Per-language translation catalogs. Each language has its own folder containing the same set of namespace files (`agents.ts`, `chat.ts`, `common.ts`, `constants.ts`, ...). English is the source of truth.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `en/` | English — source of truth, populated for every namespace |
| `es/` | Spanish |
| `id/` | Indonesian |
| `ja/` | Japanese |
| `pt-BR/` | Brazilian Portuguese |
| `zh-CN/` | Simplified Chinese |

## Namespace Files (per locale)

| File | Covers |
|------|--------|
| `agents.ts` | Agents/profiles screen |
| `chat.ts` | Chat UI, slash commands, model picker |
| `common.ts` | Buttons, dialogs, generic actions |
| `constants.ts` | Slash command descriptions, provider/gateway labels — mirrors `src/renderer/src/constants.ts` |
| `errors.ts` | Error/failure messages |
| `gateway.ts` | Messaging gateway screen |
| `install.ts` | Installer steps and prompts |
| `memory.ts` | Memory screen |
| `models.ts` | Models screen |
| `navigation.ts` | Side nav / tab labels |
| `office.ts` | Claw3d Office screen |
| `providers.ts` | LLM provider picker |
| `schedules.ts` | Schedules / cron screen |
| `sessions.ts` | Sessions list |
| `settings.ts` | Settings screen |
| `setup.ts` | First-run setup flow |
| `skills.ts` | Skills screen |
| `soul.ts` | Persona / SOUL.md screen |
| `tools.ts` | Tools screen |
| `welcome.ts` | Welcome / initial screen |

## For AI Agents

### Working In This Directory

- **Source of truth**: `en/`. When starting a new locale, copy the full `en/` tree and translate each value.
- **Key parity is not enforced by tests** — add new keys to every locale or the UI will fall back to English (or show the raw key, depending on i18next config).
- **Don't translate technical strings** that match a product term: provider names, brand names, slash command identifiers (only the *descriptions* should be translated, not `/new` itself).
- **Plurals and interpolations**: use i18next syntax (`{{count}}`, `_one` / `_other` suffix keys) — see the English catalog for examples.

### Testing Requirements

- `../index.test.ts` ensures all namespaces in the default locale load.
- Manual verification: change locale in Settings and walk through each screen.

### Common Patterns

- Each `.ts` file `export default { key: "value", group: { nested: "value" } } as const`.
- Identical shape across locales — diffing two catalogs for the same namespace should reveal only value changes.

## Dependencies

### Internal

- Consumed by `../index.ts` (i18next registration)
- `constants.ts` mirrors `src/renderer/src/constants.ts` shape

### External

None.

<!-- MANUAL: -->
