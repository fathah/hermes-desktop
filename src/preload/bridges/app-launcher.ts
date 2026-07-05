import { ipcRenderer } from "electron";
import type {
  AppLaunchSchedule,
  AppLaunchScheduleInput,
  AppLaunchSchedulePatch,
  AppLaunchTarget,
} from "../../shared/app-launcher";
import type { AppLauncherBridgeApi } from "./app-launcher.types";

type AppLaunchResult<T> = { ok: boolean; item?: T; error?: string };

export const appLauncherBridge = {
  appLaunchListTargets: (profile?: string): Promise<AppLaunchTarget[]> =>
    ipcRenderer.invoke("app-launch-list-targets", profile),
  appLaunchPickMacApplication: (
    profile?: string,
  ): Promise<AppLaunchResult<AppLaunchTarget>> =>
    ipcRenderer.invoke("app-launch-pick-mac-application", profile),
  appLaunchAddUrlTarget: (
    input: { label: string; url: string },
    profile?: string,
  ): Promise<AppLaunchResult<AppLaunchTarget>> =>
    ipcRenderer.invoke("app-launch-add-url-target", input, profile),
  appLaunchRemoveTarget: (
    id: string,
    profile?: string,
  ): Promise<AppLaunchResult<AppLaunchTarget>> =>
    ipcRenderer.invoke("app-launch-remove-target", id, profile),
  appLaunchRunTarget: (
    id: string,
    profile?: string,
  ): Promise<AppLaunchResult<AppLaunchTarget>> =>
    ipcRenderer.invoke("app-launch-run-target", id, profile),
  appLaunchListSchedules: (profile?: string): Promise<AppLaunchSchedule[]> =>
    ipcRenderer.invoke("app-launch-list-schedules", profile),
  appLaunchCreateSchedule: (
    input: AppLaunchScheduleInput,
    profile?: string,
  ): Promise<AppLaunchResult<AppLaunchSchedule>> =>
    ipcRenderer.invoke("app-launch-create-schedule", input, profile),
  appLaunchUpdateSchedule: (
    id: string,
    patch: AppLaunchSchedulePatch,
    profile?: string,
  ): Promise<AppLaunchResult<AppLaunchSchedule>> =>
    ipcRenderer.invoke("app-launch-update-schedule", id, patch, profile),
  appLaunchDeleteSchedule: (
    id: string,
    profile?: string,
  ): Promise<AppLaunchResult<AppLaunchSchedule>> =>
    ipcRenderer.invoke("app-launch-delete-schedule", id, profile),
  appLaunchRunScheduleNow: (
    id: string,
    profile?: string,
  ): Promise<AppLaunchResult<AppLaunchSchedule>> =>
    ipcRenderer.invoke("app-launch-run-schedule-now", id, profile),
} satisfies AppLauncherBridgeApi;
