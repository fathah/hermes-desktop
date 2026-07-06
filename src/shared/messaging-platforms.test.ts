import { describe, expect, it } from "vitest";
import {
  buildMessagingPlatforms,
  MESSAGING_PLATFORM_CATALOG,
  redactValue,
  testMessagingPlatformStatus,
  validateMessagingPlatformUpdate,
} from "./messaging-platforms";

describe("messaging platform catalog", () => {
  it("points platform docs to Hermes Agent setup docs", () => {
    const expectedSlugs: Record<string, string> = {
      api_server: "open-webui",
      bluebubbles: "bluebubbles",
      dingtalk: "dingtalk",
      discord: "discord",
      email: "email",
      feishu: "feishu",
      homeassistant: "homeassistant",
      matrix: "matrix",
      mattermost: "mattermost",
      qqbot: "qqbot",
      signal: "signal",
      slack: "slack",
      sms: "sms",
      telegram: "telegram",
      wecom: "wecom",
      wecom_callback: "wecom-callback",
      webhook: "webhooks",
      weixin: "weixin",
      whatsapp: "whatsapp",
      yuanbao: "yuanbao",
    };

    for (const platform of MESSAGING_PLATFORM_CATALOG) {
      expect(platform.docs_url).toBe(
        `https://hermes-agent.nousresearch.com/docs/user-guide/messaging/${
          expectedSlugs[platform.id]
        }/`,
      );
    }
  });

  it("redacts configured secret values without exposing the full value", () => {
    expect(redactValue("telegram-secret-token")).toBe("tel••••ken");
    expect(redactValue("short")).toBe("••••");
  });

  it("marks a first-class platform configured only when required env is present", () => {
    const response = buildMessagingPlatforms(
      { TELEGRAM_BOT_TOKEN: "123:abc" },
      { telegram: true },
      false,
    );
    const telegram = response.platforms.find(
      (platform) => platform.id === "telegram",
    );
    expect(telegram?.configured).toBe(true);
    expect(telegram?.state).toBe("gateway_stopped");
    expect(
      telegram?.env_vars.find((field) => field.key === "TELEGRAM_BOT_TOKEN")
        ?.redacted_value,
    ).toBe("123••••abc");
  });

  it("marks configured running platforms as configured rather than restart-needed", () => {
    const response = buildMessagingPlatforms(
      { TELEGRAM_BOT_TOKEN: "123:abc" },
      { telegram: true },
      true,
    );
    const telegram = response.platforms.find(
      (platform) => platform.id === "telegram",
    );
    expect(telegram?.state).toBe("configured");

    const result = testMessagingPlatformStatus(telegram!);
    expect(result.message).toContain("Desktop can verify the config");
    expect(result.message).not.toContain("Restart");
  });

  it("uses runtime gateway platform state when it is available", () => {
    const response = buildMessagingPlatforms(
      { TELEGRAM_BOT_TOKEN: "123:abc" },
      { telegram: true },
      true,
      {},
      {
        telegram: {
          state: "connected",
          updated_at: "2026-06-03T11:43:05.691429+00:00",
        },
      },
    );
    const telegram = response.platforms.find(
      (platform) => platform.id === "telegram",
    );
    expect(telegram?.state).toBe("connected");
    expect(telegram?.updated_at).toBe("2026-06-03T11:43:05.691429+00:00");
    expect(testMessagingPlatformStatus(telegram!).ok).toBe(true);
  });

  it("preserves legacy Desktop env names as configured for older setups", () => {
    const response = buildMessagingPlatforms(
      {
        DINGTALK_APP_KEY: "old-key",
        DINGTALK_APP_SECRET: "old-secret",
        EMAIL_ADDRESS: "hermes@example.com",
        EMAIL_PASSWORD: "app-password",
        EMAIL_IMAP_SERVER: "imap.example.com",
        EMAIL_SMTP_SERVER: "smtp.example.com",
      },
      { dingtalk: true, email: true },
      false,
    );
    expect(
      response.platforms.find((platform) => platform.id === "dingtalk")
        ?.configured,
    ).toBe(true);
    expect(
      response.platforms.find((platform) => platform.id === "email")
        ?.configured,
    ).toBe(true);
  });

  it("rejects updates to env keys outside the selected platform", () => {
    expect(() =>
      validateMessagingPlatformUpdate("telegram", {
        env: { DISCORD_BOT_TOKEN: "wrong-platform" },
      }),
    ).toThrow("DISCORD_BOT_TOKEN is not configurable for Telegram");
  });

  it("returns actionable setup messages for incomplete platforms", () => {
    const response = buildMessagingPlatforms({}, { telegram: true }, true);
    const telegram = response.platforms.find(
      (platform) => platform.id === "telegram",
    );
    expect(telegram).toBeTruthy();
    const result = testMessagingPlatformStatus(telegram!);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("TELEGRAM_BOT_TOKEN");
  });

  it("surfaces per-platform toolsets with explicit high-risk markers", () => {
    const response = buildMessagingPlatforms({}, { telegram: true }, false, {
      telegram: ["browser", "terminal"],
    });
    const telegram = response.platforms.find(
      (platform) => platform.id === "telegram",
    );
    expect(
      telegram?.toolsets.find((toolset) => toolset.key === "browser")?.enabled,
    ).toBe(true);
    expect(
      telegram?.toolsets.find((toolset) => toolset.key === "web")?.enabled,
    ).toBe(false);
    expect(
      telegram?.toolsets.find((toolset) => toolset.key === "terminal")?.risk,
    ).toBe("high");
  });

  it("rejects unknown messaging toolset updates", () => {
    expect(() =>
      validateMessagingPlatformUpdate("telegram", {
        toolsets: { root_shell: true },
      }),
    ).toThrow("root_shell is not a supported messaging toolset");
  });
});
