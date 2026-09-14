import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isReady: () => true },
  BrowserWindow: class {},
  net: { request: vi.fn() },
  session: { fromPartition: vi.fn() },
}));

import { probeRemoteAuthMode } from "../src/main/remote-oauth";

describe("remote authentication mode detection", () => {
  it("detects OAuth from the public dashboard status", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ auth_required: true, version: "0.9.0" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );

    await expect(
      probeRemoteAuthMode("https://hermes.example/v1", fetchImpl),
    ).resolves.toEqual({ authMode: "oauth", version: "0.9.0" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://hermes.example/api/status",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("detects token mode when the status is public and ungated", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ auth_required: false }), { status: 200 }),
    );

    await expect(
      probeRemoteAuthMode("http://127.0.0.1:9119", fetchImpl),
    ).resolves.toEqual({ authMode: "token", version: null });
  });

  it("falls back to raw gateway health when dashboard status is unsupported", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok", version: "0.8.0" }), {
          status: 200,
        }),
      );

    await expect(
      probeRemoteAuthMode("http://127.0.0.1:8642/v1", fetchImpl, "server-key"),
    ).resolves.toEqual({ authMode: "token", version: "0.8.0" });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8642/health",
      expect.objectContaining({
        headers: { Authorization: "Bearer server-key" },
      }),
    );
  });

  it("classifies an authenticated raw health endpoint as token mode", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

    await expect(
      probeRemoteAuthMode("http://127.0.0.1:8642", fetchImpl),
    ).resolves.toEqual({ authMode: "token", version: null });
  });

  it("rejects unreachable or malformed status responses", async () => {
    const rejected = vi.fn(async () => new Response("no", { status: 503 }));
    await expect(
      probeRemoteAuthMode("https://hermes.example", rejected),
    ).rejects.toThrow(/503/);

    const malformed = vi.fn(
      async () => new Response("not json", { status: 200 }),
    );
    await expect(
      probeRemoteAuthMode("https://hermes.example", malformed),
    ).rejects.toThrow(/status/i);
  });
});
