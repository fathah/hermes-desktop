import { describe, expect, it } from "vitest";
import {
  dashboardChatEnabledForConnection,
  dashboardChatEnabledFromEnv,
  dashboardContinuationItemsFromTranscript,
  dashboardDataUrlForTextAttachment,
  completionFailed,
  dashboardPromptTextWithAttachmentRefs,
  dashboardShouldPersistLocalOverlays,
  ensureDashboardRuntimeSession,
  isDashboardSlashWorkerExitError,
  dashboardSeedMessagesFromTranscript,
  dashboardPromptTextForAttachments,
  dashboardModelCommand,
  dashboardModelMatches,
  resolveDashboardProviderForModel,
  syncDashboardAttachmentsForSubmit,
  submitDashboardPromptWithRecovery,
} from "../src/renderer/src/screens/Chat/hooks/useDashboardChatTransport";

describe("dashboardChatEnabledFromEnv", () => {
  it("defaults dashboard chat on", () => {
    expect(dashboardChatEnabledFromEnv(undefined)).toBe(true);
  });

  it("allows an explicit kill switch", () => {
    expect(dashboardChatEnabledFromEnv("0")).toBe(false);
    expect(dashboardChatEnabledFromEnv("false")).toBe(false);
    expect(dashboardChatEnabledFromEnv("FALSE")).toBe(false);
  });

  it("keeps existing explicit enable values enabled", () => {
    expect(dashboardChatEnabledFromEnv("1")).toBe(true);
  });
});

describe("completionFailed", () => {
  it("uses structured failure fields instead of matching normal answer text", () => {
    expect(
      completionFailed({
        text: "Error: This path does not exist. Here is how to fix it.",
      }),
    ).toBe(false);
    expect(
      completionFailed({
        rendered: "To troubleshoot an invalid API key, check your provider.",
      }),
    ).toBe(false);
    expect(
      completionFailed({ status: "failed", text: "Invalid API Key" }),
    ).toBe(true);
    expect(completionFailed({ error: "Invalid API Key" })).toBe(true);
    expect(completionFailed({ ok: false, text: "Invalid API Key" })).toBe(true);
    expect(
      completionFailed({ text: "Error: Error code: 401 - invalid key" }),
    ).toBe(true);
    expect(
      completionFailed({
        text: "API call failed after 3 retries: Connection error.",
      }),
    ).toBe(true);
  });
});

describe("dashboardChatEnabledForConnection", () => {
  it("enables dashboard chat only after confirming local mode", () => {
    expect(
      dashboardChatEnabledForConnection(undefined, true, "local", "auto"),
    ).toBe(true);
  });

  it("disables dashboard chat while connection mode is still loading", () => {
    expect(
      dashboardChatEnabledForConnection(undefined, false, "local", "auto"),
    ).toBe(false);
  });

  it("enables remote dashboard chat unless the user selected legacy", () => {
    expect(
      dashboardChatEnabledForConnection(undefined, true, "remote", "auto"),
    ).toBe(true);
    expect(
      dashboardChatEnabledForConnection(undefined, true, "remote", "dashboard"),
    ).toBe(true);
    expect(
      dashboardChatEnabledForConnection(undefined, true, "remote", "legacy"),
    ).toBe(false);
  });

  it("enables SSH dashboard chat unless the user selected legacy", () => {
    expect(
      dashboardChatEnabledForConnection(undefined, true, "ssh", "auto"),
    ).toBe(true);
    expect(
      dashboardChatEnabledForConnection(undefined, true, "ssh", "dashboard"),
    ).toBe(true);
    expect(
      dashboardChatEnabledForConnection(undefined, true, "ssh", "legacy"),
    ).toBe(false);
  });

  it("keeps the explicit kill switch authoritative in local mode", () => {
    expect(dashboardChatEnabledForConnection("0", true, "local", "auto")).toBe(
      false,
    );
    expect(
      dashboardChatEnabledForConnection("false", true, "local", "auto"),
    ).toBe(false);
  });
});

