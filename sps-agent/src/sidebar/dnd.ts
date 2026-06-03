// dnd.ts — shared drag/nest state shape for the sidebar tree.
import type { DropWhere } from "../lib/tree";

export interface TreeDnd {
  drag: string | null;
  setDrag: (id: string | null) => void;
  over: { id: string; where: DropWhere } | null;
  setOver: (o: { id: string; where: DropWhere } | null) => void;
  onMove: (dragId: string, targetId: string, where: DropWhere) => void;
}
