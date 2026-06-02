interface BlockCommand {
  label: string;
  snippet: string;
}

const COMMANDS: BlockCommand[] = [
  { label: "Page", snippet: "# New page\n" },
  { label: "Todo", snippet: "- [ ] Task\n" },
  { label: "Toggle", snippet: "### Toggle\n\n" },
  { label: "Callout", snippet: "> Callout\n\n" },
  { label: "Quote", snippet: "> Quote\n\n" },
  { label: "Code", snippet: "```\n\n```\n" },
  { label: "Divider", snippet: "---\n" },
  { label: "Page link", snippet: "[[Page]]" },
  {
    label: "Database",
    snippet:
      "\n```yaml\nhermesType: database\nversion: 1\ntitle: Tasks\nproperties:\n  name: { type: title }\nviews:\n  - id: view-1\n    name: Table\n    type: table\nitems: []\nrowPages: {}\n```\n",
  },
  {
    label: "Button",
    snippet:
      "\n```yaml\nhermesType: button\nlabel: Summarize this page\nactions:\n  - type: agentPrompt\n    prompt: Summarize this page and extract action items.\n```\n",
  },
  {
    label: "Synced block",
    snippet:
      "<!-- hermes-synced-block:start -->\nSynced content\n<!-- hermes-synced-block:end -->\n",
  },
];

interface BlockCommandMenuProps {
  query?: string;
  onSelect: (snippet: string) => void;
}

export default function BlockCommandMenu({
  query = "",
  onSelect,
}: BlockCommandMenuProps): React.JSX.Element {
  const needle = query.trim().toLowerCase();
  const commands = COMMANDS.filter((command) =>
    command.label.toLowerCase().includes(needle),
  );

  return (
    <div className="workspace-slash-menu" role="menu">
      {commands.map((command) => (
        <button
          key={command.label}
          type="button"
          role="menuitem"
          onClick={() => onSelect(command.snippet)}
        >
          {command.label}
        </button>
      ))}
      {commands.length === 0 && (
        <div className="workspace-tree-empty">No commands</div>
      )}
    </div>
  );
}
