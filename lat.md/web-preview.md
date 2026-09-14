# Web preview webview

The chat screen can open a split-screen [[src/renderer/src/screens/Chat/WebPreviewPanel.tsx#WebPreviewPanel]] — an embedded Electron `<webview>` with a browser toolbar and an inspect-element mode — so the agent's links and locally served apps render in-app instead of an external browser.

It auto-opens when an in-app link is clicked or a web tool reports a URL, via the `web-preview:navigate` `CustomEvent` that [[src/renderer/src/screens/Chat/Chat.tsx]] listens for. Annotation mode runs the fixed picker from [[src/main/web-preview-inspector.ts]] in Electron isolated world `1001`, returning a validated CSS selector and bounding rectangle through narrow preload IPC methods. Hermes renders the selected outline and floating comment composer above the webview, so the inspected page cannot spoof the result or read the comment. Submitting inserts only the unique CSS selector and comment into chat—never the element HTML. Annotation controls inherit the app-wide [[sidebar-navigation#Sidebar recent sessions#Row context menu|native inset keyboard-focus treatment]] instead of drawing an accent outline.

Same-document navigation keeps the current DOM ready. The panel updates its address and cancels any active inspection without clearing DOM readiness, because Electron does not emit another `dom-ready` after SPA `pushState`, `replaceState`, or hash navigation.

The panel's width is free-resizable: a drag handle on its left edge sets a `width` clamped between `MIN_PANEL_WIDTH` and `window.innerWidth - 360`, persisted to `localStorage` under `hermes:webPreviewWidth`. During a drag the webview's `pointer-events` are disabled so it doesn't swallow the move stream.

## Webview identification and HTTPS policy

The preview is the only webview allowed to load remote HTTPS; all others stay restricted to loopback HTTP. It is identified by its `partition="web-preview"` attribute, which Electron forwards to both security gates (unlike `name`).

[[src/main/security.ts#isAllowedWebviewUrl]] gains an `allowHttps` flag: HTTPS and `about:blank` are permitted only when the caller passes it. Two gates set that flag for the preview, each identifying it by a signal Electron actually exposes at that point:

- **Attach gate** — [[src/main/app/start.ts#startMainProcess]]'s `will-attach-webview` handler reads `params.partition === "web-preview"` (attributes are forwarded as a `Record<string, string>`) and, when true, calls `isAllowedWebviewUrl(src, true)`.
- **Navigation gate** — in `web-contents-created`, [[src/main/app/start.ts#startMainProcess]] calls [[src/main/security.ts#hardenAttachedWebContents]], which applies the `allowHttps` flag to web-preview navigations.

The session comparison is deliberate: `getLastWebPreferences()` is not a public Electron API (returns `undefined`), so reading attributes back from the attached webContents is unreliable — the partition session is the only signal available in `web-contents-created`. Without it, redirects (e.g. `google.com` → `www.google.com`) and subsequent navigations are wrongly blocked even though the initial attach succeeded.

Remote pages still run fully sandboxed: `hardenWebviewPreferences` forces `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true` and deletes any preload, so loading arbitrary HTTPS grants the page no host or Node access.
