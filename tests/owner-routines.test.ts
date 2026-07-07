import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_CRON_DELIVERY_TARGET } from "../src/shared/cronjobs";

const { createCronJob, listCronJobs } = vi.hoisted(() => ({
  createCronJob: vi.fn(),
  listCronJobs: vi.fn(),
}));

vi.mock("../src/main/cronjobs", () => ({
  createCronJob,
  listCronJobs,
}));

describe("owner-critical engine cron routines", () => {
  beforeEach(async () => {
    createCronJob.mockReset();
    listCronJobs.mockReset();
    createCronJob.mockResolvedValue({ success: true, paused: true });
    listCronJobs.mockResolvedValue([]);
    const mod = await import("../src/main/owner-routines");
    mod.__resetOwnerRoutineBootstrapForTests();
  });

  it("creates morning brief and overnight triage cron jobs paused for manual first run", async () => {
    const { ensureOwnerCriticalCronJobs } =
      await import("../src/main/owner-routines");

    const result = await ensureOwnerCriticalCronJobs("default");

    expect(result.failed).toEqual([]);
    expect(createCronJob).toHaveBeenCalledTimes(2);
    expect(createCronJob).toHaveBeenNthCalledWith(
      1,
      "0 7 * * *",
      expect.stringContaining("delivery-ready summary"),
      "owner-routine:morning-brief",
      LOCAL_CRON_DELIVERY_TARGET,
      "default",
      { firstRunManual: true, failureBehavior: "notify" },
    );
    expect(createCronJob).toHaveBeenNthCalledWith(
      2,
      "0 2 * * *",
      expect.stringContaining("review-ready summary"),
      "owner-routine:overnight-triage",
      LOCAL_CRON_DELIVERY_TARGET,
      "default",
      { firstRunManual: true, failureBehavior: "notify" },
    );
    expect(createCronJob.mock.calls[0][1]).toContain(
      "Daily Brief - [local YYYY-MM-DD].md",
    );
    expect(createCronJob.mock.calls[0][1]).toContain(
      "rely only on this cron job's configured delivery target",
    );
    expect(createCronJob.mock.calls[1][1]).toContain(
      "Overnight Triage - [local YYYY-MM-DD].md",
    );
    expect(createCronJob.mock.calls[1][1]).toContain(
      "Do not send ad hoc external messages",
    );
  });

  it("does not duplicate already-created owner routine jobs", async () => {
    listCronJobs.mockResolvedValue([
      { id: "job1", name: "owner-routine:morning-brief" },
    ]);
    const { ensureOwnerCriticalCronJobs } =
      await import("../src/main/owner-routines");

    const result = await ensureOwnerCriticalCronJobs("default");

    expect(result.existing).toEqual(["owner-routine:morning-brief"]);
    expect(result.created).toEqual(["owner-routine:overnight-triage"]);
    expect(createCronJob).toHaveBeenCalledTimes(1);
    expect(createCronJob.mock.calls[0][2]).toBe(
      "owner-routine:overnight-triage",
    );
  });

  it("uses stable per-day output filenames for idempotent routine output", async () => {
    const { ownerRoutineFileName } = await import("../src/main/owner-routines");
    const day = new Date("2026-07-07T18:30:00.000Z");

    expect(ownerRoutineFileName("morning-brief", day)).toBe(
      "Daily Brief - 2026-07-07.md",
    );
    expect(ownerRoutineFileName("overnight-triage", day)).toBe(
      "Overnight Triage - 2026-07-07.md",
    );
  });
});
