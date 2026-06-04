// SidebarSection.tsx — a named, collapsible rail section (Notion 3.1 grammar).
// Reuses the existing .sec / .sec-label / .sec-add chrome; adds a .sec-chev
// collapse caret (same rotate transform as .tree-toggle). Renders nothing when
// the section is disabled in the "customize sidebar" tweaks.
import type { ReactNode } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import type { SectionId } from "../store/storeTypes";

interface SidebarSectionProps {
  id: SectionId;
  label: string;
  /** Optional "+" affordance on the section header (e.g. New page / New agent). */
  onAdd?: () => void;
  addTitle?: string;
  children?: ReactNode;
}

export function SidebarSection({
  id,
  label,
  onAdd,
  addTitle,
  children,
}: SidebarSectionProps) {
  const enabled = useStore((s) => s.sectionsEnabled[id]);
  const open = useStore((s) => s.sectionsOpen[id]);
  const toggleSection = useStore((s) => s.toggleSection);
  if (!enabled) return null;

  const onAddClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onAdd?.();
  };

  return (
    <div className="sec-group">
      <div className="sec" onClick={() => toggleSection(id)}>
        <span className="sec-head">
          <span className={`sec-chev ${open ? "open" : ""}`}>
            <Icon name="chevR" size={12} />
          </span>
          <span className="sec-label">{label}</span>
        </span>
        {onAdd && (
          <span className="sec-add" title={addTitle} onClick={onAddClick}>
            <Icon name="plus" size={15} />
          </span>
        )}
      </div>
      {open && children}
    </div>
  );
}