describe("dashboardShouldPersistLocalOverlays", () => {
  it("keeps dashboard recovery overlays for every dashboard-backed connection", () => {
    expect(dashboardShouldPersistLocalOverlays("local")).toBe(true);
    expect(dashboardShouldPersistLocalOverlays("remote")).toBe(true);
    expect(dashboardShouldPersistLocalOverlays("ssh")).toBe(true);
  });
});

describe("isDashboardSlashWorkerExitError", () => {
  it("detects the transient upstream slash worker failure", () => {
    expect(
      isDashboardSlashWorkerExitError(new Error("slash worker exited")),
    ).toBe(true);
    expect(
      isDashboardSlashWorkerExitError("Slash worker exited unexpectedly"),
    ).toBe(true);
    expect(isDashboardSlashWorkerExitError(new Error("invalid api key"))).toBe(
      false,
    );
  });
});

describe("dashboardModelCommand", () => {
  it("builds the upstream model switch command for explicit selections", () => {
    expect(dashboardModelCommand("xiaomi", "mimo-v2-pro")).toBe(
      "/model mimo-v2-pro --provider xiaomi",
    );
  });

  it("skips auto or incomplete selections", () => {
    expect(dashboardModelCommand("auto", "gemini-3.5-flash")).toBeNull();
    expect(dashboardModelCommand("google-gemini-cli", "")).toBeNull();
    expect(dashboardModelCommand(undefined, "mimo-v2-pro")).toBeNull();
  });
});

describe("dashboardPromptTextForAttachments", () => {
  it("allows image-only attachments on the dashboard path", () => {
    expect(
      dashboardPromptTextForAttachments("what is this?", [
        {
          id: "img-1",
          kind: "image",
          name: "duck.png",
          mime: "image/png",
          size: 3,
          dataUrl: "data:image/png;base64,AAA=",
        },
      ]),
    ).toBe("what is this?");
  });

  it("uses Hermes Agent's neutral image prompt for image-only sends", () => {
    expect(
      dashboardPromptTextForAttachments("", [
        {
          id: "img-1",
          kind: "image",
          name: "duck.png",
          mime: "image/png",
          size: 3,
          dataUrl: "data:image/png;base64,AAA=",
        },
      ]),
    ).toBe("What do you see in this image?");
  });

  it("allows text-file attachments on the dashboard path", () => {
    expect(
      dashboardPromptTextForAttachments("read this", [
        {
          id: "doc-1",
          kind: "text-file",
          name: "notes.txt",
          mime: "text/plain",
          size: 5,
          text: "hello",
        },
      ]),
    ).toBe("read this");
  });

  it("allows file-only sends so returned file refs become the prompt", () => {
    expect(
      dashboardPromptTextForAttachments("", [
        {
          id: "doc-1",
          kind: "text-file",
          name: "notes.txt",
          mime: "text/plain",
          size: 5,
          text: "hello",
        },
      ]),
    ).toBe("");
  });

  it("falls back when an image has no bytes to attach", () => {
    expect(
      dashboardPromptTextForAttachments("look", [
        {
          id: "img-1",
          kind: "image",
          name: "duck.png",
          mime: "image/png",
          size: 3,
        },
      ]),
    ).toBeNull();
  });
});

describe("dashboardModelMatches", () => {
  it("accepts an exact live model/provider match", () => {
    expect(
      dashboardModelMatches("deepseek", "deepseek-v4-pro", {
        provider: "deepseek",
        model: "deepseek-v4-pro",
      }),
    ).toBe(true);
  });

  it("accepts Hermes Agent custom provider slugs for Hermes One custom rows", () => {
    expect(
      dashboardModelMatches("custom", "deepseek-v4-pro", {
        provider: "custom:deepseek-v4-pro",
        model: "deepseek-v4-pro",
      }),
    ).toBe(true);
  });

  it("rejects stale live provider state after a failed provider turn", () => {
    expect(
      dashboardModelMatches("deepseek", "deepseek-v4-pro", {
        provider: "xiaomi",
        model: "mimo-v2-pro",
      }),
    ).toBe(false);
  });

  it("does not require a live model for auto mode", () => {
    expect(dashboardModelMatches("auto", "whatever", null)).toBe(true);
  });
});

