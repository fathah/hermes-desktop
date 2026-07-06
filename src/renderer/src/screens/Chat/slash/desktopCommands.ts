import type { ModelCommandFormatter, SlashCommandDefinition } from "./types";

const formatExplainSelection: ModelCommandFormatter = async (input) => ({
  content: [
    "Explain the following content clearly.",
    input.args && `Additional instructions:\n${input.args}`,
    input.selectedText && `Content:\n${input.selectedText}`,
  ]
    .filter(Boolean)
    .join("\n\n"),
  attachments: input.attachments,
});

// @lat: [[chat-commands#Slash command execution#Central command router#Desktop commands]]
export const DESKTOP_SLASH_COMMANDS: SlashCommandDefinition[] = [
  {
    name: "settings",
    description: "Open Desktop settings",
    category: "Desktop",
    source: "desktop",
    target: "desktop",
    allowWhileBusy: true,
    uiAction: true,
    execute: async ({ args }, context) => {
      context.openSettings(args || undefined);
      return { type: "handled" };
    },
  },
  {
    name: "explain-selection",
    description: "Explain the selected content",
    category: "Desktop",
    source: "desktop",
    target: "model",
    allowWhileBusy: false,
    supportsAttachments: true,
    format: formatExplainSelection,
  },
  {
    name: "help",
    aliases: ["commands"],
    description: "Show available commands",
    category: "Desktop",
    source: "desktop",
    target: "desktop",
    allowWhileBusy: true,
    execute: async (_input, context) => ({
      type: "handled",
      output: context.renderSlashHelp(),
    }),
  },
  {
    name: "model",
    description: "Open model picker",
    category: "Desktop",
    source: "desktop",
    target: "desktop",
    allowWhileBusy: true,
    uiAction: true,
    execute: async () => {
      window.dispatchEvent(new CustomEvent("model-picker:open"));
      return { type: "handled" };
    },
  },
  ...(
    [
      ["agents", "Open Agents page"],
      ["office", "Open Office 3D page"],
      ["discover", "Open Discover page"],
      ["providers", "Open Providers page"],
      ["schedules", "Open Schedules page"],
      ["kanban", "Open Kanban board"],
      ["gateway", "Open Gateway status page"],
    ] as const
  ).map(
    ([name, description]): SlashCommandDefinition => ({
      name,
      description,
      category: "Navigation",
      source: "desktop",
      target: "desktop",
      allowWhileBusy: true,
      uiAction: true,
      execute: async () => {
        window.dispatchEvent(
          new CustomEvent("navigation:goto", { detail: name }),
        );
        return { type: "handled" };
      },
    }),
  ),
];

// `uiAction: true` marks commands whose effect is a UI change with no
// transcript output (start a new chat, clear it, toggle fast mode) — the
// router suppresses their echoed `/command` user bubble.
const LOCAL_COMMANDS: ReadonlyArray<
  readonly [name: string, description: string, uiAction?: boolean]
> = [
  ["new", "Start a new chat", true],
  ["clear", "Clear conversation history", true],
  ["persona", "Show the current persona"],
  ["memory", "Show agent memory"],
  ["tools", "Show available toolsets"],
  ["skills", "Show installed skills"],
  ["version", "Show Hermes version"],
  ["fast", "Toggle fast mode", true],
  ["usage", "Show token usage"],
];

export const LOCAL_DESKTOP_SLASH_COMMANDS: SlashCommandDefinition[] =
  LOCAL_COMMANDS.map(([name, description, uiAction]) => ({
    name,
    description,
    category: "Desktop",
    source: "desktop",
    target: "desktop",
    allowWhileBusy: true,
    ...(uiAction ? { uiAction: true } : {}),
    execute: async (input, context) => {
      const handled = await context.executeDesktopSlash(input.rawInput);
      return handled
        ? { type: "handled" as const }
        : {
            type: "error" as const,
            message: `Desktop command /${input.name} is unavailable`,
          };
    },
  }));
