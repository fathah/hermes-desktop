# Collapsible code blocks

Long fenced code blocks in agent messages render collapsed behind a "Show more" / "Show less" toggle, so a big file dump doesn't bury the rest of the conversation. [[src/renderer/src/components/AgentMarkdown.tsx]]'s `CodeBlock` treats a block as long when it exceeds 15 lines or 800 characters.

## Expansion must survive streaming remounts

The expand/collapse choice is stored in a module-level `Set` keyed by the block's source position, not in plain component state — otherwise it resets to collapsed mid-stream.

While a message is still streaming, react-markdown re-parses the growing markdown on every token. Its index-based child keys shift as the AST grows, so a `CodeBlock` is frequently unmounted and remounted; a per-component `useState(true)` would re-initialize to collapsed on each remount, undoing the user's click.

The fix keys expansion on the opening fence's source offset (`node.position.start.offset`), which is stable as content appends. The `code` component mapper passes it as `blockId`; `CodeBlock` seeds its initial state from `expandedCodeBlocks.has(blockId)` and updates that set on toggle, so an expanded block stays expanded across remounts.

## Box diagrams render plain, not highlighted

Fenced blocks dominated by Unicode box-drawing characters (tree output like `├── src`, table borders, `█░` progress bars) bypass Prism and render as a single plain `<pre><code>` flow via `PlainCodeView`.

Prism fragments each glyph into nested token spans; in Electron renderers with imperfect Unicode metrics that fragmentation visually truncates or misaligns the diagram. Plain rendering also skips the lazy highlighter import and keeps the DOM to one text node. `fontVariantLigatures: "none"` and `unicodeBidi: "isolate"` guard glyph fidelity.

The gate is [[src/renderer/src/components/AgentMarkdown.tsx#isBoxDiagram]]: at least half of the block's non-empty lines must contain a character in U+2500–U+259F (Box Drawing + Block Elements). Density — not mere presence — is the discriminator, so one `│` in a string literal or comment does not demote a whole source file to plain text.

Two precedence rules: `diff` blocks always keep the colored `DiffView` (it never uses Prism, so it has no fragmentation risk), and the header label keeps the fence's declared language — only an unlabeled box diagram is labeled `text`.

[[src/renderer/src/components/AgentMarkdown.test.tsx]] verifies the plain-tree, incidental-glyph, diff, and language-label cases after the lazy Prism import is actually ready; its bounded async wait accommodates a cold highlighter import without weakening the assertions.

## Table cells wrap long unbreakable text

Agent markdown table cells set `overflow-wrap: anywhere` so a long token with no spaces (a Windows path, a URL, a hash) wraps inside its column instead of forcing the table wider than the chat bubble.

Cells already inherit `overflow-wrap: break-word` from `.chat-bubble`, but `break-word` does not contribute soft-wrap opportunities to min-content sizing, so `width: 100%` table auto-layout still sizes the column to the full unbroken string and the table overflows the bubble (or, on narrow windows, clips the edges of the cell). `anywhere` does contribute to min-content, so the column can shrink and the text wraps. `table-layout: fixed` is deliberately not used: it would force equal column widths on every table. [[tests/chat-table-wrap-css.test.ts]] pins the `.chat-bubble-agent th, td` rule in `src/renderer/src/assets/main.css`.
