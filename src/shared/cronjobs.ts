// Shared cron-job IPC type — single source of truth for a scheduled job.
// Producer: src/main/cronjobs.ts. Contract: src/preload/index.d.ts.
// Consumer: the renderer Schedules screen.

export const LOCAL_CRON_DELIVERY_TARGET = "local";

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  state: "active" | "paused" | "completed";
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  repeat: { times: number | null; completed: number } | null;
  deliver: string[];
  skills: string[];
  script: string | null;
}
