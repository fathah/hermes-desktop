import { describe, expect, it, vi } from "vitest";
import {
  cycleRunId,
  isScratchRun,
  mintRun,
  openSessionRunTransition,
  runIdAtOrdinal,
  selectProfileRunTransition,
  type ChatRun,
} from "./chatRuns";

function run(
  runId: string,
  profile: string,
  patch: Partial<ChatRun> = {},
): ChatRun {
  return {
    runId,
    profile,
    sessionId: null,
    loading: false,
    ...patch,
  };
}

describe("chat run profile transitions", () => {
  it("re-homes a scratch run when switching profiles", () => {
    const runs = [run("run-a", "kitt")];

    const next = selectProfileRunTransition(runs, "run-a", "alfie");

    expect(next.activeRunId).toBe("run-a");
    expect(next.runs).toEqual([{ ...runs[0], profile: "alfie" }]);
  });

  it("activates an existing scratch run for the selected profile", () => {
    const runs = [
      run("run-kitt", "kitt", { sessionId: "session-kitt" }),
      run("run-alfie", "alfie"),
    ];

    const next = selectProfileRunTransition(runs, "run-kitt", "alfie");

    expect(next.activeRunId).toBe("run-alfie");
    expect(next.runs).toBe(runs);
  });

  it("creates a scratch run instead of showing an old-profile chat", () => {
    const randomUUID = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-000000000001");
    const runs = [run("run-kitt", "kitt", { sessionId: "session-kitt" })];

    const next = selectProfileRunTransition(runs, "run-kitt", "alfie");

    expect(next.activeRunId).toBe("run-00000000-0000-4000-8000-000000000001");
    expect(next.runs).toEqual([
      runs[0],
      {
        runId: "run-00000000-0000-4000-8000-000000000001",
        profile: "alfie",
        sessionId: null,
        loading: false,
      },
    ]);
    randomUUID.mockRestore();
  });

  it("recognizes only blank unused runs as scratch", () => {
    expect(isScratchRun(run("blank", "alfie"))).toBe(true);
    expect(isScratchRun(run("session", "alfie", { sessionId: "s1" }))).toBe(
      false,
    );
    expect(isScratchRun(run("loading", "alfie", { loading: true }))).toBe(
      false,
    );
    expect(isScratchRun(run("titled", "alfie", { title: "hello" }))).toBe(
      false,
    );
  });

  it("mints runs under the requested profile", () => {
    const randomUUID = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-000000000002");

    expect(mintRun("alfie")).toEqual({
      runId: "run-00000000-0000-4000-8000-000000000002",
      profile: "alfie",
      sessionId: null,
      loading: false,
      seed: undefined,
    });
    randomUUID.mockRestore();
  });

  it("replaces the active same-profile scratch run when opening a session", () => {
    const scratch = run("run-scratch", "test-writer");
    const saved = run("run-saved", "test-writer", {
      sessionId: "session-saved",
      title: "ok my bro",
    });

    const next = openSessionRunTransition(
      [run("run-old", "default", { sessionId: "session-old" }), scratch],
      "run-scratch",
      saved,
    );

    expect(next.activeRunId).toBe("run-saved");
    expect(next.runs).toEqual([
      run("run-old", "default", { sessionId: "session-old" }),
      saved,
    ]);
  });

  it("appends a saved session when the active run is not a scratch placeholder", () => {
    const active = run("run-active", "test-writer", {
      sessionId: "session-active",
      title: "existing",
    });
    const saved = run("run-saved", "test-writer", {
      sessionId: "session-saved",
      title: "ok my bro",
    });

    const next = openSessionRunTransition([active], "run-active", saved);

    expect(next.activeRunId).toBe("run-saved");
    expect(next.runs).toEqual([active, saved]);
  });
});

describe("chrome-style tab shortcuts", () => {
  const three = [run("run-1", "a"), run("run-2", "b"), run("run-3", "c")];

  it("cycles forward and backward with wrap-around", () => {
    expect(cycleRunId(three, "run-1", 1)).toBe("run-2");
    expect(cycleRunId(three, "run-3", 1)).toBe("run-1");
    expect(cycleRunId(three, "run-1", -1)).toBe("run-3");
    expect(cycleRunId(three, "run-2", -1)).toBe("run-1");
  });

  it("returns null when there is nothing to cycle to", () => {
    expect(cycleRunId([], "run-x", 1)).toBeNull();
    expect(cycleRunId([run("run-1", "a")], "run-1", 1)).toBeNull();
  });

  it("falls back to the first run when the active id is unknown", () => {
    expect(cycleRunId(three, "run-gone", 1)).toBe("run-1");
  });

  it("selects the Nth tab by ordinal", () => {
    expect(runIdAtOrdinal(three, 1)).toBe("run-1");
    expect(runIdAtOrdinal(three, 3)).toBe("run-3");
  });

  it("maps 9 to the last tab regardless of count", () => {
    expect(runIdAtOrdinal(three, 9)).toBe("run-3");
    expect(runIdAtOrdinal([run("run-only", "a")], 9)).toBe("run-only");
  });

  it("returns null for ordinals without a tab", () => {
    expect(runIdAtOrdinal(three, 4)).toBeNull();
    expect(runIdAtOrdinal([], 1)).toBeNull();
    expect(runIdAtOrdinal([], 9)).toBeNull();
  });
});
