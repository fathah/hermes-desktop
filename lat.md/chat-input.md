# Chat Input

The chat composer keeps message entry and its supporting controls inside one accessible, visually unified surface.

## Animated composer border

The composer uses a theme-aware decorative beam without changing its keyboard, attachment, voice, or submission behavior.

[[src/renderer/src/screens/Chat/ChatInput.tsx#ChatInput]] places `border-beam` beside `.chat-input-wrapper` in a shared shell, using the contained `pulse-inner` size, monochrome palette, and `0.7` strength. Theme colors follow the resolved Hermes theme appearance rather than the operating-system preference.

The beam is an absolutely positioned, non-interactive decoration whose generated CSS disables animation for `prefers-reduced-motion`. Its internal clipping cannot clip toolbar popovers because the interactive composer is a sibling; the shared shell carries focus styling and keeps overflow visible.

### Uses the requested beam preset

The ChatInput integration test verifies the requested preset, strength, and theme while ensuring the beam is decorative and not an overflow-clipping ancestor of the textarea or toolbar.

[[src/renderer/src/screens/Chat/ChatInput.test.tsx]] protects the component boundary and configuration without coupling tests to the dependency's generated animation CSS.

## Attachment capacity

The composer counts only attachments successfully prepared for a message toward its per-message limit.

[[src/renderer/src/screens/Chat/attachmentUtils.ts#processFiles]] validates each candidate before it occupies a slot, allowing later valid files to use capacity left by rejected files.

### Rejected files do not consume slots

A rejected file followed by a valid file can still fill the final available attachment slot.

[[src/renderer/src/screens/Chat/attachmentUtils.test.ts]] covers an oversized text file followed by a valid text file when one slot remains.

## Submission acknowledgement

The composer clears only an accepted submission snapshot. Refused Send, Quick Ask and slash selections keep their draft and staged files and show the rejection for retry.

[[src/renderer/src/screens/Chat/ChatInput.tsx#ChatInput]] awaits the parent admission callback, suppresses duplicate pending payloads, and preserves later edits or added files when an earlier submission succeeds. Composer resets and run/profile scope changes fence obsolete acknowledgements. Validated Legacy dispatch acknowledges admission without waiting for its streamed reply; native transport retains its existing handled-result contract.

### Refusal preserves text and attachments

Actual composer Send and Quick Ask keep the exact draft and prepared attachment after a rejected callback, display its error, and allow retry without dispatching the same pending payload twice.

### Accepted snapshots preserve newer drafts

An accepted earlier submission removes only its staged files and leaves a newer draft or file intact. An imperative composer reset also excludes delayed acknowledgements.
