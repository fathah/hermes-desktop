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
      getConnectionConfig: vi.fn().mockResolvedValue({ mode: "local" }),
      addCredentialPoolEntry: vi.fn(),
      setCredentialPool: vi.fn(),
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

// @lat: [[remote-providers#Remote Providers#SSH pool capability boundary]]
it("disables unsupported SSH pool actions and explains the server-only operation", async () => {
  vi.mocked(window.hermesAPI.getConnectionConfig).mockResolvedValue({
    mode: "ssh",
  } as Awaited<ReturnType<typeof window.hermesAPI.getConnectionConfig>>);
  render(<Providers profile="work" />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole("note").textContent).toContain(
    "unavailable over SSH",
  );
  const add = screen.getByRole("button", {
    name: "settings.add",
  }) as HTMLButtonElement;
  expect(add.closest("fieldset")!.disabled).toBe(true);
  fireEvent.click(add);
  expect(window.hermesAPI.addCredentialPoolEntry).not.toHaveBeenCalled();
  expect(window.hermesAPI.setCredentialPool).not.toHaveBeenCalled();
});

// @lat: [[remote-providers#Remote Providers#Credential pool failures stay visible]]
it("keeps a rejected Local pool addition visible without clearing the typed key", async () => {
  vi.mocked(window.hermesAPI.addCredentialPoolEntry).mockRejectedValue(
    new Error("pool save refused"),
  );
  const view = render(<Providers profile="work" />);
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.change(view.container.querySelector(".settings-pool-add select")!, {
    target: { value: "openai" },
  });
  const key = view.container.querySelector(
    ".settings-pool-add input[type=password]",
  )!;
  fireEvent.change(key, { target: { value: "local-pool-key" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "settings.add" }));
  });
  expect(screen.getByRole("alert").textContent).toBe("pool save refused");
  expect((key as HTMLInputElement).value).toBe("local-pool-key");
  expect(window.hermesAPI.addCredentialPoolEntry).toHaveBeenCalledWith(
    "openai",
    "local-pool-key",
    "",
    "work",
  );
});
