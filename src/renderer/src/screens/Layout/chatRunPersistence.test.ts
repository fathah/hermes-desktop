import { beforeEach, describe, expect, it } from "vitest";
import type { ChatRun } from "./chatRuns";
import {
  deleteChatRunTranscript,
  loadChatRunTranscript,
  persistChatRunsState,
  restoreChatRunsState,
  saveChatRunTranscript,
} from "./chatRunPersistence";
import type { ChatMessage } from "../Chat/types";

const run: ChatRun = {
  runId: "run-saved",
  profile: "research-agent",
  sessionId: "session-saved",
  loading: true,
  title: "Long investigation",
};

const transcript: ChatMessage[] = [
  {
    id: "user-1",
    role: "user",
    content: "trace the context flow",
  },
  {
    id: "agent-1",
    role: "agent",
    content: "partial analysis that streamed before reload",
    pending: true,
  },
];

describe("chat run persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("restores open runs with their visible transcript snapshots", () => {
    saveChatRunTranscript(run.runId, transcript);
    persistChatRunsState([run], run.runId);

    const restored = restoreChatRunsState();

    expect(restored?.activeRunId).toBe(run.runId);
    expect(restored?.activeProfile).toBe(run.profile);
    expect(restored?.runs).toHaveLength(1);
    expect(restored?.runs[0]).toMatchObject({
      runId: run.runId,
      profile: run.profile,
      sessionId: run.sessionId,
      loading: false,
      title: run.title,
    });
    expect(restored?.runs[0].seed?.[0]).toMatchObject(transcript[0]);
    expect(restored?.runs[0].seed?.[1]).toMatchObject({
      id: "agent-1",
      role: "agent",
      content: "partial analysis that streamed before reload",
      pending: false,
    });
  });

  it("deletes transcript snapshots for discarded runs", () => {
    saveChatRunTranscript(run.runId, transcript);
    expect(loadChatRunTranscript(run.runId)).toHaveLength(2);

    deleteChatRunTranscript(run.runId);

    expect(loadChatRunTranscript(run.runId)).toEqual([]);
  });
});
