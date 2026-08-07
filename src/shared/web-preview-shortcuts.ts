export const WEB_PREVIEW_SHORTCUT_ACTIONS = [
  "back",
  "forward",
  "reload",
  "focus-address",
  "edit",
  "annotate",
  "fullscreen",
  "open-external",
  "close",
  "commit",
] as const;

export type WebPreviewShortcutAction =
  (typeof WEB_PREVIEW_SHORTCUT_ACTIONS)[number];

interface WebPreviewShortcutInput {
  key: string;
  meta: boolean;
  control: boolean;
  shift: boolean;
  alt: boolean;
  type?: string;
}

const SHORTCUT_KEYS: Record<
  WebPreviewShortcutAction,
  { key: string; shift: boolean; display: string }
> = {
  back: { key: "[", shift: false, display: "[" },
  forward: { key: "]", shift: false, display: "]" },
  reload: { key: "r", shift: false, display: "R" },
  "focus-address": { key: "l", shift: false, display: "L" },
  edit: { key: "e", shift: true, display: "E" },
  annotate: { key: "c", shift: true, display: "C" },
  fullscreen: { key: "f", shift: true, display: "F" },
  "open-external": { key: "o", shift: true, display: "O" },
  close: { key: "w", shift: true, display: "W" },
  commit: { key: "enter", shift: false, display: "Enter" },
};

export function isWebPreviewShortcutAction(
  value: unknown,
): value is WebPreviewShortcutAction {
  return WEB_PREVIEW_SHORTCUT_ACTIONS.includes(
    value as WebPreviewShortcutAction,
  );
}

export function matchWebPreviewShortcut(
  input: WebPreviewShortcutInput,
  isMac: boolean,
): WebPreviewShortcutAction | null {
  if (
    (input.type && input.type !== "keyDown") ||
    input.alt ||
    (isMac ? !input.meta || input.control : !input.control || input.meta)
  ) {
    return null;
  }

  const key = input.key.toLowerCase();
  return (
    WEB_PREVIEW_SHORTCUT_ACTIONS.find((action) => {
      const shortcut = SHORTCUT_KEYS[action];
      return shortcut.key === key && shortcut.shift === input.shift;
    }) ?? null
  );
}

export function webPreviewShortcutLabel(
  action: WebPreviewShortcutAction,
  isMac: boolean,
): string {
  const shortcut = SHORTCUT_KEYS[action];
  const modifiers = isMac
    ? `⌘${shortcut.shift ? "⇧" : ""}`
    : `Ctrl+${shortcut.shift ? "Shift+" : ""}`;
  return `${modifiers}${shortcut.display}`;
}

export function webPreviewAriaKeyShortcut(
  action: WebPreviewShortcutAction,
  isMac: boolean,
): string {
  const shortcut = SHORTCUT_KEYS[action];
  return [
    isMac ? "Meta" : "Control",
    ...(shortcut.shift ? ["Shift"] : []),
    shortcut.display,
  ].join("+");
}
