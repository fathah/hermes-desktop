import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../components/common/BrandLogo", () => ({ default: () => null }));
vi.mock("../../components/OAuthLoginModal", () => ({ default: () => null }));
vi.mock("../../components/HermesAccountModal", () => ({ default: () => null }));
vi.mock("../../components/RegistryBrowserModal", () => ({
  default: () => null,
}));
vi.mock("../../components/AuxiliaryTasksSection", () => ({
  default: () => null,
}));
vi.mock("../../components/ProviderKeysSection", () => ({
  default: ({
    onChange,
  }: {
    onChange: (key: string, value: string) => void;
  }) => (
    <button onClick={() => onChange("OPENAI_API_KEY", "desktop-draft")}>
      Type local draft
    </button>
  ),
}));
import Providers from "./Providers";
const callbacks = new Set<() => void>();
beforeEach(() => {
  callbacks.clear();
  vi.useFakeTimers();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getAccount: vi.fn().mockResolvedValue(null),
      getEnv: vi.fn().mockResolvedValue({}),
      getModelConfig: vi
        .fn()
        .mockResolvedValue({ provider: "auto", model: "", baseUrl: "" }),
      getCredentialPool: vi.fn().mockResolvedValue({}),
      setEnv: vi.fn().mockResolvedValue(true),
      discoverProviderModels: vi.fn().mockResolvedValue({
        models: [],
        status: "unsupported",
        cached: false,
      }),
      onConnectionConfigChanged: vi.fn((callback: () => void) => {
        callbacks.add(callback);
        return () => {
          callbacks.delete(callback);
        };
      }),
    },
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// @lat: [[remote-providers#Remote Providers#Local drafts do not flush into Remote]]
it("cancels a local draft on connection change instead of flushing it into the new Remote target", async () => {
  const view = render(<Providers profile="work" />);
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(screen.getByText("Type local draft"));
  await act(async () => {
    for (const callback of Array.from(callbacks)) callback();
  });
  view.unmount();
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(window.hermesAPI.setEnv).not.toHaveBeenCalled();
});

it("still flushes a local pending draft when merely navigating away within its target", async () => {
  const view = render(<Providers profile="work" />);
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(screen.getByText("Type local draft"));
  await act(async () => {
    await Promise.resolve();
  });
  view.unmount();
  expect(window.hermesAPI.setEnv).toHaveBeenCalledExactlyOnceWith(
    "OPENAI_API_KEY",
    "desktop-draft",
    "work",
  );
});
