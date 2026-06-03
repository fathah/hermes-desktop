// PageLinkBlock.tsx — inline sub-page link. Ported from editor.jsx PageLinkBlock.
import { Icon } from "../components/Icon";
import type { Block, PageMeta } from "../types";

interface Props {
  block: Block;
  pageMeta?: Record<string, PageMeta>;
  onOpenPage?: (id: string) => void;
}

export function PageLinkBlock({ block, pageMeta, onOpenPage }: Props) {
  const m = (block.pageId && pageMeta && pageMeta[block.pageId]) || {
    icon: "📄",
    title: "Untitled",
  };
  return (
    <div
      className="b-page"
      onClick={() => block.pageId && onOpenPage && onOpenPage(block.pageId)}
    >
      <span className="b-page-ic">{m.icon}</span>
      <span className="b-page-title">{m.title}</span>
      <Icon
        name="chevR"
        size={14}
        style={{ color: "var(--tx-4)", marginLeft: "auto" }}
      />
    </div>
  );
}
