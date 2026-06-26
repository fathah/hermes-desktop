import { Icon } from "../components/Icon";
import type { Block, PageMeta } from "../types";

interface Props {
  block: Block;
  pageMeta?: Record<string, PageMeta>;
  onOpenPage?: (id: string) => void;
}

function refLabel(block: Block): string | null {
  if (block.linkBlockId) return `#^${block.linkBlockId}`;
  if (block.linkHeading) return `#${block.linkHeading}`;
  return null;
}

export function EmbedBlock({ block, pageMeta, onOpenPage }: Props) {
  const m = (block.pageId && pageMeta && pageMeta[block.pageId]) || {
    icon: "📄",
    title: block.pageId || "Untitled",
  };
  const label = block.linkDisplay || m.title;
  const ref = refLabel(block);
  return (
    <button
      type="button"
      className="b-page b-embed"
      onClick={() => block.pageId && onOpenPage && onOpenPage(block.pageId)}
    >
      <span className="b-page-ic">{m.icon}</span>
      <span className="b-page-title">{label}</span>
      {ref && <span className="b-page-ref">{ref}</span>}
      <span className="b-embed-kind">embed</span>
      <Icon
        name="chevR"
        size={14}
        style={{ color: "var(--tx-4)", marginLeft: "auto" }}
      />
    </button>
  );
}
