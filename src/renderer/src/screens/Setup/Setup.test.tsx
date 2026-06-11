import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string): string => key }),
}));

vi.mock("../../components/common/BrandLogo", () => ({
  default: () => <div data-testid="brand-logo" />,
}));

vi.mock("../../components/VerifyWarningBanner", () => ({
  default: () => <div data-testid="verify-banner" />,
}));

import Setup from "./Setup";

function mockAPI(
  overrides: Record<string, ReturnType<typeof vi.fn>> = {},
): Record<string, ReturnType<typeof vi.fn>> {
  return {
    setEnv: vi.fn().mockResolvedValue(true),
    setModelConfig: vi.fn().mockResolvedValue(true),
    setConfig: vi.fn().mockResolvedValue(true),
    invalidateSecretsCache: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function install(api: Record<string, ReturnType<typeof vi.fn>>): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
}

describe("Setup two-stage flow", () => {
  afterEach(() => vi.restoreAllMocks());

  it("Continue advances to the secrets step (does not complete yet)", async () => {
    const onComplete = vi.fn();
    install(mockAPI());
    render(<Setup onComplete={onComplete} />);
    // The API key field is a password input — select by the openrouter placeholder.
    fireEvent.change(screen.getByPlaceholderText("sk-or-v1-..."), {
      target: { value: "sk-test" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("setup.continue"));
    });
    expect(screen.getByText("setup.secretsStepTitle")).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("Finish saves model config with the CORRECT arg order (provider, model, baseUrl)", async () => {
    const onComplete = vi.fn();
    const api = mockAPI();
    install(api);
    render(<Setup onComplete={onComplete} />);
    fireEvent.change(screen.getByPlaceholderText("sk-or-v1-..."), {
      target: { value: "sk-test" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("setup.continue"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("setup.finish"));
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    // Regression guard: setModelConfig(provider, model, baseUrl).
    const call = api.setModelConfig.mock.calls[0];
    expect(call[0]).toBe("openrouter"); // provider
    expect(call[1]).toBe(""); // model (blank — default)
    expect(call[2]).toContain("http"); // baseUrl is a URL, in the 3rd slot
    expect(api.setConfig).not.toHaveBeenCalledWith(
      "secrets.provider",
      expect.anything(),
    );
  });

  it("choosing the command provider writes secrets.provider + the helper", async () => {
    const onComplete = vi.fn();
    const api = mockAPI();
    install(api);
    render(<Setup onComplete={onComplete} />);
    fireEvent.change(screen.getByPlaceholderText("sk-or-v1-..."), {
      target: { value: "sk-test" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("setup.continue"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("setup.secrets_commandTitle"));
    });
    const helperInput = screen.getByPlaceholderText(/keepassxc-cli/i);
    fireEvent.change(helperInput, { target: { value: "echo K=v" } });
    await act(async () => {
      fireEvent.click(screen.getByText("setup.finish"));
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(api.setConfig).toHaveBeenCalledWith("secrets.provider", "command");
    expect(api.setConfig).toHaveBeenCalledWith("secrets.command", "echo K=v");
    expect(api.invalidateSecretsCache).toHaveBeenCalled();
  });

  it("Back returns to the provider step", async () => {
    install(mockAPI());
    render(<Setup onComplete={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("sk-or-v1-..."), {
      target: { value: "sk-test" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("setup.continue"));
    });
    expect(screen.getByText("setup.secretsStepTitle")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText("setup.back"));
    });
    expect(
      screen.queryByText("setup.secretsStepTitle"),
    ).not.toBeInTheDocument();
  });
});
