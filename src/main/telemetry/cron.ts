/**
 * IPC handlers for cron CRUD — the Phase-4 (PR-E1) mutation
 * surface. Backend already exposes /api/jobs/* POST/PATCH/DELETE
 * and the lifecycle actions (pause / resume / run). These
 * handlers are thin pass-throughs that reuse the shared
 * mutation client.
 */

import { telemetryRequest, type MutationResult } from "./mutations";

export interface CronJobInput {
  name: string;
  schedule: string;
  prompt?: string;
  deliver?: string;
  skills?: string[];
  repeat?: number;
}

export interface CronJobPatch {
  name?: string;
  schedule?: string;
  prompt?: string;
  deliver?: string;
  skills?: string[];
  repeat?: number;
}

export async function createCronJob(
  input: CronJobInput,
): Promise<MutationResult> {
  return telemetryRequest("POST", "/api/jobs", input);
}

export async function updateCronJob(
  jobId: string,
  patch: CronJobPatch,
): Promise<MutationResult> {
  return telemetryRequest(
    "PATCH",
    `/api/jobs/${encodeURIComponent(jobId)}`,
    patch,
  );
}

export async function deleteCronJob(
  jobId: string,
): Promise<MutationResult> {
  return telemetryRequest(
    "DELETE",
    `/api/jobs/${encodeURIComponent(jobId)}`,
  );
}

export async function pauseCronJob(
  jobId: string,
): Promise<MutationResult> {
  return telemetryRequest(
    "POST",
    `/api/jobs/${encodeURIComponent(jobId)}/pause`,
  );
}

export async function resumeCronJob(
  jobId: string,
): Promise<MutationResult> {
  return telemetryRequest(
    "POST",
    `/api/jobs/${encodeURIComponent(jobId)}/resume`,
  );
}

export async function runCronJob(
  jobId: string,
): Promise<MutationResult> {
  return telemetryRequest(
    "POST",
    `/api/jobs/${encodeURIComponent(jobId)}/run`,
  );
}
