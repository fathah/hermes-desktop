interface MentionPage {
  path: string;
  title: string;
}

interface PageMentionMenuProps {
  query: string;
  pages: MentionPage[];
  onSelect: (snippet: string) => void;
}

export default function PageMentionMenu({
  query,
  pages,
  onSelect,
}: PageMentionMenuProps): React.JSX.Element {
  const needle = query.trim().toLowerCase();
  const filteredPages = pages.filter((page) =>
    page.title.toLowerCase().includes(needle),
  );
  const utilityItems = [
    { label: "Today", snippet: "@today" },
    { label: "Reminder", snippet: "@remind " },
  ].filter((item) => item.label.toLowerCase().includes(needle));

  return (
    <div className="workspace-mention-menu" role="menu">
      {filteredPages.map((page) => (
        <button
          key={page.path}
          type="button"
          role="menuitem"
          onClick={() => onSelect(`[[${page.title}]]`)}
        >
          {page.title}
        </button>
      ))}
      {utilityItems.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => onSelect(item.snippet)}
        >
          {item.label}
        </button>
      ))}
      {filteredPages.length === 0 && utilityItems.length === 0 && (
        <div className="workspace-tree-empty">No mentions</div>
      )}
    </div>
  );
}
