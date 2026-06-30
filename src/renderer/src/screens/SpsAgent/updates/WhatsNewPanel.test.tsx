import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsNewPanel } from "./WhatsNewPanel";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("hermes-desktop-last-seen-version", "0.5.3");
  vi.stubGlobal("electron", { process: { platform: "darwin" } });
  vi.stubGlobal("hermesAPI", {
    getAppVersion: vi.fn().mockResolvedValue("0.5.4"),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WhatsNewPanel", () => {
  it("shows unseen affordances after an app version change", async () => {
    render(<WhatsNewPanel onRunAction={vi.fn()} />);

    expect(
      await screen.findByText("Control Center AI readiness"),
    ).toBeInTheDocument();
    expect(screen.getByText("Intentional narrow workspace")).toBeInTheDocument();
    expect(screen.getByText("Readable SPS dark theme")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Control Center" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Appearance" }),
    ).toBeInTheDocument();
  });

  it("routes each affordance CTA to the expected in-app target", async () => {
    const onRunAction = vi.fn();
    render(<WhatsNewPanel onRunAction={onRunAction} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Control Center" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Appearance" }));

    expect(onRunAction).toHaveBeenNthCalledWith(1, {
      kind: "settings",
      view: "overview",
    });
    expect(onRunAction).toHaveBeenNthCalledWith(2, {
      kind: "surface",
      surface: "doc",
    });
    expect(onRunAction).toHaveBeenNthCalledWith(3, {
      kind: "modal",
      modal: "tweaks",
    });
  });

  it("persists dismissal at the current version", async () => {
    render(<WhatsNewPanel onRunAction={vi.fn()} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Dismiss what's new" }),
    );

    await waitFor(() =>
      expect(localStorage.getItem("hermes-desktop-last-seen-version")).toBe(
        "0.5.4",
      ),
    );
  });
});
