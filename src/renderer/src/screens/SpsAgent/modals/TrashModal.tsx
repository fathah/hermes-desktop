// TrashModal.tsx — trashed pages with restore. Ported from app.jsx TrashModal.
import { useStore } from "../store";
import { SpsModal } from "./SpsModal";

export function TrashModal() {
  const trash = useStore((s) => s.trash);
  const restorePage = useStore((s) => s.restorePage);
  const setTrashOpen = useStore((s) => s.setTrashOpen);
  const onClose = () => setTrashOpen(false);

  return (
    <SpsModal title="Trash" onClose={onClose}>
      <div className="modal-body">
        {trash.length === 0 ? (
          <div className="cmts-empty" style={{ padding: "20px 0" }}>
            Trash is empty.
          </div>
        ) : (
          <div>
            {trash.map((p) => (
              <div key={p.id} className="lst-row" style={{ borderRadius: 6 }}>
                <span className="tree-emoji">{p.icon}</span>
                <span className="c-name" style={{ flex: 1 }}>
                  {p.title}
                </span>
                <button className="cover-btn" onClick={() => restorePage(p)}>
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </SpsModal>
  );
}
