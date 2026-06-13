import { describe, it, expect } from "vitest";
import { ErrorDoctor, FailoverReason } from "../src/main/hermes/error-doctor";

describe("ErrorDoctor", () => {
  it("classifies based on HTTP status codes", () => {
    const r1 = ErrorDoctor.classify("Too Many Requests", 429);
    expect(r1.reason).toBe(FailoverReason.RATE_LIMIT);
    expect(r1.shouldRotateCredential).toBe(true);
    expect(r1.retryable).toBe(true);

    const r2 = ErrorDoctor.classify("Payment Required", 402);
    expect(r2.reason).toBe(FailoverReason.BILLING);
    expect(r2.shouldRotateCredential).toBe(true);

    const r3 = ErrorDoctor.classify("Unauthorized key", 401);
    expect(r3.reason).toBe(FailoverReason.AUTH);
    expect(r3.shouldRotateCredential).toBe(true);

    const r4 = ErrorDoctor.classify("Payload too large", 413);
    expect(r4.reason).toBe(FailoverReason.CONTEXT_OVERFLOW);
    expect(r4.shouldCompress).toBe(true);

    const r5 = ErrorDoctor.classify("Service Unavailable", 503);
    expect(r5.reason).toBe(FailoverReason.OVERLOADED);
    expect(r5.retryable).toBe(true);
  });

  it("classifies based on error message substrings", () => {
    const r1 = ErrorDoctor.classify("your credit balance is insufficient to complete the request");
    expect(r1.reason).toBe(FailoverReason.BILLING);
    expect(r1.shouldRotateCredential).toBe(true);

    const r2 = ErrorDoctor.classify("rate limit exceeded on tokens per minute");
    expect(r2.reason).toBe(FailoverReason.RATE_LIMIT);
    expect(r2.shouldRotateCredential).toBe(true);

    const r3 = ErrorDoctor.classify("invalid_api_key provided");
    expect(r3.reason).toBe(FailoverReason.AUTH);

    const r4 = ErrorDoctor.classify("maximum context length exceeded: 200000 > 128000");
    expect(r4.reason).toBe(FailoverReason.CONTEXT_OVERFLOW);
    expect(r4.shouldCompress).toBe(true);

    const r5 = ErrorDoctor.classify("upstream server overloaded or temporarily busy");
    expect(r5.reason).toBe(FailoverReason.OVERLOADED);

    const r6 = ErrorDoctor.classify("connection timed out during handoff");
    expect(r6.reason).toBe(FailoverReason.TIMEOUT);
  });

  it("defaults to UNKNOWN for unclassifiable strings", () => {
    const r = ErrorDoctor.classify("Some random weird networking issue");
    expect(r.reason).toBe(FailoverReason.UNKNOWN);
    expect(r.retryable).toBe(false);
  });
});
