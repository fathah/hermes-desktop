import http from "http";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeRemoteOAuthProviderStatuses,
  remoteGetOAuthProviderStatuses,
} from "../src/main/remote-provider-statuses";

let server: http.Server | null = null;

function startServer(handler: http.RequestListener): Promise<{ url: string }> {
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      if (!address || typeof address === "string") {
        throw new Error("Unexpected server address");
      }
      resolve({ url: `http://127.0.0.1:${address.port}` });
    });
  });
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

describe("remote OAuth provider statuses", () => {
  // @lat: [[provider-setup#Provider setup#Active model is picked from configured providers#Authenticated OAuth providers are selectable#Connection-specific credential source]]
  it("reads the scoped remote dashboard and returns booleans only", async () => {
    const { url } = await startServer((req, res) => {
      expect(req.url).toBe("/api/providers/oauth?profile=research");
      expect(req.headers["x-hermes-session-token"]).toBe("session-token");
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          providers: [
            {
              id: "openai-codex",
              status: {
                logged_in: true,
                token_preview: "must-not-cross-the-preload-boundary",
              },
            },
            { id: "nous", status: { logged_in: false } },
            { id: "unsupported", status: { logged_in: true } },
          ],
        }),
      );
    });

    await expect(
      remoteGetOAuthProviderStatuses(
        { remoteUrl: url, apiKey: "session-token", profile: "research" },
        ["openai-codex", "nous"],
      ),
    ).resolves.toEqual({ "openai-codex": true, nous: false });
  });

  it("uses the direct Remote dashboard authentication boundary", async () => {
    const { url } = await startServer((req, res) => {
      expect(req.url).toBe("/api/providers/oauth?profile=research");
      expect(req.headers["x-hermes-session-token"]).toBe("remote-token");
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          providers: [{ id: "qwen-oauth", status: { logged_in: true } }],
        }),
      );
    });

    await expect(
      remoteGetOAuthProviderStatuses(
        {
          mode: "remote",
          remoteUrl: url,
          apiKey: "remote-token",
          remoteAuthMode: "token",
          remoteChatTransport: "dashboard",
          sshChatTransport: "auto",
          ssh: {
            host: "",
            port: 22,
            username: "",
            keyPath: "",
            remotePort: 8642,
            localPort: 8642,
          },
        },
        ["qwen-oauth", "openai-codex"],
        "research",
      ),
    ).resolves.toEqual({ "qwen-oauth": true, "openai-codex": false });
  });

  it("fails closed for missing or malformed supported provider rows", () => {
    expect(
      normalizeRemoteOAuthProviderStatuses(
        {
          providers: [
            { id: "openai-codex", status: { logged_in: "yes" } },
            { id: "nous", status: null },
          ],
        },
        ["openai-codex", "nous", "qwen-oauth"],
      ),
    ).toEqual({
      "openai-codex": false,
      nous: false,
      "qwen-oauth": false,
    });
  });
});
