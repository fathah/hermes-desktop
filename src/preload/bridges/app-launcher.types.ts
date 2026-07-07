import type * as Api from "../api-types";

type AppLaunchResult<T> = { ok: boolean; item?: T; error?: string };

export interface AppLauncherBridgeApi {
  appLaunchListTargets: (profile?: string) => Promise<Api.AppLaunchTarget[]>;

  appLaunchPickMacApplication: (
    profile?: string,
  ) => Promise<AppLaunchResult<Api.AppLaunchTarget>>;

  appLaunchAddUrlTarget: (
    input: { label: string; url: string },
    profile?: string,
  ) => Promise<AppLaunchResult<Api.AppLaunchTarget>>;

  appLaunchRemoveTarget: (
    id: string,
    profile?: string,
  ) => Promise<AppLaunchResult<Api.AppLaunchTarget>>;

  appLaunchRunTarget: (
    id: string,
    profile?: string,
  ) => Promise<AppLaunchResult<Api.AppLaunchTarget>>;

  appLaunchListSchedules: (
    profile?: string,
  ) => Promise<Api.AppLaunchSchedule[]>;

  appLaunchCreateSchedule: (
    input: Api.AppLaunchScheduleInput,
    profile?: string,
  ) => Promise<AppLaunchResult<Api.AppLaunchSchedule>>;

  appLaunchUpdateSchedule: (
    id: string,
    patch: Api.AppLaunchSchedulePatch,
    profile?: string,
  ) => Promise<AppLaunchResult<Api.AppLaunchSchedule>>;

  appLaunchDeleteSchedule: (
    id: string,
    profile?: string,
  ) => Promise<AppLaunchResult<Api.AppLaunchSchedule>>;

  appLaunchRunScheduleNow: (
    id: string,
    profile?: string,
  ) => Promise<AppLaunchResult<Api.AppLaunchSchedule>>;
}
