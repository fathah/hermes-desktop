import { memo } from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  FileCode,
  Link,
  List,
  ListOrdered,
  Quote,
  Heading1,
  Heading2,
  Minus,
} from "lucide-react";

interface MarkdownToolbarProps {
  onInsert: (before: string, after: string, placeholder: string) => void;
}

const MarkdownToolbar = memo(function MarkdownToolbar({
  onInsert,
}: MarkdownToolbarProps): React.JSX.Element {
  const tools = [
    {
      icon: <Bold size={14} />,
      title: "Bold (Ctrl+B)",
      before: "**",
      after: "**",
      placeholder: "bold text",
    },
    {
      icon: <Italic size={14} />,
      title: "Italic (Ctrl+I)",
      before: "_",
      after: "_",
      placeholder: "italic text",
    },
    {
      icon: <Strikethrough size={14} />,
      title: "Strikethrough",
      before: "~~",
      after: "~~",
      placeholder: "strikethrough text",
    },
    {
      icon: <Code size={14} />,
      title: "Inline Code (Ctrl+E)",
      before: "`",
      after: "`",
      placeholder: "code",
    },
    {
      icon: <FileCode size={14} />,
      title: "Code Block",
      before: "```\n",
      after: "\n```",
      placeholder: "code here",
      block: true,
    },
    {
      icon: <Link size={14} />,
      title: "Link (Ctrl+K)",
      before: "[",
      after: "](url)",
      placeholder: "link text",
    },
    {
      icon: <List size={14} />,
      title: "Bullet List",
      before: "- ",
      after: "",
      placeholder: "list item",
      line: true,
    },
    {
      icon: <ListOrdered size={14} />,
      title: "Numbered List",
      before: "1. ",
      after: "",
      placeholder: "list item",
      line: true,
    },
    {
      icon: <Quote size={14} />,
      title: "Quote",
      before: "> ",
      after: "",
      placeholder: "quote text",
      line: true,
    },
    {
      icon: <Heading1 size={14} />,
      title: "Heading 1",
      before: "# ",
      after: "",
      placeholder: "heading",
      line: true,
    },
    {
      icon: <Heading2 size={14} />,
      title: "Heading 2",
      before: "## ",
      after: "",
      placeholder: "heading",
      line: true,
    },
    {
      icon: <Minus size={14} />,
      title: "Horizontal Rule",
      before: "\n---\n",
      after: "",
      placeholder: "",
      line: true,
    },
  ];

  return (
    <div className="markdown-toolbar">
      {tools.map((tool, i) => (
        <button
          key={i}
          type="button"
          className="markdown-toolbar-btn"
          title={tool.title}
          onClick={() => onInsert(tool.before, tool.after, tool.placeholder)}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
});

export { MarkdownToolbar };
export default MarkdownToolbar;