describe("dashboard attachment sync", () => {
  it("encodes text-file attachments as data URLs for file.attach", () => {
    expect(
      dashboardDataUrlForTextAttachment({
        id: "doc-1",
        kind: "text-file",
        name: "notes.txt",
        mime: "text/plain",
        size: 5,
        text: "hello",
      }),
    ).toBe("data:text/plain;base64,aGVsbG8=");
  });

  it("composes returned file refs before the visible prompt", () => {
    expect(
      dashboardPromptTextWithAttachmentRefs("summarize this", [
        "@file:notes.txt",
      ]),
    ).toBe("@file:notes.txt\n\nsummarize this");
    expect(dashboardPromptTextWithAttachmentRefs("", ["@file:notes.txt"])).toBe(
      "@file:notes.txt",
    );
  });

  it("uses image.attach_bytes and file.attach for mixed attachments", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const client = {
      async request(method: string, params?: unknown): Promise<unknown> {
        calls.push({ method, params });
        if (method === "file.attach") {
          return { attached: true, ref_text: "@file:.hermes/notes.txt" };
        }
        return { attached: true };
      },
    };

    await expect(
      syncDashboardAttachmentsForSubmit(client, "live-1", [
        {
          id: "img-1",
          kind: "image",
          name: "duck.png",
          mime: "image/png",
          size: 3,
          dataUrl: "data:image/png;base64,AAA=",
        },
        {
          id: "doc-1",
          kind: "text-file",
          name: "notes.txt",
          mime: "text/plain",
          size: 5,
          text: "hello",
        },
      ]),
    ).resolves.toEqual({
      handled: true,
      refs: ["@file:.hermes/notes.txt"],
    });

    expect(calls).toEqual([
      {
        method: "image.attach_bytes",
        params: {
          session_id: "live-1",
          content_base64: "AAA=",
          filename: "duck.png",
        },
      },
      {
        method: "file.attach",
        params: {
          session_id: "live-1",
          name: "notes.txt",
          data_url: "data:text/plain;base64,aGVsbG8=",
        },
      },
    ]);
  });

  it("passes local path-ref attachments through file.attach", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const client = {
      async request(method: string, params?: unknown): Promise<unknown> {
        calls.push({ method, params });
        return { attached: true, ref_text: "@file:report.pdf" };
      },
    };

    await expect(
      syncDashboardAttachmentsForSubmit(client, "live-1", [
        {
          id: "doc-1",
          kind: "path-ref",
          name: "report.pdf",
          mime: "application/pdf",
          size: 42,
          path: "C:/tmp/report.pdf",
        },
      ]),
    ).resolves.toEqual({ handled: true, refs: ["@file:report.pdf"] });

    expect(calls).toEqual([
      {
        method: "file.attach",
        params: {
          session_id: "live-1",
          name: "report.pdf",
          path: "C:/tmp/report.pdf",
        },
      },
    ]);
  });

  it("returns unhandled when the dashboard lacks file.attach before anything attached", async () => {
    const client = {
      async request(): Promise<unknown> {
        throw new Error("unknown method file.attach");
      },
    };

    await expect(
      syncDashboardAttachmentsForSubmit(client, "live-1", [
        {
          id: "doc-1",
          kind: "text-file",
          name: "notes.txt",
          mime: "text/plain",
          size: 5,
          text: "hello",
        },
      ]),
    ).resolves.toEqual({ handled: false, refs: [] });
  });
});

