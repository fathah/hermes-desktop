import { describe, expect, it } from "vitest";
import {
  mintRun,
  patchRun,
  findRunByLocation,
  loadingSessionIds,
  type ChatRun,
} from "../src/renderer/src/screens/Layout/chatRuns";
import { eventMatchesRun } from "../src/renderer/src/screens/Chat/hooks/useChatIPC";

describe("eventMatchesRun", () => {
  it("accepts only the run's own events", () => {
    expect(eventMatchesRun("run-a", "run-a")).toBe(true);
    expect(eventMatchesRun("run-b", "run-a")).toBe(false);
  });
});

describe("chatRuns helpers", () => {
  it("mints unique ids and carries the profile", () => {
    const a = mintRun("connection-a", "default");
    const b = mintRun("connection-b", "work");
    expect(a.runId).not.toEqual(b.runId);
    expect(a.profile).toBe("default");
    expect(b.profile).toBe("work");
    expect(a.connectionId).toBe("connection-a");
    expect(b.connectionId).toBe("connection-b");
    expect(a.sessionId).toBeNull();
    expect(a.loading).toBe(false);
  });

  it("seeds messages when provided", () => {
    const seeded = mintRun("connection-a", "default", [
      { id: "u-1", role: "user", content: "hi" },
    ]);
    expect(seeded.seed).toHaveLength(1);
  });

  it("patchRun updates only the targeted run immutably", () => {
    const runs: ChatRun[] = [
      {
        runId: "r1",
        connectionId: "connection-a",
        profile: "a",
        sessionId: null,
        loading: false,
      },
      {
        runId: "r2",
        connectionId: "connection-a",
        profile: "b",
        sessionId: null,
        loading: false,
      },
    ];
    const next = patchRun(runs, "r2", { loading: true, sessionId: "s2" });
    expect(next).not.toBe(runs);
    expect(next[0]).toEqual(runs[0]);
    expect(next[1]).toMatchObject({ loading: true, sessionId: "s2" });
  });

  // @lat: [[connections#Session locations#Run identity isolation]]
  it("findRunByLocation requires the full connection/profile/session tuple", () => {
    const runs: ChatRun[] = [
      {
        runId: "r1",
        connectionId: "connection-a",
        profile: "a",
        sessionId: "shared",
        loading: false,
      },
      {
        runId: "r2",
        connectionId: "connection-b",
        profile: "b",
        sessionId: "shared",
        loading: true,
      },
    ];
    expect(
      findRunByLocation(runs, {
        connectionId: "connection-b",
        profile: "b",
        sessionId: "shared",
      })?.runId,
    ).toBe("r2");
    expect(
      findRunByLocation(runs, {
        connectionId: "connection-a",
        profile: "b",
        sessionId: "shared",
      }),
    ).toBeUndefined();
  });

  it("loadingSessionIds collects only loading runs with a session id", () => {
    const runs: ChatRun[] = [
      {
        runId: "r1",
        connectionId: "connection-a",
        profile: "a",
        sessionId: "s1",
        loading: true,
      },
      {
        runId: "r2",
        connectionId: "connection-a",
        profile: "b",
        sessionId: "s2",
        loading: false,
      },
      {
        runId: "r3",
        connectionId: "connection-a",
        profile: "c",
        sessionId: null,
        loading: true,
      },
    ];
    const ids = loadingSessionIds(runs);
    expect(ids.has("s1")).toBe(true);
    expect(ids.has("s2")).toBe(false);
    expect(ids.size).toBe(1);
  });
});
