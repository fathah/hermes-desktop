import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderKeysSection } from "./ProviderKeysSection";

vi.mock("./useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const api = {
  listCustomProviders: vi.fn(),
  listModels: vi.fn(),
  onModelLibraryChanged: vi.fn(),
  onCustomProvidersChanged: vi.fn(),
};

function providers(profile = "work"): React.JSX.Element {
  return (
    <ProviderKeysSection
      items={[]}
      env={{}}
      savedKey={null}
      visibleKeys={new Set()}
      onChange={vi.fn()}
      onBlur={vi.fn()}
      onToggleVisibility={vi.fn()}
      onRemove={vi.fn()}
      profile={profile}
    />
  );
}

function renderProviders(): void {
  render(providers());
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const legacy = [
  {
    provider: "custom",
    providerLabel: "Legacy endpoint",
    baseUrl: "http://localhost:9000/v1",
  },
];

async function refresh(): Promise<void> {
  await act(async () => {
    api.onModelLibraryChanged.mock.calls.at(-1)![0]();
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(window, "hermesAPI", {
    value: api,
    configurable: true,
  });
  api.listCustomProviders.mockResolvedValue([
    { name: "Local workstation", baseUrl: "http://localhost:8000/v1" },
  ]);
  api.listModels.mockResolvedValue([]);
  api.onModelLibraryChanged.mockReturnValue(() => {});
  api.onCustomProvidersChanged.mockReturnValue(() => {});
});

describe("custom provider loading", () => {
  // @lat: [[provider-setup#Provider setup#LLM-provider keys are configured-only, via modals#Named custom providers#Model library failure preserves configured providers]]
  it("keeps configured provider cards when the model library fails, then recovers on refresh", async () => {
    api.listModels.mockRejectedValueOnce(
      new Error("Model library unavailable"),
    );
    renderProviders();
    expect(await screen.findByText("Local workstation")).toBeVisible();
    expect(screen.getByText("http://localhost:8000/v1")).toBeVisible();
    expect(api.listCustomProviders).toHaveBeenCalledWith("work");

    api.listModels.mockResolvedValue([
      {
        provider: "custom",
        providerLabel: "Legacy endpoint",
        baseUrl: "http://localhost:9000/v1",
      },
    ]);
    await act(async () => {
      api.onModelLibraryChanged.mock.calls[0][0]();
    });
    expect(await screen.findByText("Legacy endpoint")).toBeVisible();
    expect(screen.getByText("Local workstation")).toBeVisible();
  });

  it("falls back to legacy models when the provider identity store fails", async () => {
    api.listCustomProviders.mockRejectedValue(new Error("Store unavailable"));
    api.listModels.mockResolvedValue([
      {
        provider: "custom",
        providerLabel: "Legacy endpoint",
        baseUrl: "http://localhost:9000/v1",
      },
    ]);
    renderProviders();
    expect(await screen.findByText("Legacy endpoint")).toBeVisible();
  });

  it("keeps the authoritative endpoint and excludes built-in provider models", async () => {
    api.listModels.mockResolvedValue([
      {
        provider: "custom",
        providerLabel: "Local workstation",
        baseUrl: "http://localhost:9000/v1",
      },
      {
        provider: "custom",
        providerLabel: "Hermes One",
        baseUrl: "https://inference.hermesone.org/v1",
      },
    ]);
    renderProviders();
    expect(await screen.findByText("Local workstation")).toBeVisible();
    expect(screen.getAllByText("Local workstation")).toHaveLength(1);
    expect(screen.getByText("http://localhost:8000/v1")).toBeVisible();
    expect(
      screen.queryByText("http://localhost:9000/v1"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Hermes One")).not.toBeInTheDocument();
  });

  it("handles both reads failing and retries them on a provider change", async () => {
    api.listCustomProviders.mockRejectedValueOnce(
      new Error("Store unavailable"),
    );
    api.listModels.mockRejectedValueOnce(
      new Error("Model library unavailable"),
    );
    await act(async () => {
      renderProviders();
    });
    expect(screen.getByText("providers.keys.addProvider")).toBeVisible();
    await act(async () => {
      api.onCustomProvidersChanged.mock.calls[0][0]();
    });
    expect(await screen.findByText("Local workstation")).toBeVisible();
  });

  it("retains the last successful legacy read through an outage, but honors a successful empty read", async () => {
    api.listModels.mockResolvedValue(legacy);
    renderProviders();
    expect(await screen.findByText("Legacy endpoint")).toBeVisible();
    api.listModels.mockRejectedValueOnce(new Error("offline"));
    await refresh();
    expect(screen.getByText("Legacy endpoint")).toBeVisible();
    api.listModels.mockResolvedValue([]);
    await refresh();
    expect(screen.queryByText("Legacy endpoint")).not.toBeInTheDocument();
  });

  it("retains store identities on failure without reviving them after a successful deletion", async () => {
    api.listModels.mockResolvedValue(legacy);
    renderProviders();
    expect(await screen.findByText("Local workstation")).toBeVisible();
    api.listCustomProviders.mockRejectedValueOnce(new Error("offline"));
    await refresh();
    expect(screen.getByText("Local workstation")).toBeVisible();
    api.listCustomProviders.mockResolvedValue([]);
    api.listModels.mockRejectedValue(new Error("offline"));
    await refresh();
    expect(screen.queryByText("Local workstation")).not.toBeInTheDocument();
    expect(screen.getByText("Legacy endpoint")).toBeVisible();
    api.listCustomProviders.mockRejectedValue(new Error("offline"));
    await refresh();
    expect(screen.queryByText("Local workstation")).not.toBeInTheDocument();
    expect(screen.getByText("Legacy endpoint")).toBeVisible();
  });

  it.each([false, true])(
    "ignores an older model-library response (failure: %s)",
    async (fail) => {
      renderProviders();
      expect(await screen.findByText("Local workstation")).toBeVisible();
      const older = deferred<typeof legacy>();
      api.listModels.mockReturnValueOnce(older.promise);
      await refresh();
      api.listModels.mockResolvedValue(legacy);
      await refresh();
      expect(screen.getByText("Legacy endpoint")).toBeVisible();
      await act(async () => {
        if (fail) older.reject(new Error("offline"));
        else older.resolve([]);
      });
      expect(screen.getByText("Legacy endpoint")).toBeVisible();
    },
  );

  it("clears profile-specific snapshots and ignores late responses from the previous profile", async () => {
    api.listModels.mockResolvedValue(legacy);
    const view = render(providers());
    expect(await screen.findByText("Legacy endpoint")).toBeVisible();
    const older = deferred<typeof legacy>();
    api.listModels.mockReturnValueOnce(older.promise);
    await refresh();
    api.listCustomProviders.mockResolvedValue([
      { name: "Personal endpoint", baseUrl: "http://localhost:7000/v1" },
    ]);
    api.listModels.mockRejectedValue(new Error("offline"));
    view.rerender(providers("personal"));
    expect(screen.queryByText("Legacy endpoint")).not.toBeInTheDocument();
    expect(await screen.findByText("Personal endpoint")).toBeVisible();
    await act(async () => {
      older.resolve(legacy);
    });
    expect(screen.getByText("Personal endpoint")).toBeVisible();
    expect(screen.queryByText("Local workstation")).not.toBeInTheDocument();
    expect(screen.queryByText("Legacy endpoint")).not.toBeInTheDocument();
  });

  it("unsubscribes and ignores a pending response after unmount", async () => {
    const pending = deferred<typeof legacy>();
    const offModels = vi.fn();
    const offProviders = vi.fn();
    api.onModelLibraryChanged.mockReturnValue(offModels);
    api.onCustomProvidersChanged.mockReturnValue(offProviders);
    api.listModels.mockReturnValue(pending.promise);
    const view = render(providers());
    await act(async () => {});
    view.unmount();
    await act(async () => {
      pending.resolve(legacy);
    });
    expect(offModels).toHaveBeenCalledOnce();
    expect(offProviders).toHaveBeenCalledOnce();
    expect(screen.queryByText("Legacy endpoint")).not.toBeInTheDocument();
  });
});
