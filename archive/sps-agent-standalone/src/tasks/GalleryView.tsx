// GalleryView.tsx — card gallery. Ported from tasks.jsx.
import { STATUS } from "../data/seed";
import type { Task } from "../types";
import { Avatar, StatusChip } from "./chips";

interface Props {
  tasks: Task[];
  onOpenTask: (t: Task) => void;
}

export function GalleryView({ tasks, onOpenTask }: Props) {
  return (
    <div className="gallery">
      {tasks.map((t) => (
        <div className="gal-card" key={t.id} onClick={() => onOpenTask(t)}>
          <div
            className="gal-cover"
            style={{ background: STATUS[t.status].dot }}
          >
            {t.title
              .split(" ")
              .slice(0, 2)
              .map((w) => w[0])
              .join("")
              .toUpperCase()}
          </div>
          <div className="gal-body">
            <div className="gal-title">{t.title}</div>
            <div className="gal-foot">
              <StatusChip s={t.status} />
              <span style={{ flex: 1 }}></span>
              <Avatar who={t.who} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
