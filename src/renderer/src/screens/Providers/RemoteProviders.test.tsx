import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
import RemoteProviders from "./RemoteProviders";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let configChanged: () => void;
const remote = (
  id: string,
  url = `http://${id}:9119`,
): {
  connectionId: string;
  mode: "remote";
  remoteUrl: string;
  revision: string;
} => ({
  connectionId: id,
  mode: "remote",
  remoteUrl: url,
  revision: `revision-${id}`,
});
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Remote Providers scoped screen", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getProviderRequestTarget: vi.fn(async (id: string) => remote(id)),
        getEnv: vi.fn(
          async (_profile: string, target: { connectionId: string }) => ({
            OPENAI_API_KEY: `preview-${target.connectionId}`,
          }),
        ),
        getCredentialPool: vi.fn().mockResolvedValue({
          openai: [
            { id: "1", label: "Server account", access_token: "preview" },
          ],
        }),
        setEnv: vi.fn().mockResolvedValue(true),
        addCredentialPoolEntry: vi.fn().mockResolvedValue([]),
        setCredentialPool: vi.fn(),
        getAccount: vi.fn(),
        ensureHermesOneKey: vi.fn(),
        onConnectionConfigChanged: vi.fn((callback: () => void) => {
          configChanged = callback;
          return () => {};
        }),
      },
    });
  });

  // @lat: [[remote-providers#Remote Providers#Healthy Remote load]]
  it("loads only selected Remote credentials and exposes no local account or pool deletion", async () => {
    const { container } = render(
      <RemoteProviders connectionId="A" profile="work" />,
    );
    await settle();
    expect(screen.getByTestId("preview-OPENAI_API_KEY").textContent).toBe(
      "preview-A",
    );
    expect(window.hermesAPI.getEnv).toHaveBeenCalledWith("work", {
      connectionId: "A",
      mode: "remote",
      remoteUrl: "http://A:9119",
      revision: "revision-A",
    });
    expect(window.hermesAPI.getAccount).not.toHaveBeenCalled();
    expect(window.hermesAPI.ensureHermesOneKey).not.toHaveBeenCalled();
    expect(container.querySelector(".settings-pool-entry button")).toBeNull();
    expect(window.hermesAPI.setCredentialPool).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText("constants.openaiApiKey") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  // @lat: [[remote-providers#Remote Providers#Late screen reads are discarded]]
  it("discards late A env/pool replies after switching to B with the same profile", async () => {
    const a = deferred<Record<string, string>>();
    vi.mocked(window.hermesAPI.getEnv).mockReturnValueOnce(a.promise);
    const view = render(<RemoteProviders connectionId="A" profile="work" />);
    await settle();
    view.rerender(<RemoteProviders connectionId="B" profile="work" />);
    await settle();
    expect(screen.getByTestId("preview-OPENAI_API_KEY").textContent).toBe(
      "preview-B",
    );
    await act(async () => {
      a.resolve({ OPENAI_API_KEY: "late-A-secret-preview" });
    });
    expect(screen.queryByText("late-A-secret-preview")).toBeNull();
    expect(screen.getByTestId("preview-OPENAI_API_KEY").textContent).toBe(
      "preview-B",
    );
  });

  it("resets drafts and selected pool account when changing profile", async () => {
    const view = render(<RemoteProviders connectionId="A" profile="default" />);
    await settle();
    fireEvent.change(screen.getByLabelText("constants.openaiApiKey"), {
      target: { value: "draft-A" },
    });
    fireEvent.change(screen.getByLabelText("Pool provider"), {
      target: { value: "openai" },
    });
    fireEvent.change(screen.getByLabelText("Pool API key"), {
      target: { value: "pool-A" },
    });
    view.rerender(<RemoteProviders connectionId="A" profile="work" />);
    await settle();
    expect(
      (screen.getByLabelText("constants.openaiApiKey") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(
      (screen.getByLabelText("Pool API key") as HTMLInputElement).value,
    ).toBe("");
    expect(window.hermesAPI.setEnv).not.toHaveBeenCalled();
    expect(window.hermesAPI.addCredentialPoolEntry).not.toHaveBeenCalled();
  });

  // @lat: [[remote-providers#Remote Providers#Late writes cannot refresh another target]]
  it("keeps an admitted A save scoped to A and stops follow-up refresh after B mounts", async () => {
    const saved = deferred<boolean>();
    vi.mocked(window.hermesAPI.setEnv).mockReturnValueOnce(saved.promise);
    const view = render(<RemoteProviders connectionId="A" profile="work" />);
    await settle();
    fireEvent.change(screen.getByLabelText("constants.openaiApiKey"), {
      target: { value: "typed-A" },
    });
    const input = screen.getByLabelText("constants.openaiApiKey");
    await act(async () => {
      fireEvent.click(
        input.closest(".settings-field")!.querySelector("button")!,
      );
    });
    expect(window.hermesAPI.setEnv).toHaveBeenCalledWith(
      "OPENAI_API_KEY",
      "typed-A",
      "work",
      {
        connectionId: "A",
        mode: "remote",
        remoteUrl: "http://A:9119",
        revision: "revision-A",
      },
    );
    view.rerender(<RemoteProviders connectionId="B" profile="work" />);
    await settle();
    const reads = vi.mocked(window.hermesAPI.getEnv).mock.calls.length;
    await act(async () => {
      saved.resolve(true);
    });
    expect(window.hermesAPI.getEnv).toHaveBeenCalledTimes(reads);
    expect(screen.getByTestId("preview-OPENAI_API_KEY").textContent).toBe(
      "preview-B",
    );
  });

  // @lat: [[remote-providers#Remote Providers#Configuration changes clear secrets]]
  it("discards same-ID drafts and data on config revision and never reads Local credentials after a mode change", async () => {
    render(<RemoteProviders connectionId="A" profile="default" />);
    await settle();
    fireEvent.change(screen.getByLabelText("constants.openaiApiKey"), {
      target: { value: "draft-A" },
    });
    vi.mocked(window.hermesAPI.getProviderRequestTarget).mockResolvedValue({
      ...remote("A"),
      mode: "local",
    } as Awaited<ReturnType<typeof window.hermesAPI.getProviderRequestTarget>>);
    const reads = vi.mocked(window.hermesAPI.getEnv).mock.calls.length;
    await act(async () => {
      configChanged();
    });
    await settle();
    expect(screen.queryByText("preview-A")).toBeNull();
    expect(screen.queryByLabelText("constants.openaiApiKey")).toBeNull();
    expect(window.hermesAPI.getEnv).toHaveBeenCalledTimes(reads);
    expect(window.hermesAPI.setEnv).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "Remote connection",
    );
  });

  it("retains key management when a named-profile pool is unsupported", async () => {
    vi.mocked(window.hermesAPI.getCredentialPool).mockRejectedValue(
      new Error("Profile-scoped pool unavailable"),
    );
    render(<RemoteProviders connectionId="A" profile="work" />);
    await settle();
    expect(screen.getByTestId("preview-OPENAI_API_KEY").textContent).toBe(
      "preview-A",
    );
    expect(screen.getByText("Profile-scoped pool unavailable")).toBeTruthy();
    expect(screen.queryByLabelText("Pool API key")).toBeNull();
  });

  it("shows Remote read failure without showing stale keys or account controls", async () => {
    vi.mocked(window.hermesAPI.getEnv).mockRejectedValue(
      new Error("OAuth sign in required"),
    );
    render(<RemoteProviders connectionId="A" />);
    await settle();
    expect(screen.getByRole("alert").textContent).toBe(
      "OAuth sign in required",
    );
    expect(screen.queryByLabelText("constants.openaiApiKey")).toBeNull();
    expect(window.hermesAPI.getAccount).not.toHaveBeenCalled();
  });
});
