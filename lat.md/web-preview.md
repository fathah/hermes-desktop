# Web preview webview

The chat screen can open a split-screen [[src/renderer/src/screens/Chat/WebPreviewPanel.tsx#WebPreviewPanel]] — an embedded Electron `<webview>` with a browser toolbar and an inspect-element mode — so the agent's links and locally served apps render in-app instead of an external browser.

The toolbar opens `https://nept.cloud` by default through [[src/renderer/src/screens/Chat/WebPreviewPanel.tsx#DEFAULT_WEB_PREVIEW_URL]]. It auto-opens other destinations when an in-app link is clicked or a web tool reports a URL, via the `web-preview:navigate` `CustomEvent` that [[src/renderer/src/screens/Chat/Chat.tsx]] listens for. Annotation mode runs the fixed picker from [[src/main/web-preview-inspector.ts]] in Electron isolated world `1001`, returning a validated numeric handle, CSS selector, and bounding rectangle through narrow preload IPC methods. Hermes retains a bounded map of selected DOM elements only inside that isolated world and remeasures every rectangle in one batch, keeping the host-rendered outlines and floating comments centered on independently moving or reflowing selections. The composer reacts to preview resizing and clamps to every viewport edge. Its arrow saves a preview-local pin and automatically rearms the picker so the user can annotate many elements. A separate floating **Execute** button sends or queues all saved selector/comment pairs as one ordered UI-edit request; annotation text never enters the main chat draft. Individual pins can be removed, full navigation clears the batch, and same-document SPA navigation preserves still-connected pins. The inspected page cannot spoof results or read comments, and element HTML is never submitted. Annotation controls inherit the app-wide [[sidebar-navigation#Sidebar recent sessions#Row context menu|native inset keyboard-focus treatment]] instead of drawing an accent outline.

Same-document navigation keeps the current DOM ready. The panel updates its address and cancels any active inspection without clearing DOM readiness, because Electron does not emit another `dom-ready` after SPA `pushState`, `replaceState`, or hash navigation. `did-stop-loading` also restores readiness when a fast cached load emitted `dom-ready` before React attached its listeners, preventing Edit and annotation pickers from becoming inert.

The panel's width is free-resizable: a drag handle on its left edge sets a `width` clamped between `MIN_PANEL_WIDTH` and `window.innerWidth - 360`, persisted to `localStorage` under `hermes:webPreviewWidth`. During a drag the webview's `pointer-events` are disabled so it doesn't swallow the move stream. Its toolbar fullscreen toggle overlays the chat workspace without remounting the webview, so browsing and annotation state survive; the same button or Escape restores the previous persisted split width.

## Toolbar keyboard shortcuts

Every web-preview tool has a platform-native shortcut that works from both the host toolbar and the focused embedded page.

Immediate custom tooltips use a full-preview-width background below the toolbar, with the tool name and shortcut on separate centered lines. They appear on hover or keyboard focus, while `aria-keyshortcuts` exposes the same chord to assistive technology.

Active Edit and Annotate pills use a darkened accent fill with a white foreground, keeping both their icon and status label legible against the selected background.

| Tool            | Shortcut                        |
| --------------- | ------------------------------- |
| Back / Forward  | `Cmd/Ctrl + [` / `Cmd/Ctrl + ]` |
| Reload          | `Cmd/Ctrl + R`                  |
| Focus address   | `Cmd/Ctrl + L`                  |
| Edit element    | `Cmd/Ctrl + Shift + E`          |
| Annotate        | `Cmd/Ctrl + Shift + C`          |
| Fullscreen      | `Cmd/Ctrl + Shift + F`          |
| Open externally | `Cmd/Ctrl + Shift + O`          |
| Close preview   | `Cmd/Ctrl + Shift + W`          |
| Save or execute | `Cmd/Ctrl + Enter`              |

Because guest-page keystrokes do not bubble into React, [[src/main/app/start.ts#startMainProcess]] matches only the fixed chords through [[src/shared/web-preview-shortcuts.ts#matchWebPreviewShortcut]], prevents their guest-page action, and relays a validated action ID through the preload bridge. No arbitrary key or guest data crosses IPC.

## First-run tool guide

New users see a four-step, non-modal coach card explaining Edit, Comment, Execute, preview controls, and shortcut discovery without blocking the embedded page.

The guide offers Back, Next, Skip, and Got it controls. Skip and completion write `complete` to `localStorage` under [[src/renderer/src/screens/Chat/WebPreviewPanel.tsx#WEB_PREVIEW_GUIDE_STORAGE_KEY]], so the versioned walkthrough appears only once and can evolve under a future key.

## Live element editing

Edit mode provides a transparent glass, host-side typography panel that previews safe text and style changes immediately, remains clamped inside the preview, and asks the agent to persist a saved result in source.

The picker retains the selected element in isolated world `1001`. [[src/main/web-preview-inspector.ts#readWebPreviewElementEditState]] returns validated text, computed typography, and original inline values; [[src/main/web-preview-inspector.ts#applyWebPreviewElementEdit]] accepts only text content plus color, font family, size, weight, alignment, line height, and letter spacing. Text editing is disabled for elements containing nested markup to avoid destroying child structure. No HTML or arbitrary JavaScript crosses the bridge.

Every control live-updates the retained DOM node. Font family is a keyboard-accessible selection of common families that preserves an unlisted computed font as the current option; its trigger and every row render in that font with an `Aa` sample. Reset and Cancel restore the original text and inline declarations, while Save keeps the visual preview and queues a precise selector-and-final-values source edit through [[src/renderer/src/screens/Chat/Chat.tsx]]. The floating editor tracks reflow using the same batched measurement loop as annotation pins and is mutually exclusive with comment picking. It prefers either side of the selection, then uses a non-overlapping band above or below with internal scrolling when vertical space is tight.

## Webview identification and HTTPS policy

The preview is the only webview allowed to load remote HTTPS; all others stay restricted to loopback HTTP. It is identified by its `partition="web-preview"` attribute, which Electron forwards to both security gates (unlike `name`).

[[src/main/security.ts#isAllowedWebviewUrl]] gains an `allowHttps` flag: HTTPS and `about:blank` are permitted only when the caller passes it. Two gates set that flag for the preview, each identifying it by a signal Electron actually exposes at that point:

- **Attach gate** — [[src/main/app/start.ts#startMainProcess]]'s `will-attach-webview` handler reads `params.partition === "web-preview"` (attributes are forwarded as a `Record<string, string>`) and, when true, calls `isAllowedWebviewUrl(src, true)`.
- **Navigation gate** — in `web-contents-created`, [[src/main/app/start.ts#startMainProcess]] calls [[src/main/security.ts#hardenAttachedWebContents]], which applies the `allowHttps` flag to web-preview navigations.

The session comparison is deliberate: `getLastWebPreferences()` is not a public Electron API (returns `undefined`), so reading attributes back from the attached webContents is unreliable — the partition session is the only signal available in `web-contents-created`. Without it, redirects (e.g. `google.com` → `www.google.com`) and subsequent navigations are wrongly blocked even though the initial attach succeeded.

Remote pages still run fully sandboxed: `hardenWebviewPreferences` forces `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true` and deletes any preload, so loading arbitrary HTTPS grants the page no host or Node access.
