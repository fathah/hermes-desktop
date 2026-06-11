import { type BrowserWindow } from "electron";
import { safeHandle } from "./safe-handle";
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  listPending,
  removePending,
  triggerScheduleNow,
} from "../scheduled-research";
import type { ScheduleInput } from "../../shared/scheduledResearch";

type SchedulePatch = Parameters<typeof updateSchedule>[1];

export function registerScheduledResearchIpc(
  getWindow: () => BrowserWindow | null,
): void {
  safeHandle("sr-list", (_e, profile?: string) => listSchedules(profile));
  safeHandle("sr-create", (_e, input: ScheduleInput, profile?: string) =>
    createSchedule(input, profile),
  );
  safeHandle(
    "sr-update",
    (_e, id: string, patch: SchedulePatch, profile?: string) =>
      updateSchedule(id, patch, profile),
  );
  safeHandle("sr-delete", (_e, id: string, profile?: string) =>
    deleteSchedule(id, profile),
  );
  safeHandle("sr-run-now", (_e, id: string, profile?: string) =>
    triggerScheduleNow(id, getWindow, profile),
  );
  safeHandle("sr-list-pending", (_e, profile?: string) => listPending(profile));
  safeHandle("sr-remove-pending", (_e, id: string, profile?: string) =>
    removePending(id, profile),
  );
}
