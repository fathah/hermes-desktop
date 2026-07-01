import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gatewayFetch, providerFetch, publicFetch } from "./network-policy";
import { safeFetch } from "./ssrf-guard";

vi.mock("./ssrf-guard", () => ({
  safeFetch: vi.fn(),
}));

const mockSafeFetch = vi.mocked(safeFetch);

describe("network policy fetch helpers", () => {
  const rawFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", rawFetch);
    mockSafeFetch.mockReset();
    rawFetch.mockReset();
    mockSafeFetch.mockResolvedValue(
      new Response("safe") as unknown as Awaited<ReturnType<typeof safeFetch>>,
    );
    rawFetch.mockResolvedValue(new Response("raw"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes publicFetch through the SSRF-pinned safeFetch helper", async () => {
    const init = { headers: { Accept: "application/json" } };

    await publicFetch("https://example.com/feed.xml", init);

    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://example.com/feed.xml",
      init,
    );
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("routes providerFetch for public endpoints through safeFetch", async () => {
    await providerFetch("https://api.example.com/v1/models");

    expect(mockSafeFetch).toHaveBeenCalledWith(
      "https://api.example.com/v1/models",
      undefined,
    );
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("allows explicit localhost provider endpoints without safeFetch", async () => {
    await providerFetch("http://127.0.0.1:1234/v1/models");

    expect(rawFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:1234/v1/models",
      undefined,
    );
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("allows explicit private LAN provider endpoints without safeFetch", async () => {
    await providerFetch("http://192.168.1.20:11434/api/tags");

    expect(rawFetch).toHaveBeenCalledWith(
      "http://192.168.1.20:11434/api/tags",
      undefined,
    );
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("treats gatewayFetch like providerFetch for local gateway compatibility", async () => {
    await gatewayFetch("http://localhost:8642/v1/chat/completions", {
      method: "POST",
    });

    expect(rawFetch).toHaveBeenCalledWith(
      "http://localhost:8642/v1/chat/completions",
      { method: "POST" },
    );
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });
});
