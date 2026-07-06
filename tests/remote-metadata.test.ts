import http from "http";
import { afterEach, describe, expect, it } from "vitest";
import {
  remoteGetHermesHome,
  remoteGetHermesVersion,
} from "../src/main/remote-metadata";

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

describe("remote Hermes metadata", () => {
  it("reads version, release date, and home from the dashboard status endpoint", async () => {
    const { url } = await startServer((req, res) => {
      expect(req.url).toBe("/api/status");
      expect(req.headers["x-hermes-session-token"]).toBe("token");
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          version: "0.16.0",
          release_date: "2026.6.5",
          hermes_home: "/opt/data",
          config_path: "/opt/data/config.yaml",
          python_version: "3.11.15",
          openai_sdk_version: "2.24.0",
        }),
      );
    });

    await expect(
      remoteGetHermesHome({ remoteUrl: url, apiKey: "token" }),
    ).resolves.toBe("/opt/data");
    await expect(
      remoteGetHermesVersion({ remoteUrl: url, apiKey: "token" }),
    ).resolves.toContain("Hermes Agent v0.16.0 (2026.6.5)");
  });
});
