import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    // Echo key + interpolated params so assertions can match on key names.
    t: (key: string, params?: Record<string, string>): string =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
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
    secretsProviderStatus: vi
      .fn()
      .mockResolvedValue({ provider: "env", keys: [], count: 0 }),
    vaultDetectExisting: vi
      .fn()
      .mockResolvedValue({ found: false, kind: "none" }),
    vaultToolAvailability: vi
      .fn()
      .mockResolvedValue({ keepassxc: false, tpm: false }),
    vaultCreate: vi.fn().mockResolvedValue({ ok: false, error: "create-exception" }),
    vaultSealTpm: vi.fn().mockResolvedValue({ ok: true, sealed: true }),
    openExternal: vi.fn(),
    ...overrides,
  };
}

function install(api: Record<string, ReturnType<typeof vi.fn>>): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
}

// Advance from the secrets stage (now FIRST) to the model-provider stage.
async function gotoProviderStage(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByText("setup.continue"));
  });
}

describe("Setup — security-provider-first flow", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens on the secrets step (security provider FIRST), not the model step", () => {
    install(mockAPI());
    render(<Setup onComplete={vi.fn()} />);
    // Secrets step title is shown; model-provider key field is not yet present.
    expect(screen.getByText("setup.secretsStepTitle")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("sk-or-v1-...")).toBeNull();
  });

  it("Continue on the secrets step advances to the model-provider step", async () => {
    const onComplete = vi.fn();
    install(mockAPI());
    render(<Setup onComplete={onComplete} />);
    await gotoProviderStage();
    // Now the model provider key field appears; onComplete NOT called yet.
    expect(screen.getByPlaceholderText("sk-or-v1-...")).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("env default: Finish saves model config with correct arg order, no secrets.provider override", async () => {
    const onComplete = vi.fn();
    const api = mockAPI();
    install(api);
    render(<Setup onComplete={onComplete} />);
    await gotoProviderStage();
    fireEvent.change(screen.getByPlaceholderText("sk-or-v1-..."), {
      target: { value: "sk-test" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("setup.finish"));
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    // Regression guard: setModelConfig(provider, model, baseUrl).
    const call = api.setModelConfig.mock.calls[0];
    expect(call[0]).toBe("openrouter");
    expect(call[1]).toBe("");
    expect(call[2]).toContain("http");
    // env default → no secrets.provider write.
    expect(api.setConfig).not.toHaveBeenCalledWith(
      "secrets.provider",
      expect.anything(),
    );
  });

  it("vault resolves the key → model step SKIPS the key field and allows Finish with no typed key", async () => {
    const onComplete = vi.fn();
    // The command provider resolves OPENROUTER_API_KEY (the openrouter env key).
    const api = mockAPI({
      secretsProviderStatus: vi.fn().mockResolvedValue({
        provider: "command",
        keys: ["OPENROUTER_API_KEY"],
        count: 1,
      }),
    });
    install(api);
    render(<Setup onComplete={onComplete} />);
    // On the secrets step: pick command, test the vault.
    await act(async () => {
      fireEvent.click(screen.getByText("setup.secrets_commandTitle"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("setup.secretsTestVault"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("setup.continue"));
    });
    // Model step (openrouter is default) — the key field must be GONE, replaced
    // by the vault-covered message, and Finish must work with no typed key.
    expect(screen.queryByPlaceholderText("sk-or-v1-...")).toBeNull();
    expect(
      screen.getByText((t) => t.startsWith("setup.keyFromVault")),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText("setup.finish"));
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    // No key was typed, so setEnv must NOT be called with an empty value.
    expect(api.setEnv).not.toHaveBeenCalled();
    // secrets.provider=command was persisted (during testVault).
    expect(api.setConfig).toHaveBeenCalledWith("secrets.provider", "command");
  });

  it("Back on the model step returns to the secrets step", async () => {
    install(mockAPI());
    render(<Setup onComplete={vi.fn()} />);
    await gotoProviderStage();
    expect(screen.getByPlaceholderText("sk-or-v1-...")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText("setup.back"));
    });
    expect(screen.getByText("setup.secretsStepTitle")).toBeInTheDocument();
  });
});

describe("Setup — first-run vault onboarding (secrets stage)", () => {
  afterEach(() => vi.restoreAllMocks());

  // Pick the command/keepassxc choice and let the detect+availability probe
  // settle (the secrets stage runs vaultDetectExisting + vaultToolAvailability
  // on entering the command branch).
  async function pickCommand(): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByText("setup.secrets_commandTitle"));
    });
    // Wait for the async detect+availability probe to settle (the "checking…"
    // status disappears once detectStatus === "done").
    await waitFor(() =>
      expect(screen.queryByText("setup.vaultChecking")).toBeNull(),
    );
  }

  it("detected-existing: auto-fills the command and shows key chips + count", async () => {
    const api = mockAPI({
      vaultDetectExisting: vi.fn().mockResolvedValue({
        found: true,
        kind: "vault-file",
        keyPath: "/home/u/.config/hermes/vault.key",
        keys: ["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY"],
        suggestedCommand: "keepassxc-cli show -a Password ~/v.kdbx \"$HERMES_SECRET_KEY\"",
      }),
      vaultToolAvailability: vi
        .fn()
        .mockResolvedValue({ keepassxc: true, tpm: false }),
    });
    install(api);
    render(<Setup onComplete={vi.fn()} />);
    await pickCommand();

    expect(api.vaultDetectExisting).toHaveBeenCalled();
    expect(api.vaultToolAvailability).toHaveBeenCalled();
    // "Detected existing vault (2 key(s))" — key echoed with the count param.
    expect(
      screen.getByText((t) => t.startsWith("setup.vaultDetected")),
    ).toBeInTheDocument();
    // Key NAMES rendered as chips.
    expect(screen.getByText("OPENROUTER_API_KEY")).toBeInTheDocument();
    expect(screen.getByText("ANTHROPIC_API_KEY")).toBeInTheDocument();
    // The command field is pre-filled from suggestedCommand.
    const input = screen.getByLabelText((t) =>
      t.startsWith("setup.secretsCommandLabel"),
    ) as HTMLInputElement;
    expect(input.value).toContain("keepassxc-cli");
    // No "create" CTA in the detected case.
    expect(screen.queryByText("setup.vaultCreateBtn")).toBeNull();
  });

  it("no-vault + keepassxc available: offers Create, then TPM seal on success", async () => {
    const api = mockAPI({
      vaultDetectExisting: vi
        .fn()
        .mockResolvedValue({ found: false, kind: "none" }),
      vaultToolAvailability: vi
        .fn()
        .mockResolvedValue({ keepassxc: true, tpm: true }),
      vaultCreate: vi.fn().mockResolvedValue({
        ok: true,
        vaultPath: "/home/u/.config/hermes/vault.kdbx",
        keyPath: "/home/u/.config/hermes/vault.key",
        suggestedCommand: "keepassxc-cli show -a Password ~/v.kdbx \"$HERMES_SECRET_KEY\"",
      }),
      vaultSealTpm: vi.fn().mockResolvedValue({ ok: true, sealed: true }),
    });
    install(api);
    render(<Setup onComplete={vi.fn()} />);
    await pickCommand();

    // Primary create CTA is shown (no dead-end empty field).
    const createBtn = screen.getByText("setup.vaultCreateBtn");
    expect(createBtn).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(createBtn);
    });

    expect(api.vaultCreate).toHaveBeenCalled();
    // Persisted provider + command + cache invalidation.
    expect(api.setConfig).toHaveBeenCalledWith("secrets.provider", "command");
    expect(api.setConfig).toHaveBeenCalledWith(
      "secrets.command",
      expect.stringContaining("keepassxc-cli"),
    );
    expect(api.invalidateSecretsCache).toHaveBeenCalled();
    // Success confirmation + TPM offer (tpm:true).
    expect(screen.getByText("setup.vaultCreatedTitle")).toBeInTheDocument();
    const sealBtn = screen.getByText("setup.vaultTpmSealBtn");
    expect(sealBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(sealBtn);
    });
    expect(api.vaultSealTpm).toHaveBeenCalledWith(
      "/home/u/.config/hermes/vault.key",
    );
    // Sealed honestly reported.
    expect(screen.getByText("setup.vaultTpmSealed")).toBeInTheDocument();
  });

  it("create success but TPM unavailable at seal time: shows 0600 fallback honestly", async () => {
    const api = mockAPI({
      vaultDetectExisting: vi
        .fn()
        .mockResolvedValue({ found: false, kind: "none" }),
      vaultToolAvailability: vi
        .fn()
        .mockResolvedValue({ keepassxc: true, tpm: true }),
      vaultCreate: vi.fn().mockResolvedValue({
        ok: true,
        keyPath: "/home/u/.config/hermes/vault.key",
        suggestedCommand: "cmd",
      }),
      vaultSealTpm: vi.fn().mockResolvedValue({ ok: true, sealed: false }),
    });
    install(api);
    render(<Setup onComplete={vi.fn()} />);
    await pickCommand();
    await act(async () => {
      fireEvent.click(screen.getByText("setup.vaultCreateBtn"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("setup.vaultTpmSealBtn"));
    });
    expect(screen.getByText("setup.vaultTpmFallback")).toBeInTheDocument();
    expect(screen.queryByText("setup.vaultTpmSealed")).toBeNull();
  });

  it("keepassxc missing: shows the install hint (no create button) with the manual field still available", async () => {
    const api = mockAPI({
      vaultDetectExisting: vi
        .fn()
        .mockResolvedValue({ found: false, kind: "none" }),
      vaultToolAvailability: vi.fn().mockResolvedValue({
        keepassxc: false,
        tpm: false,
        keepassxcHint: "Run: sudo apt install keepassxc",
      }),
    });
    install(api);
    render(<Setup onComplete={vi.fn()} />);
    await pickCommand();

    // Install hint shown (actionable copy from keepassxcHint), no create CTA.
    expect(
      screen.getByText("setup.vaultKeepassxcMissingTitle"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Run: sudo apt install keepassxc"),
    ).toBeInTheDocument();
    expect(screen.queryByText("setup.vaultCreateBtn")).toBeNull();
    // Manual command field remains available as a fallback (never a dead end).
    expect(
      screen.getByLabelText((t) => t.startsWith("setup.secretsCommandLabel")),
    ).toBeInTheDocument();
  });

  it("vaultCreate failure: translates the error code to friendly copy", async () => {
    const api = mockAPI({
      vaultDetectExisting: vi
        .fn()
        .mockResolvedValue({ found: false, kind: "none" }),
      vaultToolAvailability: vi
        .fn()
        .mockResolvedValue({ keepassxc: true, tpm: false }),
      vaultCreate: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "keepassxc-cli-not-installed" }),
    });
    install(api);
    render(<Setup onComplete={vi.fn()} />);
    await pickCommand();
    await act(async () => {
      fireEvent.click(screen.getByText("setup.vaultCreateBtn"));
    });
    expect(
      screen.getByText("setup.vaultCreateErr_notInstalled"),
    ).toBeInTheDocument();
    // No TPM offer on failure.
    expect(screen.queryByText("setup.vaultTpmSealBtn")).toBeNull();
  });
});
