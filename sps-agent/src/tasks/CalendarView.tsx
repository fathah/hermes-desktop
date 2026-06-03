// CalendarView.tsx — month grid (June 2026) with due-date events. Ported from tasks.jsx.
import { STATUS } from "../data/seed";
import type { Task } from "../types";
import { parseDueParts } from "./taskUtils";

interface Props {
  tasks: Task[];
  onOpenTask: (t: Task) => void;
}

export function CalendarView({ tasks, onOpenTask }: Props) {
  const year = 2026;
  const month = 5; // June
  const first = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const evByDay: Record<number, Task[]> = {};
  tasks.forEach((t) => {
    const p = parseDueParts(t.due);
    if (p && p.mon === 5) (evByDay[p.day] = evByDay[p.day] || []).push(t);
  });
  return (
    <div className="cal">
      <div className="cal-head">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((d, i) => (
          <div
            key={i}
            className={`cal-day ${d == null ? "out" : ""} ${d === 3 ? "today" : ""}`}
          >
            {d != null && <div className="cal-dn">{d}</div>}
            {(d != null ? evByDay[d] || [] : []).map((t) => (
              <div
                key={t.id}
                className="cal-ev"
                style={{
                  background: STATUS[t.status].dot + "22",
                  borderLeftColor: STATUS[t.status].dot,
                }}
                onClick={() => onOpenTask(t)}
              >
                {t.title}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
