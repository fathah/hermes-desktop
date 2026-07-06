# Window title bar and conversation tabs

The top strip of the main window is a browser-style title bar: it is the window's drag region, and the open-conversation tabs live *on* it rather than in a separate bar below, so no vertical space is spent on a dedicated, always-empty drag strip.

On macOS the window is frameless (`titleBarStyle: "hiddenInset"`, traffic lights inset at x/y 16 — see [[src/main/app/start.ts#startMainProcess]]), and [[src/renderer/src/App.tsx]] renders a fixed full-width `.drag-region` (`-webkit-app-region: drag`, z-index 1000) so the whole top band — including over the sidebar/traffic-light area — drags the window. This strip is mac-only; other platforms keep the OS title bar.

`.app` fills the window (`height: 100vh`) so the chrome reaches every edge. The sidebar is a flush full-height panel: it only rounds its left corners (`border-radius: 16px 0 0 16px`) to follow the window's rounded corners, while its right edge is square against the content column.

## Tabs layered above the drag region

[[src/renderer/src/screens/Layout/ActiveSessionsBar.tsx#ActiveSessionsBar]] is the content column's title bar. It owns the top band browser-style: empty space drags, the chips stay clickable.

- The bar itself is `-webkit-app-region: drag` with `position: relative; z-index: 1001`, so it stacks above the global `.drag-region` (z 1000) and is the drag handle for the content column.
- Each `.active-session-chip` opts back out with `-webkit-app-region: no-drag`, keeping select/close clickable above the drag layer — the same priority model browsers use for tabs over a draggable tab strip.
- `min-height: 34px` (≥ the 28px global drag strip) means content rendered after the bar clears the fixed drag layer, so the old `.is-mac .content { padding-top: 28px }` offset is no longer needed.

Visually the strip is a Safari-style tab bar: the strip uses the darker `--bg-secondary` toolbar shade; tabs are flat (no border/fill) and separated by thin vertical dividers drawn with an `::before` on each non-first chip. The active tab fills with `--bg-primary` — the same colour as the transparent content area below it — and rounds its top corners, so it docks into the page; the dividers flanking the active tab are hidden for a seamless join.

## Blank until a real session exists

The bar always renders so it is always a drag area, but chips stay hidden only while the sole conversation is still a blank scratch chat.

Chips show when more than one run is open, any run is loading, or any run has a session id/title (`showChips` in [[src/renderer/src/screens/Layout/ActiveSessionsBar.tsx#ActiveSessionsBar]]). When chips show, a browser-style new-tab **"+"** button (`.active-session-new`, `no-drag`) trails them and calls `onNew` → `handleNewChat` in [[src/renderer/src/screens/Layout/Layout.tsx]] to open a fresh conversation.

Because the bar doubles as the drag strip, [[src/renderer/src/screens/Layout/Layout.tsx]] renders it as the first child of `.content`; the verify-warning banner (when shown) sits just below it, clear of the drag layer.

## Follow-us modal

A one-time modal prompting the user to follow Hermes on X. Dismissed permanently via localStorage after either button is clicked.

[[src/renderer/src/components/FollowUsModal.tsx]] stores the dismissal flag in `localStorage` under `hermes-follow-x-dismissed`. Both "Follow" (opens `https://x.com/HermesOneApp` via `openExternal`) and "Not Now" write the flag and close the modal. It renders in [[src/renderer/src/screens/Chat/Chat.tsx]] only when `connectionModeLoaded && readiness.ok`, so it appears after setup is complete. The modal reuses the `.models-modal-overlay` / `.models-modal` pattern for consistent styling.
