// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import FloatingPet from "./FloatingPet";

const { client, open, refresh, petRequest } = vi.hoisted(() => {
  const client = { close: vi.fn(), connected: true };
  return { client, open: vi.fn(), refresh: vi.fn(), petRequest: vi.fn() };
});
vi.mock("./petGateway", () => ({
  openPetGateway: open,
  refreshPetInfo: refresh,
  petRequest,
}));
vi.mock("./PetSprite", () => ({
  PetSprite: ({ info, state }: { info: { slug: string }; state: string }) => (
    <span>
      {info.slug}: {state}
    </span>
  ),
}));

let notifyConnectionChange = (): void => {};
beforeEach(() => {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      onConnectionConfigChanged: vi.fn((handler) => {
        notifyConnectionChange = () => handler({});
        return vi.fn();
      }),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  localStorage.removeItem("hermes.one.pet.position.v1");
});

describe("FloatingPet", () => {
  // @lat: [[shared-pets#Recovery regressions#Clarification waiting]]
  it("stays waiting when loading pauses for clarification and resumes only when answered", async () => {
    open.mockResolvedValue(client);
    petRequest.mockResolvedValue({
      enabled: true,
      slug: "cat",
      spritesheetRevision: "1",
    });
    refresh.mockResolvedValue({
      enabled: true,
      slug: "cat",
      spritesheetBase64: "image",
      spritesheetRevision: "1",
    });
    const view = render(
      <FloatingPet
        connectionId="machine-a"
        profile="work"
        runId="run-1"
        busy
      />,
    );
    await screen.findByText("cat: run");
    act(() =>
      window.dispatchEvent(
        new CustomEvent("hermes-pet-activity", {
          detail: {
            connectionId: "machine-a",
            profile: "work",
            runId: "run-1",
            type: "clarify.request",
          },
        }),
      ),
    );
    view.rerender(
      <FloatingPet
        connectionId="machine-a"
        profile="work"
        runId="run-1"
        busy={false}
      />,
    );
    expect(screen.getByText("cat: waiting")).toBeInTheDocument();
    vi.useFakeTimers();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByText("cat: waiting")).toBeInTheDocument();
    view.rerender(
      <FloatingPet
        connectionId="machine-a"
        profile="work"
        runId="run-1"
        busy
      />,
    );
    expect(screen.getByText("cat: run")).toBeInTheDocument();
    act(() =>
      window.dispatchEvent(
        new CustomEvent("hermes-pet-activity", {
          detail: {
            connectionId: "machine-a",
            profile: "work",
            runId: "run-1",
            type: "message.complete",
          },
        }),
      ),
    );
    view.rerender(
      <FloatingPet
        connectionId="machine-a"
        profile="work"
        runId="run-1"
        busy={false}
      />,
    );
    expect(screen.getByText("cat: wave")).toBeInTheDocument();
  });

  // @lat: [[shared-pets#Connection edit regressions#Mascot refresh]]
  it("discards an old endpoint's pending sprite after editing a connection in place", async () => {
    let resolveOld!: (value: unknown) => void;
    open.mockResolvedValue(client);
    petRequest.mockResolvedValue({
      enabled: true,
      slug: "cat",
      spritesheetRevision: "1",
    });
    refresh
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValue({
        enabled: true,
        slug: "dog",
        spritesheetBase64: "new",
        spritesheetRevision: "2",
      });
    render(
      <FloatingPet connectionId="machine-a" profile="work" busy={false} />,
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    act(() => notifyConnectionChange());
    expect(await screen.findByText("dog: idle")).toBeInTheDocument();
    await act(async () =>
      resolveOld({
        enabled: true,
        slug: "cat",
        spritesheetBase64: "old",
        spritesheetRevision: "1",
      }),
    );
    expect(screen.queryByText("cat: idle")).not.toBeInTheDocument();
    expect(client.close).toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("clamps a saved drag position into the current content area", async () => {
    localStorage.setItem(
      "hermes.one.pet.position.v1",
      JSON.stringify({ x: 1000, y: 1000 }),
    );
    open.mockResolvedValue(client);
    petRequest.mockResolvedValue({
      enabled: true,
      slug: "cat",
      spritesheetRevision: "1",
    });
    refresh.mockResolvedValue({
      enabled: true,
      slug: "cat",
      spritesheetBase64: "image",
      spritesheetRevision: "1",
    });
    const view = render(
      <div>
        <FloatingPet connectionId="machine-a" profile="default" busy={false} />
      </div>,
    );
    expect(await screen.findByText("cat: idle")).toBeInTheDocument();
    expect(view.container.querySelector(".pet-floating")).toHaveStyle({
      left: "0px",
      top: "0px",
    });
  });
  it("shows failure rather than a success wave when a turn ends without message.complete", async () => {
    open.mockResolvedValue(client);
    petRequest.mockResolvedValue({
      enabled: true,
      slug: "cat",
      spritesheetRevision: "1",
    });
    refresh.mockResolvedValue({
      enabled: true,
      slug: "cat",
      spritesheetBase64: "image",
      spritesheetRevision: "1",
    });
    const view = render(
      <FloatingPet
        connectionId="machine-a"
        profile="default"
        runId="run-1"
        busy
      />,
    );
    expect(await screen.findByText("cat: run")).toBeInTheDocument();
    act(() =>
      window.dispatchEvent(
        new CustomEvent("hermes-pet-activity", {
          detail: {
            connectionId: "machine-a",
            profile: "default",
            runId: "run-1",
            type: "turn.failed",
            failed: true,
          },
        }),
      ),
    );
    view.rerender(
      <FloatingPet
        connectionId="machine-a"
        profile="default"
        runId="run-1"
        busy={false}
      />,
    );
    expect(screen.getByText("cat: failed")).toBeInTheDocument();
  });
  it("shows the chosen machine/profile's pet and follows upstream changes", async () => {
    open.mockResolvedValue(client);
    refresh
      .mockResolvedValueOnce({
        enabled: true,
        slug: "cat",
        spritesheetBase64: "image",
        spritesheetRevision: "1",
      })
      .mockResolvedValue({
        enabled: true,
        slug: "dog",
        spritesheetBase64: "new",
        spritesheetRevision: "2",
      });
    petRequest
      .mockResolvedValueOnce({
        enabled: true,
        slug: "cat",
        spritesheetRevision: "1",
      })
      .mockResolvedValue({
        enabled: true,
        slug: "dog",
        spritesheetRevision: "2",
      });
    const { rerender } = render(
      <FloatingPet connectionId="machine-a" profile="default" busy={false} />,
    );
    expect(await screen.findByText("cat: idle")).toBeInTheDocument();
    expect(open).toHaveBeenCalledWith(
      "default",
      "machine-a",
      expect.any(Function),
    );
    act(() =>
      window.dispatchEvent(
        new CustomEvent("hermes-pet-changed", {
          detail: { profile: "default", connectionId: "machine-a" },
        }),
      ),
    );
    expect(await screen.findByText("dog: idle")).toBeInTheDocument();
    rerender(
      <FloatingPet connectionId="machine-b" profile="phoenix" busy={false} />,
    );
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "phoenix",
        "machine-b",
        expect.any(Function),
      ),
    );
    expect(client.close).toHaveBeenCalled();
  });

  it("shows a failed pose for a failed turn instead of celebrating it", async () => {
    open.mockResolvedValue(client);
    refresh.mockResolvedValue({
      enabled: true,
      slug: "cat",
      spritesheetBase64: "image",
      spritesheetRevision: "1",
    });
    petRequest.mockResolvedValue({
      enabled: true,
      slug: "cat",
      spritesheetRevision: "1",
    });
    const { rerender } = render(
      <FloatingPet
        connectionId="machine-a"
        profile="default"
        runId="run-1"
        busy
      />,
    );
    expect(await screen.findByText("cat: run")).toBeInTheDocument();
    act(() =>
      window.dispatchEvent(
        new CustomEvent("hermes-pet-activity", {
          detail: {
            connectionId: "machine-a",
            profile: "default",
            runId: "run-1",
            type: "message.complete",
            failed: true,
          },
        }),
      ),
    );
    rerender(
      <FloatingPet
        connectionId="machine-a"
        profile="default"
        runId="run-1"
        busy={false}
      />,
    );
    expect(await screen.findByText("cat: failed")).toBeInTheDocument();
  });

  it("reconnects a closed pet socket on focus without changing the selected profile", async () => {
    const first = { close: vi.fn(), connected: true };
    const second = { close: vi.fn(), connected: true };
    open.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    refresh.mockResolvedValue({
      enabled: true,
      slug: "cat",
      spritesheetBase64: "image",
      spritesheetRevision: "1",
    });
    petRequest.mockResolvedValue({
      enabled: true,
      slug: "cat",
      spritesheetRevision: "1",
    });
    render(
      <FloatingPet connectionId="machine-a" profile="default" busy={false} />,
    );
    expect(await screen.findByText("cat: idle")).toBeInTheDocument();
    first.connected = false;
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(open).toHaveBeenLastCalledWith(
      "default",
      "machine-a",
      expect.any(Function),
    );
  });

  it("rechecks an upstream change received during an in-flight metadata read", async () => {
    let resolveOld: (value: unknown) => void = () => undefined;
    open.mockResolvedValue(client);
    petRequest
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValue({ enabled: false });
    refresh.mockResolvedValue({
      enabled: true,
      slug: "cat",
      spritesheetBase64: "image",
      spritesheetRevision: "1",
    });
    render(
      <FloatingPet connectionId="machine-a" profile="default" busy={false} />,
    );
    await waitFor(() => expect(petRequest).toHaveBeenCalledTimes(1));
    act(() =>
      window.dispatchEvent(
        new CustomEvent("hermes-pet-changed", {
          detail: { profile: "default", connectionId: "machine-a" },
        }),
      ),
    );
    await act(async () =>
      resolveOld({ enabled: true, slug: "cat", spritesheetRevision: "1" }),
    );
    await waitFor(() => expect(petRequest).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("cat: idle")).not.toBeInTheDocument();
  });

  it("drops a previous conversation's waiting state when the visible run changes", async () => {
    open.mockResolvedValue(client);
    petRequest.mockResolvedValue({
      enabled: true,
      slug: "cat",
      spritesheetRevision: "1",
    });
    refresh.mockResolvedValue({
      enabled: true,
      slug: "cat",
      spritesheetBase64: "image",
      spritesheetRevision: "1",
    });
    const { rerender } = render(
      <FloatingPet
        connectionId="machine-a"
        profile="default"
        runId="old"
        busy={false}
      />,
    );
    expect(await screen.findByText("cat: idle")).toBeInTheDocument();
    act(() =>
      window.dispatchEvent(
        new CustomEvent("hermes-pet-activity", {
          detail: {
            connectionId: "machine-a",
            profile: "default",
            runId: "old",
            type: "clarify.request",
          },
        }),
      ),
    );
    expect(screen.getByText("cat: waiting")).toBeInTheDocument();
    rerender(
      <FloatingPet
        connectionId="machine-a"
        profile="default"
        runId="new"
        busy={false}
      />,
    );
    expect(await screen.findByText("cat: idle")).toBeInTheDocument();
  });

  it("does not let the previous run's failure timer clear this run's error", async () => {
    open.mockResolvedValue(client);
    petRequest.mockResolvedValue({
      enabled: true,
      slug: "cat",
      spritesheetRevision: "1",
    });
    refresh.mockResolvedValue({
      enabled: true,
      slug: "cat",
      spritesheetBase64: "image",
      spritesheetRevision: "1",
    });
    const { rerender } = render(
      <FloatingPet
        connectionId="machine-a"
        profile="default"
        runId="old"
        busy={false}
      />,
    );
    expect(await screen.findByText("cat: idle")).toBeInTheDocument();
    vi.useFakeTimers();
    const fail = (runId: string): void => {
      act(() =>
        window.dispatchEvent(
          new CustomEvent("hermes-pet-activity", {
            detail: {
              connectionId: "machine-a",
              profile: "default",
              runId,
              type: "message.complete",
              failed: true,
            },
          }),
        ),
      );
    };
    fail("old");
    act(() => vi.advanceTimersByTime(1000));
    rerender(
      <FloatingPet
        connectionId="machine-a"
        profile="default"
        runId="new"
        busy={false}
      />,
    );
    fail("new");
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.getByText("cat: failed")).toBeInTheDocument();
  });
});
