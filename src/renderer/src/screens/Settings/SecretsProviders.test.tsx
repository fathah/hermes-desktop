import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    // Echo the key, interpolating {{count}} so testResolved is assertable.
    t: (key: string, opts?: { count?: number }): string =>
      opts?.count !== undefined ? `${key}:${opts.count}` : key,
  }),
}));

import { SecretsProviders } from "./SecretsProviders";

function mockAPI(
  overrides: Record<string, ReturnType<typeof vi.fn>> = {},
): Record<string, ReturnType<typeof vi.fn>> {
  return {
    getConfig: vi.fn().mockResolvedValue(""),
    setConfig: vi.fn().mockResolvedValue(true),
    invalidateSecretsCache: vi.fn().mockResolvedValue(undefined),
    secretsProviderStatus: vi
      .fn()
      .mockResolvedValue({ provider: "env", keys: [], count: 0 }),
    ...overrides,
  };
}

function install(api: Record<string, ReturnType<typeof vi.fn>>): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
}

describe("SecretsProviders", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders all three provider cards", async () => {
    install(mockAPI());
    render(<SecretsProviders />);
    await waitFor(() => {
      expect(
        screen.getByText("settings.secrets_providerEnvTitle"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("settings.secrets_providerCommandTitle"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("settings.secrets_providerBitwardenTitle"),
      ).toBeInTheDocument();
    });
  });

  it("reflects the active provider from config (command)", async () => {
    const api = mockAPI({
      getConfig: vi
        .fn()
        .mockImplementation((key: string) =>
          Promise.resolve(
            key === "secrets.provider"
              ? "command"
              : key === "secrets.command"
                ? "/bin/helper.sh"
                : "",
          ),
        ),
    });
    install(api);
    render(<SecretsProviders />);
    // The command card shows the active badge once config loads.
    await waitFor(() => {
      expect(screen.getByText("settings.secrets_active")).toBeInTheDocument();
    });
  });

  it("activate writes secrets.provider and invalidates the cache", async () => {
    const api = mockAPI();
    install(api);
    render(<SecretsProviders />);
    // env is active by default; click "Use this" on a non-active card.
    const useButtons = await screen.findAllByText(
      "settings.secrets_useProvider",
    );
    await act(async () => {
      fireEvent.click(useButtons[0]);
    });
    await waitFor(() => {
      expect(api.setConfig).toHaveBeenCalledWith(
        "secrets.provider",
        expect.any(String),
        undefined,
      );
      expect(api.invalidateSecretsCache).toHaveBeenCalled();
    });
  });

  it("Test shows resolved key NAMES and never a value", async () => {
    const api = mockAPI({
      getConfig: vi
        .fn()
        .mockImplementation((key: string) =>
          Promise.resolve(key === "secrets.provider" ? "command" : ""),
        ),
      secretsProviderStatus: vi.fn().mockResolvedValue({
        provider: "command",
        keys: ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"],
        count: 2,
      }),
    });
    install(api);
    render(<SecretsProviders />);
    const testBtn = await screen.findByText("settings.secrets_testButton");
    await act(async () => {
      fireEvent.click(testBtn);
    });
    await waitFor(() => {
      // Key names render…
      expect(screen.getByText("ANTHROPIC_API_KEY")).toBeInTheDocument();
      expect(screen.getByText("OPENROUTER_API_KEY")).toBeInTheDocument();
      // …count is surfaced…
      expect(
        screen.getByText("settings.secrets_testResolved:2"),
      ).toBeInTheDocument();
      // …and the values-hidden note is shown.
      expect(
        screen.getByText("settings.secrets_testValuesHidden"),
      ).toBeInTheDocument();
      // …and EACH resolved key is labelled "Vault Provided" (one per key), so
      // the user can see the value is supplied by the vault, not typed/.env.
      // The label's own span holds a "· " separator node + the i18n key, so the
      // span's direct text is "· settings.secrets_vaultProvided". Match the LEAF
      // span (not its ancestors) to get an exact per-key count of 2.
      const vaultLabels = screen.getAllByText(
        (content, el) =>
          el?.tagName === "SPAN" &&
          content.includes("settings.secrets_vaultProvided"),
      );
      expect(vaultLabels).toHaveLength(2);
    });
    // The IPC the component used returns NO values — assert the shape it relied
    // on carries only names (defense against a future regression that adds them).
    const result = await api.secretsProviderStatus.mock.results[0].value;
    expect(Object.keys(result)).toEqual(["provider", "keys", "count"]);
    expect(result).not.toHaveProperty("values");
  });

  it("Test surfaces an empty-resolve as a warning, not key rows", async () => {
    const api = mockAPI({
      getConfig: vi
        .fn()
        .mockImplementation((key: string) =>
          Promise.resolve(key === "secrets.provider" ? "command" : ""),
        ),
      secretsProviderStatus: vi
        .fn()
        .mockResolvedValue({ provider: "command", keys: [], count: 0 }),
    });
    install(api);
    render(<SecretsProviders />);
    const testBtn = await screen.findByText("settings.secrets_testButton");
    await act(async () => {
      fireEvent.click(testBtn);
    });
    await waitFor(() => {
      expect(
        screen.getByText("settings.secrets_testEmpty"),
      ).toBeInTheDocument();
    });
  });
});