describe("submitDashboardPromptWithRecovery", () => {
  it("resumes the stored session and retries once when the live session is gone", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const client = {
      async request(method: string, params?: unknown): Promise<unknown> {
        calls.push({ method, params });
        if (calls.length === 1) {
          throw new Error("session not found");
        }
        if (method === "session.resume") {
          return { session_id: "live-recovered" };
        }
        return {};
      },
    };
    let recovered = "";

    const result = await submitDashboardPromptWithRecovery(client, {
      sessionId: "live-stale",
      storedSessionId: "stored-1",
      text: "hello",
      onRecoveredSessionId: (sessionId) => {
        recovered = sessionId;
      },
    });

    expect(result).toBe("live-recovered");
    expect(recovered).toBe("live-recovered");
    expect(calls).toEqual([
      {
        method: "prompt.submit",
        params: { session_id: "live-stale", text: "hello" },
      },
      {
        method: "session.resume",
        params: { session_id: "stored-1" },
      },
      {
        method: "prompt.submit",
        params: { session_id: "live-recovered", text: "hello" },
      },
    ]);
  });

  it("does not recover unrelated submit errors", async () => {
    const client = {
      async request(): Promise<unknown> {
        throw new Error("invalid api key");
      },
    };

    await expect(
      submitDashboardPromptWithRecovery(client, {
        sessionId: "live-1",
        storedSessionId: "stored-1",
        text: "hello",
      }),
    ).rejects.toThrow("invalid api key");
  });
});

describe("ensureDashboardRuntimeSession", () => {
  it("resumes an existing stored session and preserves the durable id", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const client = {
      async request(method: string, params?: unknown): Promise<unknown> {
        calls.push({ method, params });
        return { session_id: "live-resumed", resumed: "stored-1" };
      },
    };

    await expect(
      ensureDashboardRuntimeSession({
        client,
        messages: [],
        profile: "work",
        storedSessionId: "stored-1",
      }),
    ).resolves.toEqual({
      created: false,
      runtimeSessionId: "live-resumed",
      storedSessionId: "stored-1",
    });
    expect(calls).toEqual([
      {
        method: "session.resume",
        params: { session_id: "stored-1", cols: 96, profile: "work" },
      },
    ]);
  });

  it("creates a seeded session when a stale stored id cannot be resumed", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const client = {
      async request(method: string, params?: unknown): Promise<unknown> {
        calls.push({ method, params });
        if (method === "session.resume") {
          throw new Error("session not found");
        }
        return { session_id: "live-created", stored_session_id: "stored-new" };
      },
    };

    await expect(
      ensureDashboardRuntimeSession({
        client,
        contextFolder: "C:/work",
        excludeSeedUserId: "u-active",
        messages: [
          { id: "u-old", role: "user", content: "old prompt" },
          { id: "a-old", role: "agent", content: "old answer" },
          { id: "u-active", role: "user", content: "current prompt" },
        ],
        storedSessionId: "missing-stored",
      }),
    ).resolves.toEqual({
      created: true,
      runtimeSessionId: "live-created",
      storedSessionId: "stored-new",
    });
    expect(calls).toEqual([
      {
        method: "session.resume",
        params: { session_id: "missing-stored", cols: 96 },
      },
      {
        method: "session.create",
        params: {
          cols: 96,
          cwd: "C:/work",
          messages: [
            { role: "user", content: "old prompt" },
            { role: "assistant", content: "old answer" },
          ],
        },
      },
    ]);
  });

  it("throws a clear error when resume returns no runtime session id", async () => {
    const client = {
      async request(): Promise<unknown> {
        return { resumed: "stored-1" };
      },
    };

    await expect(
      ensureDashboardRuntimeSession({
        client,
        messages: [],
        storedSessionId: "stored-1",
      }),
    ).rejects.toThrow("session.resume returned no session_id");
  });

  it("creates a seeded session without resuming when forceCreate is set", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const client = {
      async request(method: string, params?: unknown): Promise<unknown> {
        calls.push({ method, params });
        return { session_id: "live-created", stored_session_id: "stored-new" };
      },
    };

    await expect(
      ensureDashboardRuntimeSession({
        client,
        excludeSeedUserId: "u-active",
        forceCreate: true,
        messages: [
          { id: "u-good", role: "user", content: "good prompt" },
          { id: "a-good", role: "agent", content: "good answer" },
          { id: "u-bad", role: "user", content: "bad key prompt" },
          { id: "a-bad", role: "agent", content: "", error: "invalid key" },
          { id: "u-active", role: "user", content: "current prompt" },
        ],
        storedSessionId: "stored-1",
      }),
    ).resolves.toEqual({
      created: true,
      runtimeSessionId: "live-created",
      storedSessionId: "stored-new",
    });
    expect(calls).toEqual([
      {
        method: "session.create",
        params: {
          cols: 96,
          messages: [
            { role: "user", content: "good prompt" },
            { role: "assistant", content: "good answer" },
          ],
        },
      },
    ]);
  });

  it("does not create a replacement session for non-missing resume errors", async () => {
    const client = {
      async request(): Promise<unknown> {
        throw new Error("invalid api key");
      },
    };

    await expect(
      ensureDashboardRuntimeSession({
        client,
        messages: [],
        storedSessionId: "stored-1",
      }),
    ).rejects.toThrow("invalid api key");
  });
});

