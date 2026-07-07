import { safeHandle } from "./safe-handle";
import {
  addUrlLaunchTarget,
  createAppLaunchSchedule,
  deleteAppLaunchSchedule,
  listAppLaunchSchedules,
  listAppLaunchTargets,
  pickMacApplicationTarget,
  removeAppLaunchTarget,
  runAppLaunchScheduleNow,
  runAppLaunchTarget,
  updateAppLaunchSchedule,
} from "../app-launcher";
import type {
  AppLaunchScheduleInput,
  AppLaunchSchedulePatch,
} from "../../shared/app-launcher";

export function registerAppLauncherIpc(): void {
  safeHandle("app-launch-list-targets", (_event, profile?: string) =>
    listAppLaunchTargets(profile),
  );
  safeHandle("app-launch-pick-mac-application", (_event, profile?: string) =>
    pickMacApplicationTarget(profile),
  );
  safeHandle(
    "app-launch-add-url-target",
    (_event, input: { label: string; url: string }, profile?: string) =>
      addUrlLaunchTarget(input, profile),
  );
  safeHandle(
    "app-launch-remove-target",
    (_event, id: string, profile?: string) =>
      removeAppLaunchTarget(id, profile),
  );
  safeHandle("app-launch-run-target", (_event, id: string, profile?: string) =>
    runAppLaunchTarget(id, profile),
  );
  safeHandle("app-launch-list-schedules", (_event, profile?: string) =>
    listAppLaunchSchedules(profile),
  );
  safeHandle(
    "app-launch-create-schedule",
    (_event, input: AppLaunchScheduleInput, profile?: string) =>
      createAppLaunchSchedule(input, profile),
  );
  safeHandle(
    "app-launch-update-schedule",
    (_event, id: string, patch: AppLaunchSchedulePatch, profile?: string) =>
      updateAppLaunchSchedule(id, patch, profile),
  );
  safeHandle(
    "app-launch-delete-schedule",
    (_event, id: string, profile?: string) =>
      deleteAppLaunchSchedule(id, profile),
  );
  safeHandle(
    "app-launch-run-schedule-now",
    (_event, id: string, profile?: string) =>
      runAppLaunchScheduleNow(id, profile),
  );
}
