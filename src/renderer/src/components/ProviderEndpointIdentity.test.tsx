import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderKeysSection } from "./ProviderKeysSection";

vi.mock("./useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../hooks/useDiscoveredModels", () => ({
  useDiscoveredModels: () => ({
    models: [],
    status: "ok",
    cached: false,
    freeModels: [],
  }),
}));

const api = {
  listCustomProviders: vi.fn(),
  listModels: vi.fn(),
  removeModel: vi.fn(),
  removeCustomProvider: vi.fn(),
  onModelLibraryChanged: vi.fn(),
  onCustomProvidersChanged: vi.fn(),
};

function model(
  id: string,
  baseUrl: string,
  providerLabel?: string,
): Awaited<ReturnType<typeof window.hermesAPI.listModels>>[number] {
  return {
    id,
    name: id,
    model: id,
    provider: "custom",
    baseUrl,
    providerLabel,
    createdAt: 0,
  };
}

async function openProvider(baseUrl: string): Promise<void> {
  api.listCustomProviders.mockResolvedValue([
    { name: "Tenant provider", baseUrl },
  ]);
  render(
    <ProviderKeysSection
      items={[]}
      env={{}}
      savedKey={null}
      visibleKeys={new Set()}
      onChange={vi.fn()}
      onBlur={vi.fn()}
      onToggleVisibility={vi.fn()}
      onRemove={vi.fn()}
      profile="work"
    />,
  );
  const card = await screen.findByText("Tenant provider");
  await act(async () => {
    fireEvent.click(card);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(window, "hermesAPI", {
    value: api,
    configurable: true,
  });
  api.onModelLibraryChanged.mockReturnValue(() => {});
  api.onCustomProvidersChanged.mockReturnValue(() => {});
  api.removeModel.mockResolvedValue(undefined);
  api.removeCustomProvider.mockResolvedValue(undefined);
});

describe("custom provider endpoint ownership", () => {
  // @lat: [[provider-setup#Provider setup#LLM-provider keys are configured-only, via modals#Named custom providers#Endpoint identity in model management]]
  it.each([
    ["https://example.test/TenantA/v1", "https://example.test/tenanta/v1"],
    [
      "https://example.test/v1?tenant=Alpha",
      "https://example.test/v1?tenant=alpha",
    ],
  ])(
    "keeps models at a distinct case-sensitive endpoint out of the provider editor and deletion (%s)",
    async (endpoint, otherEndpoint) => {
      api.listModels.mockResolvedValue([
        model("owned-model", endpoint),
        model("other-tenant-model", otherEndpoint),
        model("other-labeled-model", endpoint, "Another provider"),
      ]);
      await openProvider(endpoint);
      expect(await screen.findByText("owned-model")).toBeVisible();
      expect(screen.queryByText("other-tenant-model")).not.toBeInTheDocument();
      expect(screen.queryByText("other-labeled-model")).not.toBeInTheDocument();
      fireEvent.click(screen.getByText("providers.keys.remove"));
      await waitFor(() =>
        expect(api.removeCustomProvider).toHaveBeenCalledWith(
          "work",
          "Tenant provider",
        ),
      );
      expect(api.removeModel.mock.calls).toEqual([["owned-model"]]);
    },
  );

  it.each([
    ["https://example.test/TenantA/v1", "https://example.test/tenanta/v1"],
    [
      "https://example.test/v1?tenant=Alpha",
      "https://example.test/v1?tenant=alpha",
    ],
  ])(
    "does not delete another endpoint's legacy models when removing %s",
    async (endpoint, otherEndpoint) => {
      api.listModels.mockResolvedValue([
        model("owned-model", endpoint),
        model("other-tenant-model", otherEndpoint),
      ]);
      await openProvider(endpoint);
      await act(async () => {
        fireEvent.click(screen.getByText("providers.keys.remove"));
      });
      expect(api.removeCustomProvider).toHaveBeenCalledWith(
        "work",
        "Tenant provider",
      );
      expect(api.removeModel.mock.calls).toEqual([["owned-model"]]);
    },
  );

  it("recognizes equivalent hosts, default ports, and trailing slashes for display and removal", async () => {
    api.listModels.mockResolvedValue([
      model("equivalent-model", "https://EXAMPLE.test:443/TenantA/v1/"),
      model("named-model", "https://old-host.test/v1", "Tenant provider"),
    ]);
    await openProvider("https://example.test/TenantA/v1");
    expect(await screen.findByText("equivalent-model")).toBeVisible();
    expect(screen.getByText("named-model")).toBeVisible();
    fireEvent.click(screen.getByText("providers.keys.remove"));
    await waitFor(() =>
      expect(api.removeCustomProvider).toHaveBeenCalledWith(
        "work",
        "Tenant provider",
      ),
    );
    expect(api.removeModel.mock.calls).toEqual([
      ["equivalent-model"],
      ["named-model"],
    ]);
  });
});