describe("resolveDashboardProviderForModel", () => {
  it("maps Hermes One custom rows on known built-in endpoints to dashboard built-in providers", () => {
    expect(
      resolveDashboardProviderForModel(
        "custom",
        "deepseek-v4-pro",
        "https://api.deepseek.com/v1/",
        {
          provider: "xiaomi",
          model: "gpt-5.5",
          providers: [
            {
              slug: "deepseek",
              name: "DeepSeek",
              models: ["deepseek-v4-flash", "deepseek-v4-pro"],
            },
          ],
        },
      ),
    ).toBe("deepseek");
  });

  it("does not map known built-in endpoints when the dashboard provider lacks the model", () => {
    expect(
      resolveDashboardProviderForModel(
        "custom",
        "not-a-deepseek-model",
        "https://api.deepseek.com/v1",
        {
          providers: [
            {
              slug: "deepseek",
              name: "DeepSeek",
              models: ["deepseek-v4-flash", "deepseek-v4-pro"],
            },
          ],
        },
      ),
    ).toBe("custom");
  });

  it("resolves Hermes One custom rows to dashboard custom provider slugs by base URL", () => {
    expect(
      resolveDashboardProviderForModel(
        "custom",
        "deepseek-v4-pro",
        "https://deepseek.example/v1/",
        {
          provider: "xiaomi",
          model: "gpt-5.5",
          providers: [
            {
              slug: "custom:deepseek-v4-pro",
              name: "DeepSeek V4 Pro",
              api_url: "https://deepseek.example/v1",
              models: ["deepseek-v4-pro"],
            },
          ],
        },
      ),
    ).toBe("custom:deepseek-v4-pro");
  });

  it("prefers the base URL match over another custom provider with the same model", () => {
    expect(
      resolveDashboardProviderForModel(
        "custom",
        "deepseek-v4-pro",
        "https://deepseek-good.example/v1",
        {
          providers: [
            {
              slug: "custom:wrong",
              api_url: "https://deepseek-bad.example/v1",
              models: ["deepseek-v4-pro"],
            },
            {
              slug: "custom:right",
              api_url: "https://deepseek-good.example/v1/",
              models: ["other-model"],
            },
          ],
        },
      ),
    ).toBe("custom:right");
  });

  it("falls back to a custom model match when no base URL is known", () => {
    expect(
      resolveDashboardProviderForModel("custom", "deepseek-v4-pro", "", {
        providers: [
          {
            slug: "custom:deepseek-v4-pro",
            models: ["deepseek-v4-pro"],
          },
        ],
      }),
    ).toBe("custom:deepseek-v4-pro");
  });

  it("leaves non-custom providers unchanged", () => {
    expect(
      resolveDashboardProviderForModel("xiaomi", "gpt-5.5", "", {
        providers: [{ slug: "custom:deepseek-v4-pro" }],
      }),
    ).toBe("xiaomi");
  });
});

