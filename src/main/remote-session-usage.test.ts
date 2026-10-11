import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "./config";

const request = vi.hoisted(() => vi.fn());
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson: request }));

import {
  beginProviderAuthChange,
  finishProviderAuthChange,
} from "./provider-request-target";
import { remoteGetSessionUsage } from "./remote-session-usage";

const conn = { mode: "remote", remoteUrl: "http://r:9119" } as ConnectionConfig;

describe("remoteGetSessionUsage", () => {
  beforeEach(() => {
    request.mockReset();
  });

  it("maps the session row's token, cache and cost totals", async () => {
    request.mockResolvedValue({
      input_tokens: 1200,
      output_tokens: 300,
      cache_read_tokens: 50,
      cache_write_tokens: 0,
      estimated_cost_usd: 0.02,
    });
    expect(await remoteGetSessionUsage(conn, "s/1", "work")).toEqual({
      promptTokens: 1200,
      completionTokens: 300,
      totalTokens: 1500,
      cost: 0.02,
      cacheReadTokens: 50,
    });
    expect(request).toHaveBeenCalledWith(
      conn,
      "/api/sessions/s%2F1",
      {},
      "work",
    );
  });

  it("prefers the actual cost over the estimate", async () => {
    request.mockResolvedValue({
      input_tokens: 1,
      output_tokens: 1,
      actual_cost_usd: 0.5,
      estimated_cost_usd: 0.9,
    });
    expect((await remoteGetSessionUsage(conn, "s"))?.cost).toBe(0.5);
  });

  it("returns null for an unused session, a failed call or an empty id", async () => {
    request.mockResolvedValue({ input_tokens: 0, output_tokens: 0 });
    expect(await remoteGetSessionUsage(conn, "s")).toBeNull();
    request.mockImplementation(async () => {
      throw Object.assign(new Error("404"), { statusCode: 404 });
    });
    expect(await remoteGetSessionUsage(conn, "s")).toBeNull();
    request.mockClear();
    expect(await remoteGetSessionUsage(conn, "")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});

// @lat: [[model-context#Tests#Usage metadata keeps account ownership]]
it("captures the request target and discards a reply after its account revision changes", async () => {
  const selected = {
    ...conn,
    remoteUrl: "https://usage-owner.test",
    remoteToken: "first",
  };
  let resolve!: (row: Record<string, unknown>) => void;
  request.mockImplementation(
    () =>
      new Promise<Record<string, unknown>>((done) => {
        resolve = done;
      }),
  );
  const pending = remoteGetSessionUsage(selected, "owned-session", "work");
  const captured = request.mock.calls.at(-1)?.[0];
  selected.remoteUrl = "https://other.test";
  selected.remoteToken = "second";
  expect(captured).toMatchObject({
    remoteUrl: "https://usage-owner.test",
    remoteToken: "first",
  });
  beginProviderAuthChange("https://usage-owner.test");
  finishProviderAuthChange("https://usage-owner.test");
  resolve({ input_tokens: 99, output_tokens: 9 });
  expect(await pending).toBeNull();
});
