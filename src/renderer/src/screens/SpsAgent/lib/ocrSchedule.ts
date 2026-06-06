// ocrSchedule.ts — optionally defer OCR to a quiet overnight window (item 2,
// P3). Default OFF: OCR drains immediately in the background (P2). When ON,
// queued jobs wait until the configured time and then drain — so a stack of
// scans dropped during the day is processed at night WITHOUT hogging the
// machine while you work. Caveat (surfaced in the UI): this only fires if the
// app is open (or in the tray) at that time — there is no OS daemon by design.
const DEFER_KEY = "hermes-ocr-defer-overnight-v1";
const TIME_KEY = "hermes-ocr-time-v1";
const DEFAULT_TIME = "02:00";

export function getOcrDefer(): boolean {
  try {
    return localStorage.getItem(DEFER_KEY) === "true";
  } catch {
    return false;
  }
}

export function setOcrDefer(on: boolean): void {
  try {
    localStorage.setItem(DEFER_KEY, on ? "true" : "false");
  } catch {
    /* best effort */
  }
}

export function getOcrTime(): string {
  try {
    return localStorage.getItem(TIME_KEY) || DEFAULT_TIME;
  } catch {
    return DEFAULT_TIME;
  }
}

export function setOcrTime(time: string): void {
  try {
    localStorage.setItem(TIME_KEY, time);
  } catch {
    /* best effort */
  }
}

/** Whether `now` falls within the scheduled minute "HH:MM". Pure/testable. */
export function isScheduledNow(now: Date, time: string): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return false;
  return now.getHours() === Number(m[1]) && now.getMinutes() === Number(m[2]);
}