describe("dashboardSeedMessagesFromTranscript", () => {
  it("seeds only canonical user and assistant bubbles", () => {
    expect(
      dashboardSeedMessagesFromTranscript([
        { id: "u-1", role: "user", content: " hello\nworld " },
        { id: "r-1", role: "agent", kind: "reasoning", text: "thinking" },
        { id: "a-1", role: "agent", content: " answer " },
        { id: "a-2", role: "agent", content: "local", localOnly: true },
        { id: "a-3", role: "agent", content: "", error: "boom" },
      ]),
    ).toEqual([
      { role: "user", content: "hello world" },
      { role: "assistant", content: "answer" },
    ]);
  });

  it("excludes the failed user turn before a local provider error", () => {
    expect(
      dashboardSeedMessagesFromTranscript([
        { id: "u-good", role: "user", content: "good prompt" },
        { id: "a-good", role: "agent", content: "good answer" },
        { id: "u-bad", role: "user", content: "bad key prompt" },
        { id: "a-bad", role: "agent", content: "", error: "invalid key" },
      ]),
    ).toEqual([
      { role: "user", content: "good prompt" },
      { role: "assistant", content: "good answer" },
    ]);
  });

  it("excludes the active submitted user from replacement-session seeds", () => {
    expect(
      dashboardSeedMessagesFromTranscript(
        [
          { id: "u-good", role: "user", content: "good prompt" },
          { id: "a-good", role: "agent", content: "good answer" },
          {
            id: "u-recovery",
            role: "user",
            content:
              "recovery prompt that should be persisted by prompt.submit",
          },
        ],
        { excludeUserId: "u-recovery" },
      ),
    ).toEqual([
      { role: "user", content: "good prompt" },
      { role: "assistant", content: "good answer" },
    ]);
  });
});

describe("dashboardContinuationItemsFromTranscript", () => {
  it("captures the full visible prefix before a recovery prompt", () => {
    expect(
      dashboardContinuationItemsFromTranscript(
        [
          { id: "u-good", role: "user", content: "good prompt" },
          { id: "a-good", role: "agent", content: "good answer" },
          { id: "u-bad", role: "user", content: "bad provider turn" },
          {
            id: "error-bad",
            role: "agent",
            content: "",
            error: "Invalid API Key",
            localOnly: true,
          },
          {
            id: "u-recovery",
            role: "user",
            content: "recovery prompt persisted by the new session",
          },
        ],
        { excludeUserId: "u-recovery" },
      ),
    ).toEqual([
      { kind: "user", content: "good prompt" },
      { kind: "assistant", content: "good answer" },
      { kind: "user", content: "bad provider turn" },
      { kind: "assistant", content: "", error: "Invalid API Key" },
    ]);
  });

  it("keeps reasoning and tool artifacts from earlier visible semi-sessions", () => {
    expect(
      dashboardContinuationItemsFromTranscript([
        { id: "u-1", role: "user", content: "make a file" },
        { id: "r-1", role: "agent", kind: "reasoning", text: "Need a tool." },
        {
          id: "tc-1",
          role: "agent",
          kind: "tool_call",
          callId: "call-1",
          name: "write_file",
          args: '{"path":"x.txt"}',
        },
        {
          id: "tr-1",
          role: "agent",
          kind: "tool_result",
          callId: "call-1",
          name: "write_file",
          content: "wrote x.txt",
        },
        { id: "a-1", role: "agent", content: "done" },
      ]),
    ).toEqual([
      { kind: "user", content: "make a file" },
      { kind: "reasoning", text: "Need a tool." },
      {
        kind: "tool_call",
        callId: "call-1",
        name: "write_file",
        args: '{"path":"x.txt"}',
      },
      {
        kind: "tool_result",
        callId: "call-1",
        name: "write_file",
        content: "wrote x.txt",
      },
      { kind: "assistant", content: "done" },
    ]);
  });

  it("keeps image attachments in recovered visible prefixes", () => {
    expect(
      dashboardContinuationItemsFromTranscript(
        [
          {
            id: "u-image",
            role: "user",
            content: "what is this?",
            attachments: [
              {
                id: "img-1",
                kind: "image",
                name: "duck.png",
                mime: "image/png",
                size: 3,
                dataUrl: "data:image/png;base64,AAA=",
              },
            ],
          },
          { id: "a-image", role: "agent", content: "A yellow duck." },
          { id: "u-active", role: "user", content: "continue" },
        ],
        { excludeUserId: "u-active" },
      ),
    ).toEqual([
      {
        kind: "user",
        content: "what is this?",
        attachments: [
          {
            id: "img-1",
            kind: "image",
            name: "duck.png",
            mime: "image/png",
            size: 3,
            dataUrl: "data:image/png;base64,AAA=",
          },
        ],
      },
      { kind: "assistant", content: "A yellow duck." },
    ]);
  });
});
