export const INTEGRATED_TERMINAL_SHORTCUT_LABEL = "Ctrl+`";
export const INTEGRATED_TERMINAL_ARIA_SHORTCUT = "Control+`";

type TerminalShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "metaKey" | "repeat" | "shiftKey"
>;

export function isIntegratedTerminalShortcut(
  event: TerminalShortcutEvent,
): boolean {
  return (
    event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.repeat &&
    event.code === "Backquote"
  );
}
