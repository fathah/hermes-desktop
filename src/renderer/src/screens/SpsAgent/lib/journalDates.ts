// journalDates.ts — pure date helpers for the journal/calendar surface.
// Kept free of React/DOM so they unit-test cleanly. All dates are handled in
// the user's local timezone (a diary is a local-day concept, not UTC).

/** Zero-pad a number to 2 digits. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Format a Date as a local "YYYY-MM-DD" key. */
export function isoFromDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Format a Date as a local "HH:mm" string. */
export function hmFromDate(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Parse a "YYYY-MM-DD" key into its parts, or null when malformed. */
export function parseISO(
  iso: string,
): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1; // 0-based
  const day = Number(m[3]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return { year, month, day };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "June 2026" for a 0-based month. */
export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month] ?? ""} ${year}`;
}

/**
 * The day-cells of a month grid, Sunday-first, padded with leading/trailing
 * nulls so the length is a multiple of 7. Each non-null cell is the local
 * "YYYY-MM-DD" key for that day.
 */
export function monthGrid(year: number, month: number): (string | null)[] {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${pad2(month + 1)}-${pad2(d)}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Step a "YYYY-MM-DD" key forward/back by whole months (clamping the day). */
export function addMonths(iso: string, delta: number): string {
  const parts = parseISO(iso);
  if (!parts) return iso;
  const base = new Date(parts.year, parts.month + delta, 1);
  return isoFromDate(base);
}

/** The same calendar day shifted by whole years ("on this day, N years ago"). */
export function shiftYears(iso: string, delta: number): string | null {
  const parts = parseISO(iso);
  if (!parts) return null;
  return `${parts.year + delta}-${pad2(parts.month + 1)}-${pad2(parts.day)}`;
}

/** "Fri, 5 Jun 2026" — a human label for an entry's day. */
export function prettyDate(iso: string): string {
  const parts = parseISO(iso);
  if (!parts) return iso;
  const d = new Date(parts.year, parts.month, parts.day);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  return `${weekday}, ${parts.day} ${MONTHS[parts.month]?.slice(0, 3)} ${parts.year}`;
}
