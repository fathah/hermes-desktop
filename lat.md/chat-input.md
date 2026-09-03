# Chat Input

The chat composer keeps message entry and its supporting controls inside one accessible, visually unified surface.

## Animated composer border

The composer uses a theme-aware decorative beam without changing its keyboard, attachment, voice, or submission behavior.

[[src/renderer/src/screens/Chat/ChatInput.tsx#ChatInput]] wraps the complete `.chat-input-wrapper` with `border-beam` using the contained `pulse-inner` size, monochrome palette, and `0.7` strength. Theme colors follow the resolved Hermes theme appearance rather than the operating-system preference.

The beam is non-interactive and its generated CSS disables animation for `prefers-reduced-motion`. Because the contained pulse wrapper clips child overflow, the existing focus glow is drawn by `.chat-input-beam:focus-within` while the inner composer retains its focus border.

### Uses the requested beam preset

The ChatInput integration test verifies that the beam surrounds both the textarea and toolbar with the requested preset, strength, and theme.

[[src/renderer/src/screens/Chat/ChatInput.test.tsx]] protects the component boundary and configuration without coupling tests to the dependency's generated animation CSS.
