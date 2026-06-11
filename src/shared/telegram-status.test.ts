import { describe, it, expect } from "vitest";
import { deriveTelegramStatus } from "./telegram-status";

describe("deriveTelegramStatus", () => {
  it("reports not-configured when no token is present", () => {
    const status = deriveTelegramStatus({
      tokenPresent: false,
      gatewayRunning: false,
      getMe: null,
    });
    expect(status).toEqual({ state: "not-configured" });
  });

  it("reports not-configured even if the gateway happens to be running", () => {
    const status = deriveTelegramStatus({
      tokenPresent: false,
      gatewayRunning: true,
      getMe: { ok: true, username: "leftover_bot" },
    });
    expect(status.state).toBe("not-configured");
  });

  it("reports invalid-token when the getMe probe was rejected", () => {
    const status = deriveTelegramStatus({
      tokenPresent: true,
      gatewayRunning: true,
      getMe: { ok: false, kind: "invalid-token", message: "rejected" },
    });
    expect(status).toEqual({ state: "invalid-token", message: "rejected" });
  });

  it("reports unreachable when the probe could not reach Telegram", () => {
    const status = deriveTelegramStatus({
      tokenPresent: true,
      gatewayRunning: true,
      getMe: { ok: false, kind: "unreachable", message: "timed out" },
    });
    expect(status).toEqual({ state: "unreachable", message: "timed out" });
  });

  it("reports unreachable (not active) when a token exists but no probe ran", () => {
    const status = deriveTelegramStatus({
      tokenPresent: true,
      gatewayRunning: true,
      getMe: null,
    });
    expect(status.state).toBe("unreachable");
  });

  it("reports gateway-stopped when the token is valid but the gateway is down", () => {
    const status = deriveTelegramStatus({
      tokenPresent: true,
      gatewayRunning: false,
      getMe: { ok: true, username: "my_bot" },
    });
    expect(status).toEqual({ state: "gateway-stopped", botUsername: "my_bot" });
  });

  it("reports active with the bot username when token is valid and gateway runs", () => {
    const status = deriveTelegramStatus({
      tokenPresent: true,
      gatewayRunning: true,
      getMe: { ok: true, username: "my_bot" },
    });
    expect(status).toEqual({ state: "active", botUsername: "my_bot" });
  });

  it("prioritises an invalid token over the gateway state", () => {
    const status = deriveTelegramStatus({
      tokenPresent: true,
      gatewayRunning: false,
      getMe: { ok: false, kind: "invalid-token", message: "401" },
    });
    expect(status.state).toBe("invalid-token");
  });
});
