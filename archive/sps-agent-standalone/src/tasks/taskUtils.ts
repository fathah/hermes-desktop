// taskUtils.ts — view/sort tables + due-date parsing. Ported from tasks.jsx.
import type { IconName } from "../components/iconPaths";
import type { DbView, PrioKey } from "../types";

export const VIEWS: [DbView, string, IconName][] = [
  ["board", "Board", "board"],
  ["table", "Table", "table"],
  ["list", "List", "list"],
  ["gallery", "Gallery", "callout"],
  ["calendar", "Calendar", "calendar"],
];

export const SORTS: [string, string][] = [
  ["manual", "Manual"],
  ["due", "Due date"],
  ["prio", "Priority"],
  ["title", "Name"],
];

export const PRIO_RANK: Record<PrioKey, number> = { high: 0, med: 1, low: 2 };

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

export function parseDueParts(
  due: string,
): { mon: number; day: number } | null {
  const [mon, day] = (due || "").split(" ");
  return mon in MONTHS ? { mon: MONTHS[mon], day: parseInt(day, 10) } : null;
}

export function parseDue(due: string): number {
  const p = parseDueParts(due);
  return p ? p.mon * 100 + p.day : 9999;
}
