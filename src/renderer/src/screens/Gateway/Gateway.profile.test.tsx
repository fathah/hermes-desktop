import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stable `t`, like the real hook: a fresh function per render would recreate
// `loadConfig` and re-run its effect forever once a request fails.
const stableT = (key: string): string => key;
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: stableT }),
}));
vi.mock("../../components/common/BrandLogo", () => ({
  default: () => <div data-testid="brand-logo" />,
}));

import Gateway from "./Gateway";

function installApi(overrides: Record<string, unknown> = {}): void {
  const pending = overrides.gatewayCommandPending as
    | ((profile?: string) => Promise<boolean>)
    | undefined;
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getEnv: vi.fn().mockResolvedValue({}),
      getApiServerKeyStatus: vi.fn().mockResolvedValue({ hasKey: true }),
      gatewayStatus: vi.fn().mockResolvedValue(true),
      gatewayCommandPending: vi.fn().mockResolvedValue(false),
      gatewayCommandStatus: vi
        .fn()
        .mockImplementation(async (profile?: string) => ({
          pending: pending ? await pending(profile) : false,
        })),
      remoteGatewayAction: vi.fn().mockResolvedValue({ success: true }),
      getPlatformEnabled: vi.fn().mockResolvedValue({}),
      restartGateway: vi.fn().mockResolvedValue(true),
      startGateway: vi
        .fn()
        .mockResolvedValue({ success: true, running: false }),
      stopGateway: vi.fn().mockResolvedValue(true),
      getMessagingPlatforms: vi
        .fn()
        .mockResolvedValue({ platforms: [], message: null }),
      openExternal: vi.fn(),
      onConnectionConfigChanged: vi.fn().mockReturnValue(() => {}),
      ...overrides,
    },
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Gateway screen with a selected profile / failing platform list", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("keeps the gateway status and controls when the platform list fails to load", async () => {
    installApi({
      getMessagingPlatforms: vi
        .fn()
        .mockRejectedValue(new Error("Unauthorized")),
    });
    render(<Gateway profile="work" remoteMode />);
    await settle();
    expect(screen.getByText("gateway.running")).toBeTruthy();
    expect(screen.getByText("gateway.restart")).toBeTruthy();
    expect(screen.getByText("Unauthorized")).toBeTruthy();
    expect(window.hermesAPI.gatewayStatus).toHaveBeenCalledWith("work");
  });

  it("passes the selected profile to status, start and stop", async () => {
    installApi({ gatewayStatus: vi.fn().mockResolvedValue(false) });
    render(<Gateway profile="work" />);
    await settle();
    fireEvent.click(screen.getByText("common.start"));
    await settle();
    expect(window.hermesAPI.startGateway).toHaveBeenCalledWith("work");
    expect(window.hermesAPI.gatewayStatus).toHaveBeenCalledWith("work");
  });

  it("passes the selected profile to stop", async () => {
    installApi();
    render(<Gateway profile="work" />);
    await settle();
    fireEvent.click(screen.getByText("common.stop"));
    await settle();
    expect(window.hermesAPI.stopGateway).toHaveBeenCalledWith("work");
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#Pending lifecycle controls]]
  it.each(["start", "stop", "restart"])(
    "keeps %s controls disabled until IPC confirms completion",
    async (action) => {
      let resolve!: (value: unknown) => void;
      const pending = new Promise((r) => {
        resolve = r;
      });
      installApi({
        gatewayStatus: vi.fn().mockResolvedValue(action !== "start"),
        remoteGatewayAction: vi.fn().mockReturnValue(pending),
      });
      render(<Gateway profile="work" remoteMode />);
      await settle();
      const commandButton = screen
        .getByText(
          action === "restart" ? "gateway.restart" : `common.${action}`,
        )
        .closest("button") as HTMLButtonElement;
      fireEvent.click(commandButton);
      await settle();
      expect(window.hermesAPI.remoteGatewayAction).toHaveBeenCalledWith(
        action,
        "work",
      );
      expect(window.hermesAPI.startGateway).not.toHaveBeenCalled();
      expect(window.hermesAPI.stopGateway).not.toHaveBeenCalled();
      expect(window.hermesAPI.restartGateway).not.toHaveBeenCalled();
      expect(commandButton.disabled).toBe(true);
      const restartButton = screen
        .queryByText("gateway.restart")
        ?.closest("button");
      if (restartButton) expect(restartButton.disabled).toBe(true);
      await act(async () => {
        resolve({ success: true });
        await pending;
      });
      expect(
        screen.getByText(
          action === "stop" ? "gateway.stopped" : "gateway.running",
        ),
      ).toBeTruthy();
    },
  );

  // @lat: [[main-process#Main Process#Remote Gateway management#Gateway target resets]]
  it("resets on same-ID configuration edits and ignores the old command's late result", async () => {
    let changed!: () => void;
    let resolve!: (value: unknown) => void;
    const pending = new Promise((r) => {
      resolve = r;
    });
    const unsubscribe = vi.fn();
    installApi({
      gatewayStatus: vi.fn().mockResolvedValue(false),
      remoteGatewayAction: vi.fn().mockReturnValue(pending),
      onConnectionConfigChanged: vi.fn().mockImplementation((callback) => {
        changed = callback;
        return unsubscribe;
      }),
    });
    const { unmount } = render(<Gateway profile="work" remoteMode />);
    await settle();
    fireEvent.click(screen.getByText("common.start"));
    await act(async () => {
      changed();
    });
    await settle();
    const callsBefore = (
      window.hermesAPI.gatewayStatus as ReturnType<typeof vi.fn>
    ).mock.calls.length;
    await act(async () => {
      resolve({ success: true });
      await pending;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(screen.getByText("gateway.stopped")).toBeTruthy();
    expect(window.hermesAPI.gatewayStatus).toHaveBeenCalledTimes(callsBefore);
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#Remote Start post-completion liveness]]
  it("reports when a completed Remote Start exits during its five-second liveness check", async () => {
    installApi({ gatewayStatus: vi.fn().mockResolvedValue(false) });
    render(<Gateway profile="work" remoteMode />);
    await settle();
    fireEvent.click(screen.getByText("common.start"));
    await settle();
    expect(window.hermesAPI.remoteGatewayAction).toHaveBeenCalledWith(
      "start",
      "work",
    );
    expect(screen.getByText("gateway.running")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText("gateway.stopped")).toBeTruthy();
    expect(screen.getByText("gateway.startExited")).toBeTruthy();
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#Unconfirmed commands remain blocked]]
  it("keeps lifecycle controls blocked after an unconfirmed timeout until a refresh confirms completion", async () => {
    let pending = false;
    let running = true;
    installApi({
      gatewayStatus: vi.fn().mockImplementation(async () => running),
      gatewayCommandPending: vi.fn().mockImplementation(async () => pending),
      remoteGatewayAction: vi.fn().mockImplementation(async () => {
        pending = true;
        return {
          success: false,
          error: "Completion unconfirmed; server may still be processing",
          failureKind: "unconfirmed",
        };
      }),
    });
    render(<Gateway profile="work" remoteMode />);
    await settle();
    fireEvent.click(screen.getByText("common.stop"));
    await settle();
    expect(
      (screen.getByText("common.stop").closest("button") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        "Completion unconfirmed; server may still be processing",
      ),
    ).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(
      screen.getByText(
        "Completion unconfirmed; server may still be processing",
      ),
    ).toBeTruthy();
    expect(
      (screen.getByText("common.stop").closest("button") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    pending = false;
    running = false;
    fireEvent.click(screen.getByText("gateway.refresh"));
    await settle();
    expect(
      (screen.getByText("common.start").closest("button") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(screen.getByText("gateway.stopped")).toBeTruthy();
    expect(
      screen.queryByText(
        "Completion unconfirmed; server may still be processing",
      ),
    ).toBeNull();
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#Terminal Gateway failure remains visible]]
  it.each([true, false])(
    "preserves a genuine terminal Stop failure when a later refresh reports running=%s",
    async (afterFailureRunning) => {
      let running = true;
      installApi({
        gatewayStatus: vi.fn().mockImplementation(async () => running),
        remoteGatewayAction: vi.fn().mockImplementation(async () => {
          running = afterFailureRunning;
          return {
            success: false,
            error: "Remote gateway stop failed (exit 1).",
            failureKind: "failed",
          };
        }),
      });
      render(<Gateway profile="work" remoteMode />);
      await settle();
      fireEvent.click(screen.getByText("common.stop"));
      await settle();
      fireEvent.click(screen.getByText("gateway.refresh"));
      await settle();
      expect(
        screen.getByText(
          afterFailureRunning ? "gateway.running" : "gateway.stopped",
        ),
      ).toBeTruthy();
      expect(
        screen.getByText("Remote gateway stop failed (exit 1)."),
      ).toBeTruthy();
      expect(
        (
          screen
            .getByText(afterFailureRunning ? "common.stop" : "common.start")
            .closest("button") as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    },
  );

  // @lat: [[main-process#Main Process#Remote Gateway management#Completion read errors reconcile in Gateway]]
  it.each([
    ["stop", "fetch failed"],
    ["stop", "HTTP 500"],
    ["stop", "Unexpected token < in JSON"],
    ["restart", "fetch failed"],
    ["restart", "HTTP 500"],
    ["restart", "Unexpected token < in JSON"],
  ])(
    "clears accepted %s completion error %s only after matching refresh",
    async (action, explanation) => {
      let pending = false;
      let running = true;
      installApi({
        gatewayStatus: vi.fn().mockImplementation(async () => running),
        gatewayCommandPending: vi.fn().mockImplementation(async () => pending),
        remoteGatewayAction: vi.fn().mockImplementation(async () => {
          pending = true;
          return {
            success: false,
            error: explanation,
            failureKind: "unconfirmed",
          };
        }),
      });
      render(<Gateway profile="work" remoteMode />);
      await settle();
      fireEvent.click(
        screen.getByText(action === "stop" ? "common.stop" : "gateway.restart"),
      );
      await settle();
      expect(window.hermesAPI.remoteGatewayAction).toHaveBeenCalledWith(
        action,
        "work",
      );
      expect(screen.getByText(explanation)).toBeTruthy();
      fireEvent.click(screen.getByText("gateway.refresh"));
      await settle();
      expect(screen.getByText(explanation)).toBeTruthy();
      expect(
        (screen.getByText("common.stop").closest("button") as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      pending = false;
      running = action !== "stop";
      fireEvent.click(screen.getByText("gateway.refresh"));
      await settle();
      expect(screen.queryByText(explanation)).toBeNull();
      expect(
        (
          screen
            .getByText(running ? "common.stop" : "common.start")
            .closest("button") as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    },
  );

  it("preserves a genuine remote Restart failure when the old gateway remains running", async () => {
    installApi({
      remoteGatewayAction: vi.fn().mockResolvedValue({
        success: false,
        error: "Remote gateway restart failed (exit 1).",
        failureKind: "failed",
      }),
    });
    render(<Gateway profile="work" remoteMode />);
    await settle();
    fireEvent.click(screen.getByText("gateway.restart"));
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(screen.getByText("gateway.running")).toBeTruthy();
    expect(
      screen.getByText("Remote gateway restart failed (exit 1)."),
    ).toBeTruthy();
    expect(
      (
        screen
          .getByText("gateway.restart")
          .closest("button") as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#Gateway renders late command failure]]
  it.each(["stop", "restart"])(
    "replaces %s uncertainty with a matching late failure while releasing controls",
    async (action) => {
      let phase: "idle" | "uncertain" | "failed" | "reported" = "idle";
      const error = `Remote gateway ${action} failed (exit 1).`;
      installApi({
        remoteGatewayAction: vi.fn().mockImplementation(async () => {
          phase = "uncertain";
          return {
            success: false,
            failureKind: "unconfirmed",
            error: "fetch failed",
          };
        }),
        gatewayCommandStatus: vi.fn().mockImplementation(async () => {
          if (phase === "failed") {
            phase = "reported";
            return { pending: false, failure: { error } };
          }
          return { pending: phase === "uncertain" };
        }),
      });
      render(<Gateway profile="work" remoteMode />);
      await settle();
      fireEvent.click(
        screen.getByText(action === "stop" ? "common.stop" : "gateway.restart"),
      );
      await settle();
      expect(screen.getByText("fetch failed")).toBeTruthy();
      phase = "failed";
      fireEvent.click(screen.getByText("gateway.refresh"));
      await settle();
      expect(screen.queryByText("fetch failed")).toBeNull();
      expect(screen.getByText(error)).toBeTruthy();
      expect(
        (screen.getByText("common.stop").closest("button") as HTMLButtonElement)
          .disabled,
      ).toBe(false);
      fireEvent.click(screen.getByText("gateway.refresh"));
      await settle();
      expect(screen.getByText(error)).toBeTruthy();
    },
  );

  // @lat: [[main-process#Main Process#Remote Gateway management#Refresh replies cannot undo a newer action]]
  it("ignores old idle or failure refresh replies after a newer action becomes uncertain", async () => {
    let resolveOld!: (value: unknown) => void;
    const oldStatus = new Promise((resolve) => {
      resolveOld = resolve;
    });
    const status = vi.fn().mockResolvedValue({ pending: false });
    installApi({
      gatewayCommandStatus: status,
      remoteGatewayAction: vi.fn().mockImplementation(async () => {
        status.mockResolvedValue({ pending: true });
        return {
          success: false,
          failureKind: "unconfirmed",
          error: "new action completion unknown",
        };
      }),
    });
    render(<Gateway profile="work" remoteMode />);
    await settle();
    status.mockReturnValueOnce(oldStatus);
    fireEvent.click(screen.getByText("gateway.refresh"));
    await settle();
    fireEvent.click(screen.getByText("common.stop"));
    await settle();
    await act(async () => {
      resolveOld({ pending: false, failure: { error: "old action failed" } });
      await oldStatus;
    });
    expect(screen.getByText("new action completion unknown")).toBeTruthy();
    expect(screen.queryByText("old action failed")).toBeNull();
    expect(
      (screen.getByText("common.stop").closest("button") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#Pending reads preserve command meaning]]
  it.each(["pending", "rejected"])(
    "keeps a terminal Stop failure when pending lookup is %s and later recovers",
    async (lookup) => {
      let phase: "idle" | "failed" | "recovered" = "idle";
      installApi({
        gatewayStatus: vi
          .fn()
          .mockImplementation(async () => phase !== "recovered"),
        gatewayCommandPending: vi.fn().mockImplementation(async () => {
          if (phase !== "failed") return false;
          if (lookup === "rejected")
            throw new Error("Cannot read pending status");
          return true;
        }),
        remoteGatewayAction: vi.fn().mockImplementation(async () => {
          phase = "failed";
          return {
            success: false,
            error: "Remote gateway stop failed (exit 1).",
            failureKind: "failed",
          };
        }),
      });
      render(<Gateway profile="work" remoteMode />);
      await settle();
      fireEvent.click(screen.getByText("common.stop"));
      await settle();
      expect(
        screen.getByText("Remote gateway stop failed (exit 1)."),
      ).toBeTruthy();
      expect(
        (screen.getByText("common.stop").closest("button") as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      phase = "recovered";
      fireEvent.click(screen.getByText("gateway.refresh"));
      await settle();
      expect(screen.getByText("gateway.stopped")).toBeTruthy();
      expect(
        screen.getByText("Remote gateway stop failed (exit 1)."),
      ).toBeTruthy();
      expect(
        (
          screen
            .getByText("common.start")
            .closest("button") as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    },
  );

  // @lat: [[main-process#Main Process#Remote Gateway management#Pending actions after teardown]]
  it.each(["start", "restart"])(
    "does not schedule status reads when pending %s resolves after unmount",
    async (action) => {
      let resolve!: (result: unknown) => void;
      const pending = new Promise((r) => {
        resolve = r;
      });
      installApi({
        gatewayStatus: vi.fn().mockResolvedValue(action === "restart"),
        remoteGatewayAction: vi.fn().mockReturnValue(pending),
      });
      const { unmount } = render(<Gateway profile="work" remoteMode />);
      await settle();
      fireEvent.click(
        screen.getByText(
          action === "start" ? "common.start" : "gateway.restart",
        ),
      );
      const before = (
        window.hermesAPI.gatewayStatus as ReturnType<typeof vi.fn>
      ).mock.calls.length;
      unmount();
      await act(async () => {
        resolve({ success: true });
        await pending;
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000);
      });
      expect(window.hermesAPI.gatewayStatus).toHaveBeenCalledTimes(before);
      expect(window.hermesAPI.getMessagingPlatforms).toHaveBeenCalledTimes(1);
    },
  );

  it("drops the pending 5 s status check when the screen goes away (profile switch remounts it)", async () => {
    installApi({ gatewayStatus: vi.fn().mockResolvedValue(false) });
    const { unmount } = render(<Gateway profile="work" />);
    await settle();
    fireEvent.click(screen.getByText("common.start"));
    await settle();
    const callsBefore = (
      window.hermesAPI.gatewayStatus as ReturnType<typeof vi.fn>
    ).mock.calls.length;
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    // Nothing queried the old profile's status after the unmount.
    expect(
      (window.hermesAPI.gatewayStatus as ReturnType<typeof vi.fn>).mock.calls
        .length,
    ).toBe(callsBefore);
  });

  // @lat: [[main-process#Main Process#Remote Gateway management#Remote restart failure explanation]]
  it("preserves a pending remote restart's actual failure explanation across status refresh", async () => {
    const explanation =
      "Remote gateway restart completion could not be confirmed. The server may still be processing the command.";
    let pending = false;
    installApi({
      gatewayCommandPending: vi.fn().mockImplementation(async () => pending),
      remoteGatewayAction: vi.fn().mockImplementation(async () => {
        pending = true;
        return {
          success: false,
          error: explanation,
          failureKind: "unconfirmed",
        };
      }),
    });
    render(<Gateway profile="work" remoteMode />);
    await settle();
    fireEvent.click(screen.getByText("gateway.restart"));
    await settle();
    expect(screen.getByText(explanation)).toBeTruthy();
    expect(screen.queryByText("gateway.restartFailed")).toBeNull();
    expect(
      (
        screen
          .getByText("gateway.restart")
          .closest("button") as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(screen.getByText(explanation)).toBeTruthy();
    pending = false;
    fireEvent.click(screen.getByText("gateway.refresh"));
    await settle();
    expect(screen.queryByText(explanation)).toBeNull();
    expect(
      (
        screen
          .getByText("gateway.restart")
          .closest("button") as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});
