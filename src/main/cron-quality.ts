// cron-quality.ts — pure cron-quality controls (freshness window, failure
// behavior, first-run-manual), split out from cronjobs.ts so it imports NOTHING
// (no installer/hermes/better-sqlite3) and can be unit-tested under vitest. The
// instruction-fold is the load-bearing bit: these controls only matter if the
// AGENT sees them, so they go into the job prompt — not just the UI.

/** Cron-quality controls (desktop-side; folded into the instruction). */
export interface CronQualityOpts {
  /** Only consider items newer than this many minutes (0 = no window). */
  freshnessWindowMinutes?: number;
  /** What the agent should do on failure / empty result. */
  failureBehavior?: "retry" | "notify" | "ignore";
  /** Create the job paused so the first run is reviewed before trusting it. */
  firstRunManual?: boolean;
}

/** Human-readable freshness window ("6 hour(s)", "1 day(s)", "1 week(s)"). */
export function freshnessLabel(minutes: number): string {
  if (minutes % 10080 === 0) return `${minutes / 10080} week(s)`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day(s)`;
  if (minutes % 60 === 0) return `${minutes / 60} hour(s)`;
  return `${minutes} minute(s)`;
}

/**
 * Fold the cron-quality controls into the job instruction so the AGENT honors
 * them (the doc's point: freshness + failure behavior must live in the prompt,
 * not just the UI). Pure.
 */
export function augmentPrompt(prompt: string, opts?: CronQualityOpts): string {
  if (!opts) return prompt;
  const rules: string[] = [];
  if (opts.freshnessWindowMinutes && opts.freshnessWindowMinutes > 0) {
    rules.push(
      `Only consider items from the last ${freshnessLabel(
        opts.freshnessWindowMinutes,
      )}. If there is nothing new in that window, say so plainly and do not invent updates.`,
    );
  }
  if (opts.failureBehavior === "retry") {
    rules.push(
      "If the run fails, retry once; if it still fails, report the failure.",
    );
  } else if (opts.failureBehavior === "ignore") {
    rules.push("If there is nothing worth reporting, produce no output.");
  } else {
    rules.push(
      "If the run fails or there is nothing to report, say so explicitly; do not fabricate results.",
    );
  }
  if (!rules.length) return prompt;
  const block = `Operating rules:\n${rules.map((r) => `- ${r}`).join("\n")}`;
  return prompt ? `${prompt}\n\n${block}` : block;
}
