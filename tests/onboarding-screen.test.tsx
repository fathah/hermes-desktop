// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import Onboarding from "../src/renderer/src/screens/Onboarding/Onboarding";

// i18n: return the key so assertions are locale-independent.
vi.mock("../src/renderer/src/components/useI18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

type ModelCfg = { provider: string; model: string; baseUrl: string };

function mockApi(opts: { hasApiKey: boolean; model: string }): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    checkInstall: vi.fn().mockResolvedValue({
      installed: true,
      configured: true,
      hasApiKey: opts.hasApiKey,
      verified: true,
    }),
    getModelConfig: vi.fn().mockResolvedValue({
      provider: "auto",
      model: opts.model,
      baseUrl: "",
    } satisfies ModelCfg),
  };
}

afterEach(cleanup);
beforeEach(() => {
  (window as unknown as { electron?: unknown }).electron = {
    process: { platform: "darwin" },
  };
});

describe("<Onboarding>", () => {
  it("orients every user — title, three action cards, and a CTA", async () => {
    mockApi({ hasApiKey: true, model: "gpt-4" });
    const onFinish = vi.fn();
    render(
      <Onboarding
        connectionMode="local"
        onFinish={onFinish}
        onConfigure={vi.fn()}
      />,
    );
    expect(screen.getByText("onboarding.title")).toBeTruthy();
    expect(screen.getByText("onboarding.orientChatTitle")).toBeTruthy();
    expect(screen.getByText("onboarding.orientDocTitle")).toBeTruthy();
    expect(screen.getByText("onboarding.orientSettingsTitle")).toBeTruthy();

    fireEvent.click(screen.getByText("onboarding.enterWorkspace"));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("local + missing config: shows actionable checklist items that deep-link", async () => {
    mockApi({ hasApiKey: false, model: "" });
    const onConfigure = vi.fn();
    render(
      <Onboarding
        connectionMode="local"
        onFinish={vi.fn()}
        onConfigure={onConfigure}
      />,
    );

    // Checklist renders once the async status read resolves.
    await waitFor(() =>
      expect(screen.getByText("onboarding.apiKeyLabel")).toBeTruthy(),
    );
    expect(screen.getByText("onboarding.modelLabel")).toBeTruthy();

    fireEvent.click(screen.getByText("onboarding.apiKeyAction"));
    expect(onConfigure).toHaveBeenCalledWith("providers");

    fireEvent.click(screen.getByText("onboarding.modelAction"));
    expect(onConfigure).toHaveBeenCalledWith("models");
  });

  it("local + configured: shows done state and the ready message, no actions", async () => {
    mockApi({ hasApiKey: true, model: "claude-opus" });
    render(
      <Onboarding
        connectionMode="local"
        onFinish={vi.fn()}
        onConfigure={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("onboarding.apiKeyDone")).toBeTruthy(),
    );
    expect(screen.getByText("onboarding.modelDone")).toBeTruthy();
    expect(screen.getByText("onboarding.ready")).toBeTruthy();
    expect(screen.queryByText("onboarding.apiKeyAction")).toBeNull();
    expect(screen.queryByText("onboarding.modelAction")).toBeNull();
  });

  it("remote mode: orientation only — no config checklist (config lives remotely)", async () => {
    mockApi({ hasApiKey: false, model: "" });
    render(
      <Onboarding
        connectionMode="remote"
        onFinish={vi.fn()}
        onConfigure={vi.fn()}
      />,
    );
    expect(screen.getByText("onboarding.title")).toBeTruthy();
    // No checklist items in remote mode.
    expect(screen.queryByText("onboarding.apiKeyLabel")).toBeNull();
    expect(screen.queryByText("onboarding.checklistTitle")).toBeNull();
    expect(screen.getByText("onboarding.enterWorkspace")).toBeTruthy();
  });
});
