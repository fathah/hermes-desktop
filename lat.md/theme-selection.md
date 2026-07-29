# Theme selection

Appearance settings preserve explicit palette ids and expose a System choice that resolves to the default Light or Dark palette without inventing a separate CSS palette.

[[src/renderer/src/components/ThemeProvider.tsx#ThemeProvider]] accepts `system` plus every id in `THEMES`. Existing valid `hermes-theme` values remain unchanged; invalid values fall back to Dark, matching the pre-existing default.

## Follow system behavior

System mode listens to `prefers-color-scheme` and updates the resolved `data-theme` at runtime, while [[src/renderer/src/components/settings/AppearancePane.tsx#AppearancePane]] keeps System visibly selected and shows the currently resolved Light or Dark label.

Preset cards remain explicit choices. Selecting one stops renderer updates from OS appearance changes and maps the preset's declared `appearance` to native window chrome.

## Native window synchronization

Renderer and Electron chrome share one appearance decision so macOS vibrancy and the hidden title bar never use the opposite tone from the active palette.

[[src/renderer/src/components/ThemeProvider.tsx#ThemeProvider]] sends `system` for System mode and `light` or `dark` for explicit palettes through the existing `set-native-appearance` IPC. Electron applies it to `nativeTheme.themeSource`.

## Modal chrome stacking

The Settings modal stacks above the macOS drag strip and conversation title bar, ensuring its overlay dims and disables the whole top band without changing other modals' nested layering.

The Settings surface and grouped preference rows use opaque theme surfaces. This prevents high-contrast content beneath the modal from ghosting through in Light mode while retaining the surrounding overlay separation.

## Tests

Focused renderer tests protect stored theme compatibility, runtime system changes, native appearance mapping, and the Settings entry point.

### Stored system theme follows runtime changes

A saved `system` value resolves from the current media query, reacts to later OS changes, keeps the stored selection, and leaves Electron's native appearance source on System.

### Stored presets keep their appearance

A saved custom palette remains selected and applies both its CSS theme id and declared native light/dark appearance without rewriting storage.

### Appearance exposes the system choice

Appearance marks System as an accessible pressed choice, reports the resolved Light or Dark mode, and sends `system` when selected.
