# Automatic session title generation

Untitled local sessions receive a short fallback title from their first user message when the session cache is populated. Explicit database titles and existing cached titles keep their current precedence.

[[src/main/session-cache.ts#generateTitle]] removes Markdown decoration and URLs, then uses the existing 50-unit short-message threshold and 45-unit truncation budget. These budgets count UTF-16 code units; word-boundary selection is unchanged.

## Unicode truncation

Fallback truncation must never split a valid surrogate pair into a malformed title. If the 45-unit boundary bisects a supplementary character, stop one unit earlier before adding the ellipsis.

[[tests/session-cache-sync.test.ts]] exercises the real cache synchronization and subsequent disk-cache read using emoji, mixed CJK/emoji, exact pair boundaries, short messages and an ASCII control. This protects newly generated fallback titles without rewriting user-chosen titles or existing cached entries.
