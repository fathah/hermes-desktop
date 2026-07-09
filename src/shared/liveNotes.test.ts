import { describe, expect, it } from "vitest";
import {
  backoffRemainingMs,
  buildLiveNoteRunMessages,
  cronMatchesAt,
  dueTimedTrigger,
  emailEventMatches,
  isCronDue,
  isValidCronExpr,
  isWindowDue,
  matchesLiveNoteKeyword,
  normalizeLiveNote,
  normalizeRegistry,
  parseLiveNoteModelOutput,
  validateLiveNoteInput,
  LIVE_NOTE_RETRY_BACKOFF_MS,
  NO_UPDATE_SENTINEL,
} from "./liveNotes";

describe("matchesLiveNoteKeyword", () => {
  it("matches whole words only", () => {
    expect(matchesLiveNoteKeyword("site visit tomorrow", "site")).toBe(true);
    expect(matchesLiveNoteKeyword("website redesign", "site")).toBe(false);
  });
});

describe("cron", () => {
  it("validates 5-field expressions", () => {
    expect(isValidCronExpr("0 7 * * *")).toBe(true);
    expect(isValidCronExpr("0 7 * *")).toBe(false);
    expect(isValidCronExpr("bad")).toBe(false);
  });

  it("matches local minute/hour", () => {
    const at = new Date(2026, 0, 15, 7, 0, 0); // local
    expect(cronMatchesAt("0 7 * * *", at)).toBe(true);
    expect(cronMatchesAt("30 7 * * *", at)).toBe(false);
  });

  it("isCronDue honors grace and lastRunAt", () => {
    const now = new Date(2026, 0, 15, 7, 1, 30); // 1.5 min after 07:00
    expect(isCronDue("0 7 * * *", undefined, now)).toBe(true);
    // Already ran at slot
    const slot = new Date(2026, 0, 15, 7, 0, 0).getTime();
    expect(isCronDue("0 7 * * *", slot, now)).toBe(false);
    // Missed by more than grace (2 min) — 07:00, now 07:05
    const late = new Date(2026, 0, 15, 7, 5, 0);
    expect(isCronDue("0 7 * * *", undefined, late)).toBe(false);
  });
});

describe("windows", () => {
  it("fires once per day inside window", () => {
    const now = new Date(2026, 0, 15, 10, 0, 0);
    const windows = [{ startTime: "09:00", endTime: "12:00" }];
    expect(isWindowDue(windows, undefined, now)).toBe(true);
    const already = new Date(2026, 0, 15, 9, 15, 0).getTime();
    expect(isWindowDue(windows, already, now)).toBe(false);
    // Yesterday run does not block
    const yesterday = new Date(2026, 0, 14, 10, 0, 0).getTime();
    expect(isWindowDue(windows, yesterday, now)).toBe(true);
  });

  it("outside window is not due", () => {
    const now = new Date(2026, 0, 15, 14, 0, 0);
    expect(
      isWindowDue([{ startTime: "09:00", endTime: "12:00" }], undefined, now),
    ).toBe(false);
  });
});

describe("dueTimedTrigger", () => {
  it("prefers cron over window when both due", () => {
    const now = new Date(2026, 0, 15, 7, 0, 30);
    const result = dueTimedTrigger(
      {
        cronExpr: "0 7 * * *",
        windows: [{ startTime: "06:00", endTime: "09:00" }],
      },
      undefined,
      now,
    );
    expect(result).toBe("cron");
  });
});

describe("emailEventMatches", () => {
  it("fails closed without hard filters", () => {
    expect(
      emailEventMatches(
        { description: "anything about the mall" },
        {
          subject: "Linking Road",
          bodyPreview: "hello",
          from: "a@b.com",
        },
      ),
    ).toBe(false);
  });

  it("requires all present filters (AND)", () => {
    const match = {
      keywords: ["linking"],
      fromIncludes: ["client.com"],
      triageLabels: ["urgent" as const],
    };
    expect(
      emailEventMatches(match, {
        subject: "Linking Road gate",
        bodyPreview: "missing guard",
        from: "ops@client.com",
        triageLabel: "urgent",
      }),
    ).toBe(true);
    expect(
      emailEventMatches(match, {
        subject: "Linking Road gate",
        bodyPreview: "missing guard",
        from: "ops@client.com",
        triageLabel: "archive",
      }),
    ).toBe(false);
  });

  it("skips digest unless triage allows", () => {
    expect(
      emailEventMatches(
        { keywords: ["newsletter"] },
        {
          subject: "weekly newsletter",
          bodyPreview: "stuff",
          from: "n@x.com",
          digest: true,
        },
      ),
    ).toBe(false);
    expect(
      emailEventMatches(
        { keywords: ["newsletter"], triageLabels: ["archive"] },
        {
          subject: "weekly newsletter",
          bodyPreview: "stuff",
          from: "n@x.com",
          triageLabel: "archive",
          digest: true,
        },
      ),
    ).toBe(true);
  });
});

describe("normalize + validate", () => {
  it("validates input", () => {
    expect(
      validateLiveNoteInput({ pageId: "site-x", objective: "Keep current" }),
    ).toBeNull();
    expect(validateLiveNoteInput({ pageId: "", objective: "x" })).toMatch(
      /page/i,
    );
    expect(
      validateLiveNoteInput({
        pageId: "a",
        objective: "x",
        triggers: { cronExpr: "bad" },
      }),
    ).toMatch(/Cron/i);
  });

  it("normalizes registry and dedupes pageId", () => {
    const reg = normalizeRegistry({
      version: 1,
      items: [
        { id: "1", pageId: "a", objective: "one", active: true },
        { id: "2", pageId: "a", objective: "two" },
        { id: "3", pageId: "b", objective: "three" },
      ],
    });
    expect(reg.items).toHaveLength(2);
    expect(reg.items[0].objective).toBe("one");
  });

  it("normalizeLiveNote defaults active and autoApply true", () => {
    const item = normalizeLiveNote({
      pageId: "p",
      objective: "obj",
    });
    expect(item?.active).toBe(true);
    expect(item?.autoApply).toBe(true);
  });
});

describe("backoffRemainingMs", () => {
  it("returns remaining ms inside window", () => {
    const now = 1_000_000;
    const last = now - 60_000;
    expect(backoffRemainingMs(last, now)).toBe(
      LIVE_NOTE_RETRY_BACKOFF_MS - 60_000,
    );
    expect(backoffRemainingMs(undefined, now)).toBe(0);
  });
});

describe("parseLiveNoteModelOutput", () => {
  it("detects NO_UPDATE and strips fences", () => {
    expect(parseLiveNoteModelOutput(NO_UPDATE_SENTINEL)).toEqual({
      action: "no_update",
    });
    expect(parseLiveNoteModelOutput("```md\n# Title\nHi\n```")).toEqual({
      action: "replace",
      body: "# Title\nHi",
    });
  });
});

describe("buildLiveNoteRunMessages", () => {
  it("includes objective and optional email fence", () => {
    const msgs = buildLiveNoteRunMessages({
      objective: "Keep Linking Road status",
      pageId: "linking-road",
      title: "Linking Road Mall",
      currentBody: "# Linking Road Mall\nOk",
      trigger: "email",
      dateStr: "2026-07-09",
      email: {
        subject: "Gate 2",
        bodyPreview: "Guard missing",
        from: "client@x.com",
        triageLabel: "urgent",
      },
    });
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].content).toContain("Keep Linking Road status");
    expect(msgs[1].content).toContain("<email_event>");
    expect(msgs[1].content).toContain("Gate 2");
  });
});
