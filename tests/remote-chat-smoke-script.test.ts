import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("remote chat smoke script", () => {
  it("covers the built Electron remote chat fallback proof anchors", () => {
    const source = readFileSync("scripts/remote-chat-smoke.mjs", "utf8");

    for (const anchor of [
      "REMOTE_CHAT_SMOKE_OK",
      "REMOTE_CHAT_SMOKE_PASS",
      "SEAM_AUDIT",
      "fallback-v1-405-to-api",
      'connectionMode: "remote"',
      "remoteUrl: GATEWAY_URL",
      "/v1/chat/completions",
      "/api/chat/completions",
      "text/event-stream",
      "onChatChunk",
      "onChatDone",
      "onChatError",
      "remote auth header was passed through",
    ]) {
      expect(source).toContain(anchor);
    }
  });
});
