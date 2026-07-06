export interface SlashCommand {
  name: string;
  description: string;
  category: "chat" | "agent" | "tools" | "info";
  /** If true, the command is handled locally instead of sent to the backend */
  local?: boolean;
  takesArgs?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // Chat control
  {
    name: "/new",
    description: "Start a new chat",
    category: "chat",
    local: true,
  },
  {
    name: "/clear",
    description: "Clear conversation history",
    category: "chat",
    local: true,
  },
  // Agent commands (sent to backend)
  {
    name: "/btw",
    description: "Ask a side question without affecting context",
    category: "agent",
  },
  {
    name: "/approve",
    description: "Approve a pending action",
    category: "agent",
  },
  { name: "/deny", description: "Deny a pending action", category: "agent" },
  {
    name: "/status",
    description: "Show current agent status",
    category: "agent",
  },
  {
    name: "/reset",
    description: "Reset conversation context",
    category: "agent",
  },
  {
    name: "/compact",
    description: "Compact and summarize the conversation",
    category: "agent",
  },
  { name: "/undo", description: "Undo the last action", category: "agent" },
  {
    name: "/retry",
    description: "Retry the last failed action",
    category: "agent",
  },
  {
    name: "/fast",
    description: "Toggle priority processing (lower latency)",
    category: "agent",
    local: true,
  },
  {
    name: "/compress",
    description: "Compress conversation with optional focus topic",
    category: "agent",
  },
  {
    name: "/usage",
    description: "Show token usage, cost, and rate limits",
    category: "agent",
    local: true,
  },
  {
    name: "/debug",
    description: "Show diagnostics and debug info",
    category: "agent",
  },
  {
    name: "/goal",
    description:
      "Lock the agent onto a persistent cross-turn goal (Ralph loop)",
    category: "agent",
  },
  {
    name: "/learn",
    description: "Learn a reusable skill from files, URLs, notes, or this chat",
    category: "agent",
    takesArgs: true,
  },
  {
    name: "/steer",
    description: "Steer the in-flight agent without interrupting it",
    category: "agent",
  },
  {
    name: "/queue",
    description: "Queue a follow-up to run after the current turn",
    category: "agent",
  },
  {
    name: "/update",
    description: "Update Hermes to the latest version",
    category: "agent",
  },
  // Tools & capabilities
  { name: "/web", description: "Search the web", category: "tools" },
  { name: "/image", description: "Generate an image", category: "tools" },
  { name: "/browse", description: "Browse a URL", category: "tools" },
  { name: "/code", description: "Write or execute code", category: "tools" },
  { name: "/file", description: "Read or write files", category: "tools" },
  { name: "/shell", description: "Run a shell command", category: "tools" },
  // Info
  {
    name: "/help",
    description: "Show available commands and help",
    category: "info",
  },
  { name: "/tools", description: "List available tools", category: "info" },
  { name: "/skills", description: "List installed skills", category: "info" },
  {
    name: "/reload-skills",
    description: "Reload the skills directory without restarting",
    category: "info",
  },
  {
    name: "/kanban",
    description: "List or operate on kanban tasks",
    category: "info",
  },
  {
    name: "/curator",
    description: "Show curator status (usage-ranked skills)",
    category: "info",
  },
  {
    name: "/model",
    description: "Open model picker",
    category: "info",
  },
  {
    name: "/agents",
    description: "Open Agents page",
    category: "info",
  },
  {
    name: "/office",
    description: "Open Office 3D page",
    category: "info",
  },
  {
    name: "/discover",
    description: "Open Discover page",
    category: "info",
  },
  {
    name: "/providers",
    description: "Open Providers page",
    category: "info",
  },
  {
    name: "/schedules",
    description: "Open Schedules page",
    category: "info",
  },
  {
    name: "/gateway",
    description: "Open Gateway status page",
    category: "info",
  },
  { name: "/memory", description: "Show agent memory", category: "info" },
  { name: "/persona", description: "Show current persona", category: "info" },
  { name: "/version", description: "Show Hermes version", category: "info" },
];
