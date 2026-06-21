import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../components/I18nProvider";
import Models from "./Models";

vi.mock("../../hooks/useDiscoveredModels", () => ({
  useDiscoveredModels: () => ({
    status: "idle",
    models: [],
    freeModels: [],
  }),
}));

interface SavedModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  createdAt: number;
}

interface HermesApiMock {
  getLocale: ReturnType<typeof vi.fn>;
  setLocale: ReturnType<typeof vi.fn>;
  listModels: ReturnType<typeof vi.fn>;
  getEnv: ReturnType<typeof vi.fn>;
  getModelConfig: ReturnType<typeof vi.fn>;
  updateModel: ReturnType<typeof vi.fn>;
  setModelConfig: ReturnType<typeof vi.fn>;
  addModel: ReturnType<typeof vi.fn>;
  removeModel: ReturnType<typeof vi.fn>;
  setEnv: ReturnType<typeof vi.fn>;
}

function makeModel(overrides: Partial<SavedModel> = {}): SavedModel {
  return {
    id: "model-1",
    name: "Acme Proxy",
    provider: "custom",
    model: "acme/model",
    baseUrl: "https://acme.example.test/v1",
    createdAt: 1,
    ...overrides,
  };
}

function installHermesApi(
  models: SavedModel[],
  env: Record<string, string>,
): HermesApiMock {
  const hermesAPI: HermesApiMock = {
    getLocale: vi.fn().mockResolvedValue("en"),
    setLocale: vi.fn().mockResolvedValue("en"),
    listModels: vi.fn().mockResolvedValue(models),
    getEnv: vi.fn().mockResolvedValue(env),
    getModelConfig: vi.fn().mockResolvedValue({
      provider: "auto",
      model: "",
      baseUrl: "",
    }),
    updateModel: vi.fn().mockResolvedValue(true),
    setModelConfig: vi.fn().mockResolvedValue(true),
    addModel: vi.fn().mockResolvedValue({}),
    removeModel: vi.fn().mockResolvedValue(true),
    setEnv: vi.fn().mockResolvedValue(true),
  };

  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: hermesAPI as unknown as Window["hermesAPI"],
  });

  return hermesAPI;
}

function renderModels(): void {
  render(
    <I18nProvider>
      <Models visible={true} />
    </I18nProvider>,
  );
}

async function openEditDialog(modelName: string): Promise<HTMLInputElement> {
  renderModels();

  fireEvent.click(await screen.findByText(modelName));

  return screen.getByPlaceholderText("sk-...") as HTMLInputElement;
}

describe("Models custom provider API keys", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads legacy CUSTOM_API_KEY when editing an unknown custom provider without a per-provider key", async () => {
    installHermesApi([makeModel()], { CUSTOM_API_KEY: "sk-legacy-custom" });

    const apiKeyInput = await openEditDialog("Acme Proxy");

    await waitFor(() => {
      expect(apiKeyInput).toHaveValue("sk-legacy-custom");
    });
  });

  it("writes unknown custom provider keys to a per-provider env var", async () => {
    const hermesAPI = installHermesApi([makeModel()], {});

    const apiKeyInput = await openEditDialog("Acme Proxy");
    fireEvent.change(apiKeyInput, { target: { value: "sk-acme-new" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(hermesAPI.setEnv).toHaveBeenCalledWith(
        "CUSTOM_PROVIDER_ACME_PROXY_KEY",
        "sk-acme-new",
      );
    });
    expect(hermesAPI.setEnv).not.toHaveBeenCalledWith(
      "CUSTOM_API_KEY",
      expect.any(String),
    );
  });

  it("keeps mapped custom provider URLs on their canonical env key", async () => {
    const hermesAPI = installHermesApi(
      [
        makeModel({
          name: "Groq Proxy",
          baseUrl: "https://api.groq.com/openai/v1",
        }),
      ],
      {},
    );

    const apiKeyInput = await openEditDialog("Groq Proxy");
    fireEvent.change(apiKeyInput, { target: { value: "sk-groq-new" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(hermesAPI.setEnv).toHaveBeenCalledWith(
        "GROQ_API_KEY",
        "sk-groq-new",
      );
    });
  });
});
