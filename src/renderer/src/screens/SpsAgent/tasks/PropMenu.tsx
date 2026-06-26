// PropMenu.tsx — inline property editor (status / priority / owner). Ported from tasks.jsx.
import { PRIO, STATUS } from "../data/seed";
import { usePersonPages } from "../hooks/usePersonPages";
import { Avatar } from "./chips";

export interface PropState {
  rowId: string;
  field: "status" | "prio" | "who";
  x: number;
  y: number;
}

interface Props {
  prop: PropState;
  onPick: (val: string) => void;
  onClose: () => void;
}

export function PropMenu({ prop, onPick, onClose }: Props) {
  const { persons } = usePersonPages();
  const opts: [string, string][] =
    prop.field === "status"
      ? Object.entries(STATUS).map(([k, v]) => [k, v.label])
      : prop.field === "prio"
        ? Object.entries(PRIO).map(([k, v]) => [k, v.label])
        : persons.map((p) => [p.id, p.name]);
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 64 }}
        onMouseDown={onClose}
      />
      <div
        className="menu"
        style={{
          left: Math.min(prop.x, window.innerWidth - 200),
          top: prop.y,
          zIndex: 65,
          minWidth: 170,
        }}
      >
        <div className="menu-label">Set {prop.field}</div>
        {opts.map(([k, label]) => (
          <div key={k} className="menu-mini" onClick={() => onPick(k)}>
            {prop.field === "status" && (
              <span
                className="pdot"
                style={{
                  background: STATUS[k as keyof typeof STATUS].dot,
                  width: 8,
                  height: 8,
                  borderRadius: 9,
                }}
              ></span>
            )}
            {prop.field === "who" && <Avatar who={k} name={label} size={16} />}
            {label}
          </div>
        ))}
      </div>
    </>
  );
}
