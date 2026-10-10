import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());

vi.mock("./config", () => ({
  getConnectionConfig: () => ({ mode: "remote", remoteUrl: "http://r:9119" }),
}));
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson: request }));

import {
  resetRemoteProvidersState,
  isShownRedactedPreview,
  remoteAddCredentialPoolEntry,
  remoteGetCredentialPool,
  remoteGetEnv,
  remoteSetCredentialPool,
  remoteSetEnv,
} from "./remote-providers";

const POOL = {
  providers: [
    {
      provider: "openai",
      entries: [
        { index: 1, id: "a1", label: "one", token_preview: "sk-a…1111" },
        { index: 2, id: "b2", label: "two", token_preview: "sk-b…2222" },
      ],
    },
  ],
};

describe("remote providers env", () => {
  beforeEach(() => {
    request.mockReset();
    resetRemoteProvidersState();
  });

  it("returns only set keys, as redacted previews", async () => {
    request.mockResolvedValue({
      OPENAI_API_KEY: { is_set: true, redacted_value: "sk-…abcd" },
      GROQ_API_KEY: { is_set: false, redacted_value: "" },
    });
    expect(await remoteGetEnv()).toEqual({ OPENAI_API_KEY: "sk-…abcd" });
  });

  it("does not write an untouched redacted preview back", async () => {
    request.mockResolvedValue({
      OPENAI_API_KEY: { is_set: true, redacted_value: "sk-…abcd" },
    });
    await remoteGetEnv();
    request.mockClear();
    await remoteSetEnv("OPENAI_API_KEY", "sk-…abcd");
    expect(request).not.toHaveBeenCalled();
  });

  it("recognises a redacted preview it handed out, so it is never used as a key", async () => {
    request.mockResolvedValue({
      OPENAI_API_KEY: { is_set: true, redacted_value: "sk-…abcd" },
    });
    expect(isShownRedactedPreview("sk-…abcd")).toBe(false);
    await remoteGetEnv();
    expect(isShownRedactedPreview("sk-…abcd")).toBe(true);
    expect(isShownRedactedPreview("sk-real-looking-key")).toBe(false);
    expect(isShownRedactedPreview(undefined)).toBe(false);
  });

  it("PUTs a new value and DELETEs an empty one", async () => {
    request.mockResolvedValue({});
    await remoteSetEnv("OPENAI_API_KEY", "sk-new");
    await remoteSetEnv("OPENAI_API_KEY", "");
    expect(request.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [
        "/api/env",
        { method: "PUT", body: { key: "OPENAI_API_KEY", value: "sk-new" } },
      ],
      ["/api/env", { method: "DELETE", body: { key: "OPENAI_API_KEY" } }],
    ]);
  });

  it("treats deleting an unset key as success", async () => {
    request.mockImplementation(async () => {
      throw Object.assign(new Error("404"), { statusCode: 404 });
    });
    expect(await remoteSetEnv("NOPE_API_KEY", "")).toBe(true);
  });
});

describe("remote credential pool", () => {
  beforeEach(() => {
    request.mockReset();
    resetRemoteProvidersState();
  });

  it("maps server entries to the local shape with the redacted preview", async () => {
    request.mockResolvedValue(POOL);
    const pool = await remoteGetCredentialPool();
    expect(pool.openai[0]).toMatchObject({
      id: "a1",
      label: "one",
      access_token: "sk-a…1111",
    });
  });

  it("adds an entry and returns the refreshed list", async () => {
    request.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(POOL);
    const entries = await remoteAddCredentialPoolEntry("openai", "sk-x", "k");
    expect(request.mock.calls[0][1]).toBe("/api/credentials/pool");
    expect(request.mock.calls[0][2]).toEqual({
      method: "POST",
      body: { provider: "openai", api_key: "sk-x", label: "k" },
    });
    expect(entries).toHaveLength(2);
  });

  it("deletes the entry the user removed, found by id in a fresh server list", async () => {
    request.mockResolvedValueOnce(POOL); // what the screen was shown
    await remoteGetCredentialPool();
    request.mockClear();
    request.mockResolvedValueOnce(POOL).mockResolvedValueOnce({ ok: true });
    await remoteSetCredentialPool("openai", [{ id: "a1" }]);
    expect(request.mock.calls[1][1]).toBe("/api/credentials/pool/openai/2");
    expect(request.mock.calls[1][2]).toEqual({ method: "DELETE" });
  });

  it("refuses when the credential the user removed was replaced on the server meanwhile", async () => {
    request.mockResolvedValueOnce(POOL);
    await remoteGetCredentialPool(); // screen shows [a1, b2]
    request.mockClear();
    // Another client replaced b2 with c3: the fresh list is [a1, c3].
    request.mockResolvedValueOnce({
      providers: [
        {
          provider: "openai",
          entries: [
            { index: 1, id: "a1" },
            { index: 2, id: "c3" },
          ],
        },
      ],
    });
    await expect(
      remoteSetCredentialPool("openai", [{ id: "a1" }]),
    ).rejects.toThrow(/no longer exists/);
    // Only the list was read; nothing was deleted.
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("refuses to delete before the list was ever loaded", async () => {
    await expect(
      remoteSetCredentialPool("anthropic", [{ id: "x" }]),
    ).rejects.toThrow(/not loaded/);
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses to delete more than one credential in a single call", async () => {
    request.mockResolvedValueOnce(POOL);
    await remoteGetCredentialPool();
    request.mockClear();
    await expect(remoteSetCredentialPool("openai", [])).rejects.toThrow(
      /multiple/,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps each profile's pool separate and sends the profile to the server", async () => {
    request.mockResolvedValue(POOL);
    await remoteGetCredentialPool("work");
    expect(request.mock.calls[0][1]).toBe("/api/credentials/pool?profile=work");
    request.mockClear();
    // 'default' was never loaded, so removal there is refused even though
    // 'work' showed the same ids.
    await expect(
      remoteSetCredentialPool("openai", [{ id: "a1" }]),
    ).rejects.toThrow(/not loaded/);
  });
});
