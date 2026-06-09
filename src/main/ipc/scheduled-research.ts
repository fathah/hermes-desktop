import { ipcMain, type BrowserWindow } from "electron";
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  listPending,
  removePending,
  triggerScheduleNow,
  getTelegramAvailability,
} from "../scheduled-research";
import type { ScheduleInput } from "../../shared/scheduledResearch";

type SchedulePatch = Parameters<typeof updateSchedule>[1];

export function registerScheduledResearchIpc(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle("sr-list", (_e, profile?: string) => listSchedules(profile));
  ipcMain.handle("sr-create", (_e, input: ScheduleInput, profile?: string) =>
    createSchedule(input, profile),
  );
  ipcMain.handle(
    "sr-update",
    (_e, id: string, patch: SchedulePatch, profile?: string) =>
      updateSchedule(id, patch, profile),
  );
  ipcMain.handle("sr-delete", (_e, id: string, profile?: string) =>
    deleteSchedule(id, profile),
  );
  ipcMain.handle("sr-run-now", (_e, id: string, profile?: string) =>
    triggerScheduleNow(id, getWindow, profile),
  );
  ipcMain.handle("sr-list-pending", (_e, profile?: string) =>
    listPending(profile),
  );
  ipcMain.handle("sr-remove-pending", (_e, id: string, profile?: string) =>
    removePending(id, profile),
  );
  ipcMain.handle("sr-telegram-availability", (_e, profile?: string) =>
    getTelegramAvailability(profile),
  );
}
