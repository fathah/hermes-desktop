# Chat Input

The chat composer keeps message entry and its supporting controls inside one accessible, visually unified surface.

## Animated composer border

The composer uses a theme-aware decorative beam without changing its keyboard, attachment, voice, or submission behavior.

[[src/renderer/src/screens/Chat/ChatInput.tsx#ChatInput]] places `border-beam` beside `.chat-input-wrapper` in a shared shell, using the contained `pulse-inner` size, monochrome palette, and `0.7` strength. Theme colors follow the resolved Hermes theme appearance rather than the operating-system preference.

The beam is an absolutely positioned, non-interactive decoration whose generated CSS disables animation for `prefers-reduced-motion`. Its internal clipping cannot clip toolbar popovers because the interactive composer is a sibling; the shared shell carries focus styling and keeps overflow visible.

### Uses the requested beam preset

The ChatInput integration test verifies the requested preset, strength, and theme while ensuring the beam is decorative and not an overflow-clipping ancestor of the textarea or toolbar.

[[src/renderer/src/screens/Chat/ChatInput.test.tsx]] protects the component boundary and configuration without coupling tests to the dependency's generated animation CSS.
