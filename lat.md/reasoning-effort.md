# Reasoning effort control

The composer's reasoning-effort control sets how hard the model thinks for the current chat: a `Brain` trigger opens a glass popover with a Faster⟷Smarter slider over six ordered levels (auto → minimal → low → medium → high → xhigh).

[[src/renderer/src/screens/Chat/ReasoningEffortPicker.tsx#ReasoningEffortPicker]] renders it. The label reads from each API value's `labelKey` (the `medium` API value shows "Standard", `xhigh` shows "Max"); the hint warns that manual levels may be ignored by models that lack effort support.

## Slider interaction

The panel is a single `role="slider"` track, not a list of options — the six stops are non-focusable visual dots, and the track owns all input.

Pointer drag: pressing anywhere on the track and moving maps the pointer x to the nearest stop and applies it live (the rail spans the first/last dot centres, 9px in from each track edge; `indexFromClientX` does the math). Keyboard: the focused track handles ←/→ plus ↑/↓, Home, and End. Every path funnels through `commit(index)`, which clamps to range, dedupes against the last-applied index (a ref kept in sync with the selected value), and calls `select` — so a drag fires **one** `onChange` per real level change, not one per pixel, and the click that follows a pointer release is a no-op. The `--effort-frac` custom property (selectedIndex / (n−1)) drives the accent rail-fill and knob position in CSS.

## Stays open until dismissed

Choosing a level no longer closes the popover, so the user can nudge the level several times in a row without it vanishing.

`select` only awaits `onChange` and clears or sets the save-error flag; it never toggles `isOpen`. Dismissal is explicit: a `mousedown` outside `pickerRef`, or Escape (which the slider's key handler ignores so it bubbles to the dropdown's `onKeyDown`). A failed save keeps the panel open with an inline error and restores the prior selection.
