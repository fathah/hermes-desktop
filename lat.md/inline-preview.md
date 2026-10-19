# Inline preview directive

The `::preview{file="…"}` transcript directive renders a workspace HTML file live inside an assistant message — a sandboxed `srcdoc` iframe fed by a main-process text read — instead of a download link or an external browser.

[[src/renderer/src/screens/Chat/mediaUtils.ts#parseMediaTokens]] recognises the directive before the media passes (word-boundary `::preview{…}`, quoted `file`/`height` attributes, only `.html`/`.htm`/`.xhtml` targets) and emits a `preview` segment; it also records the directive's span so a path inside it is never re-parsed as bare media. [[src/renderer/src/components/InlinePreview.tsx#InlinePreview]] reads the file through [[src/main/media.ts#readHtmlFileText]] via the `read-preview-file` IPC bridge and renders it in a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`). A theme prelude injects the app's resolved theme tokens under friendly names; a measurement script shrink-wraps the frame height. A failed read falls back to the literal directive text.

## Widget intents

A widget can talk back: an injected script defines `window.hermes.send(prompt)` and wires `data-hermes-send="…"` clicks, posting the prompt to the parent tagged with the mount token.

[[src/renderer/src/components/InlinePreview.tsx#InlinePreview]] validates the intent (type, mount token, 500-char cap, 1/s throttle) and re-emits it as an `inline-preview:send` DOM event, which [[src/renderer/src/screens/Chat/Chat.tsx]] routes through the ordinary send path — so a widget's "Refresh" button wakes the agent, which re-emits an updated `::preview`.

## Scope and sandboxing

The frame is opaque-origin and script-only, so the document cannot reach app cookies, storage, or IPC.

Reads are local-filesystem only and capped at 4 MiB; remote URLs stay out of scope — the [[web-preview]] webview panel remains the surface for remote HTTPS.
