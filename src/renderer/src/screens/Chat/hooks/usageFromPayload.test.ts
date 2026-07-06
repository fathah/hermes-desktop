import { describe, expect, it } from "vitest";

import {
  estimateContextTokens,
  usageFromPayload,
} from "./useDashboardChatTransport";
import type { ChatMessage } from "../types";

describe("usageFromPayload", () => {
  it("reads the Hermes gateway snake-case keys (input/prompt/context_used)", () => {
    // Shape emitted by tui_gateway/server.py `_get_usage` on message.complete.
    const result = usageFromPayload({
      usage: {
        model: "claude-opus-4-8",
        input: 12000,
        output: 800,
        prompt: 12000,
        completion: 800,
        total: 12800,
        context_used: 45000,
        context_max: 200000,
        context_percent: 23,
      },
    });
    expect(result).not.toBeNull();
    expect(result?.promptTokens).toBe(12000);
    expect(result?.completionTokens).toBe(800);
    expect(result?.totalTokens).toBe(12800);
    // Gauge must use the live context occupancy, not the cross-turn prompt sum.
    expect(result?.contextTokens).toBe(45000);
    // Denominator comes from the gateway's authoritative context_max.
    expect(result?.contextWindowTokens).toBe(200000);
  });

  it("omits contextWindowTokens when the gateway doesn't report context_max", () => {
    const result = usageFromPayload({
      usage: { input: 5000, output: 200, total: 5200 },
    });
    expect(result?.contextWindowTokens).toBeUndefined();
  });

  it("falls back to prompt tokens for context when compressor is inactive", () => {
    const result = usageFromPayload({
      usage: { input: 5000, output: 200, total: 5200 },
    });
    expect(result?.contextTokens).toBe(5000);
  });

  it("still reads legacy OpenAI-style *_tokens keys", () => {
    const result = usageFromPayload({
      usage: {
        prompt_tokens: 3000,
        completion_tokens: 150,
        total_tokens: 3150,
      },
    });
    expect(result?.promptTokens).toBe(3000);
    expect(result?.completionTokens).toBe(150);
    expect(result?.totalTokens).toBe(3150);
    expect(result?.contextTokens).toBe(3000);
  });

  it("reads camelCase keys", () => {
    const result = usageFromPayload({
      usage: { promptTokens: 700, completionTokens: 50, totalTokens: 750 },
    });
    expect(result?.promptTokens).toBe(700);
    expect(result?.contextTokens).toBe(700);
  });

  it("derives totalTokens from prompt + completion when absent", () => {
    const result = usageFromPayload({ usage: { input: 100, output: 40 } });
    expect(result?.totalTokens).toBe(140);
  });

  it("returns a gauge value when only context_used is present", () => {
    const result = usageFromPayload({ usage: { context_used: 9000 } });
    expect(result).not.toBeNull();
    expect(result?.contextTokens).toBe(9000);
  });

  it("returns null when there is no usable usage data", () => {
    expect(usageFromPayload({ usage: {} })).toBeNull();
    expect(usageFromPayload({})).toBeNull();
    expect(usageFromPayload(null)).toBeNull();
    expect(
      usageFromPayload({
        usage: { input: 0, output: 0, total: 0, context_used: 0 },
      }),
    ).toBeNull();
  });
});

describe("estimateContextTokens", () => {
  const chars = (n: number): string => "x".repeat(n);

  it("estimates chars/4 excluding the just-completed assistant reply", () => {
    // 400 user chars + 200 reply chars; the reply was generated output, not
    // prompt occupancy, so only the user side counts: 400 / 4 = 100.
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: chars(400) },
      { id: "a1", role: "agent", content: chars(200) },
    ];
    expect(estimateContextTokens(messages)).toBe(100);
  });

  it("keeps earlier assistant replies — only the last bubble is excluded", () => {
    // Turn 1's reply is part of turn 2's prompt: (400 + 200 + 400) / 4 = 250.
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: chars(400) },
      { id: "a1", role: "agent", content: chars(200) },
      { id: "u2", role: "user", content: chars(400) },
      { id: "a2", role: "agent", content: chars(200) },
    ];
    expect(estimateContextTokens(messages)).toBe(250);
  });

  it("counts reasoning/tool sub-rows and excludes the bubble, not a sub-row", () => {
    // Tool args, tool output, and reasoning all occupied the prompt loop.
    // The trailing tool_result has role "agent" too — the exclusion must
    // land on the reply bubble (200), not on whichever agent row happens to
    // be last-by-role. (400 + 100 + (20+80) + 300) / 4 = 225.
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: chars(400) },
      { id: "r1", kind: "reasoning", role: "agent", text: chars(100) },
      {
        id: "tc1",
        kind: "tool_call",
        role: "agent",
        callId: "c1",
        name: chars(20),
        args: chars(80),
      },
      { id: "a1", role: "agent", content: chars(200) },
      {
        id: "tr1",
        kind: "tool_result",
        role: "agent",
        callId: "c1",
        name: "t",
        content: chars(300),
      },
    ];
    expect(estimateContextTokens(messages)).toBe(225);
  });

  it("never returns a negative estimate", () => {
    const messages: ChatMessage[] = [
      { id: "a1", role: "agent", content: chars(200) },
    ];
    expect(estimateContextTokens(messages)).toBe(0);
  });

  it("returns 0 for an empty transcript so the gauge stays hidden", () => {
    expect(estimateContextTokens([])).toBe(0);
  });
});
