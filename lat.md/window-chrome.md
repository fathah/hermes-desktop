# Window title bar and conversation tabs

The top strip of the main window is a browser-style title bar: it is the window's drag region, and the open-conversation tabs live *on* it rather than in a separate bar below, so no vertical space is spent on a dedicated, always-empty drag strip.

On macOS the window is frameless (`titleBarStyle: "hiddenInset"`, traffic lights inset at x/y 16 — see [[src/main/app/start.ts#startMainProcess]]), and [[src/renderer/src/App.tsx]] renders a fixed full-width `.drag-region` (`-webkit-app-region: drag`, z-index 1000) so the whole top band — including over the sidebar/traffic-light area — drags the window. This strip is mac-only; other platforms keep the OS title bar.

`.app` fills the window (`height: 100vh`) so the chrome reaches every edge. The sidebar rounds only its **top-left** corner (`border-radius: 16px 0 0 0`); the full-width status strip owns the window's bottom edge and rounds both bottom corners (`0 0 16px 16px`), so the sidebar's bottom-left is square against it. A hairline seam (`.content` `border-inline-start`) separates the content pane from the sidebar.

## Translucent sidebar (macOS vibrancy)

The sidebar is frosted glass on macOS — the window material shows through it — while the content pane stays opaque and readable.

[[src/main/app/start.ts#createWindow]] gives the window `vibrancy: "under-window"` + `visualEffectState: "active"` + a transparent `backgroundColor` on macOS. The material's light/dark **tone follows the app theme**, not the system appearance: [[src/renderer/src/components/ThemeProvider.tsx#ThemeProvider]] pushes the resolved theme's `appearance` to the main process via the `set-native-appearance` IPC ([[src/main/ipc/register.ts#registerIpcHandlers]] → `nativeTheme.themeSource`), passing `"system"` through only for the "System" theme so its `prefers-color-scheme` still tracks the OS. This is the fix for the earlier milky-sidebar bug: `under-window` alone follows the *system* appearance, so a dark theme on a light-mode Mac frosted light; syncing `themeSource` keeps a dark theme's frost dark. `createWindow` seeds `themeSource = "dark"` (the default theme) so the first paint isn't milky before the renderer refines it.

For the material to paint, the renderer leaves surfaces transparent: [[src/renderer/src/App.tsx]] adds `shell-vibrant` to `.app` only on macOS and only on the `main` screen (onboarding stays solid). Under it, `body`/`#root`/`.app` go transparent, the `.sidebar` and `.status-bar` become a translucent `--bg-secondary` tint, and `.content` keeps an opaque `--bg-primary`. Because a transparent window is no longer masked to its rounded shape by macOS, `.content` also rounds its own top-right corner (`0 16px 0 0`) — the sidebar owns top-left, the status bar owns the bottom two — so the opaque panes don't show square corners.

## Modal & popover glass is near-opaque (compositing-independent)

Modals and pickers use a `--bg-secondary` tint plus `backdrop-filter: blur(30px) saturate(1.5)`, but the tint is **97% opaque** so legibility never depends on the blur actually painting.

The blur is treated as pure enhancement, not a load-bearing layer. On the transparent vibrancy window above, `backdrop-filter` is unreliable in packaged macOS builds — it silently drops to a no-op even with hardware acceleration on — which left the earlier 85%-opaque panels showing sharp app content bleeding through (the "transparent modal" bug). Raising the tint to 97% in `main.css` makes every shared frosted surface — the settings/profile/models/schedules/gateway/profile-switch modals and the model/reasoning/fast-mode dropdowns — render near-identically for all users regardless of GPU or build type; where the blur *does* paint it adds a faint frost, but its absence is barely perceptible. Keep new glass surfaces at this opacity, not the old 85%, for the same reason.

## Bottom status strip

A native system strip pinned full-width beneath the sidebar+content row surfaces live state that was otherwise hidden: gateway/connection, active model, and skill count, plus real keyboard hints.

[[src/renderer/src/screens/Layout/StatusBar.tsx#StatusBar]] self-fetches from `listProfiles` (active profile's `model`, `skillCount`, `gatewayRunning`) and `getConnectionConfig` (`mode`), polling every 4s. Every field is real — an unknown value drops its chip rather than showing a placeholder, and the hints advertise only shortcuts that exist (`/` commands, `⌘,`/`Ctrl,` settings), never a fabricated `⌘K`. [[src/renderer/src/screens/Layout/Layout.tsx]] wraps its `.layout` row in a `.layout-shell` column and renders the strip as the row's sibling; the online/offline dot uses the theme-aware `--success` token.

## Tabs layered above the drag region

[[src/renderer/src/screens/Layout/ActiveSessionsBar.tsx#ActiveSessionsBar]] is the content column's title bar. It owns the top band browser-style: empty space drags, the chips stay clickable.

- The bar itself is `-webkit-app-region: drag` with `position: relative; z-index: 1001`, so it stacks above the global `.drag-region` (z 1000) and is the drag handle for the content column.
- Each `.active-session-chip` opts back out with `-webkit-app-region: no-drag`, keeping select/close clickable above the drag layer — the same priority model browsers use for tabs over a draggable tab strip.
- `min-height: 34px` (= the 34px global drag strip) means content rendered after the bar clears the fixed drag layer, so the old `.is-mac .content { padding-top: 28px }` offset is no longer needed.

Visually the strip is a Safari-style tab bar: the strip uses the darker `--bg-secondary` toolbar shade; tabs are flat (no border/fill) and separated by thin vertical dividers drawn with an `::before` on each non-first chip. The active tab fills with `--bg-primary` — the same colour as the transparent content area below it — and rounds its top corners, so it docks into the page; the dividers flanking the active tab are hidden for a seamless join.

## Blank until a real session exists

The bar always renders so it is always a drag area, but chips stay hidden only while the sole conversation is still a blank scratch chat.

Chips show when more than one run is open, any run is loading, or any run has a session id/title (`showChips` in [[src/renderer/src/screens/Layout/ActiveSessionsBar.tsx#ActiveSessionsBar]]). When chips show, a browser-style new-tab **"+"** button (`.active-session-new`, `no-drag`) trails them and calls `onNew` → `handleNewChat` in [[src/renderer/src/screens/Layout/Layout.tsx]] to open a fresh conversation.

Because the bar doubles as the drag strip, [[src/renderer/src/screens/Layout/Layout.tsx]] renders it as the first child of `.content`; the verify-warning banner (when shown) sits just below it, clear of the drag layer.

## Follow-us modal

A one-time modal prompting the user to follow Hermes on X. Dismissed permanently via localStorage after either button is clicked.

[[src/renderer/src/components/FollowUsModal.tsx]] stores the dismissal flag in `localStorage` under `hermes-follow-x-dismissed`. Both "Follow" (opens `https://x.com/HermesOneApp` via `openExternal`) and "Not Now" write the flag and close the modal. It renders in [[src/renderer/src/screens/Chat/Chat.tsx]] only when `connectionModeLoaded && readiness.ok`, so it appears after setup is complete. The modal reuses the `.models-modal-overlay` / `.models-modal` pattern for consistent styling.
