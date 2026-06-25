import { describe, expect, it } from "vitest";
import {
  REQUEST_TIMEOUT_MS,
  STREAM_NO_CONTENT_DEADLINE_MS,
  requestTimeoutForAttempt,
  retryDelayWithinDeadline,
} from "../src/main/hermes/chat-client/deadline";

describe("chat SSE no-content retry deadline", () => {
  it("caps each request timeout by remaining outer budget", () => {
    const deadlineAt = 1_000 + STREAM_NO_CONTENT_DEADLINE_MS;

    expect(requestTimeoutForAttempt(deadlineAt, 1_000)).toBe(
      REQUEST_TIMEOUT_MS,
    );
    expect(requestTimeoutForAttempt(deadlineAt, deadlineAt - 5_000)).toBe(
      5_000,
    );
    expect(requestTimeoutForAttempt(deadlineAt, deadlineAt)).toBe(0);
  });

  it("skips or truncates retry delays once the no-content budget is exhausted", () => {
    const deadlineAt = 10_000;

    expect(retryDelayWithinDeadline(2_000, deadlineAt, 7_500)).toBe(2_000);
    expect(retryDelayWithinDeadline(2_000, deadlineAt, 9_000)).toBe(1_000);
    expect(retryDelayWithinDeadline(2_000, deadlineAt, 10_000)).toBeNull();
  });
});
