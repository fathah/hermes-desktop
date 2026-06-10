// TweaksPanel.test.tsx — F5: the Storage settings section shows the right
// control per authoritative mode. IPC is stubbed; storage mode lives in
// localStorage (jsdom).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TweaksPanel } from "./TweaksPanel";
import { useStore } from "../store";
import { setStorageMode } from "../lib/storageMode";

function stubApi(overrides: Record<string, unknown>): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = overrides;
}

beforeEach(() => {
  setStorageMode("blob");
  // listSkins is awaited on mount; resolve empty so the skin select stays hidden.
  stubApi({ listSkins: vi.fn().mockResolvedValue([]) });
  useStore.setState({ tweaksOpen: true });
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  setStorageMode("blob");
  useStore.setState({ tweaksOpen: false });
  vi.restoreAllMocks();
});

describe("TweaksPanel — Storage section", () => {
  it("shows the migrate control + JSON-blob mode in blob mode", () => {
    render(<TweaksPanel />);
    expect(screen.getByText("Storage")).toBeTruthy();
    expect(screen.getByText("JSON blob")).toBeTruthy();
    expect(screen.getByText("Switch to markdown storage")).toBeTruthy();
  });

  it("shows the rollback control + vault mode in vault mode", () => {
    setStorageMode("vault");
    render(<TweaksPanel />);
    expect(screen.getByText("Markdown vault")).toBeTruthy();
    expect(screen.getByText("Switch to JSON storage")).toBeTruthy();
  });
});

describe("TweaksPanel — Active skills section", () => {
  it("lists installed + disabled skills and toggles one", async () => {
    const setSkillEnabled = vi.fn().mockResolvedValue({ success: true });
    stubApi({
      listSkins: vi.fn().mockResolvedValue([]),
      listInstalledSkills: vi
        .fn()
        .mockResolvedValue([
          { name: "alpha", category: "x", description: "A", path: "/s/alpha" },
        ]),
      listDisabledSkills: vi
        .fn()
        .mockResolvedValue([
          { name: "beta", category: "x", description: "B", path: "/s/beta" },
        ]),
      setSkillEnabled,
    });
    render(<TweaksPanel />);

    expect(await screen.findByText("Active skills")).toBeTruthy();
    expect(await screen.findByText("alpha")).toBeTruthy();
    expect(await screen.findByText("beta")).toBeTruthy();

    // "beta" is in the disabled list → enabling it sends enable=true.
    fireEvent.click(screen.getByLabelText("beta"));
    await waitFor(() =>
      expect(setSkillEnabled).toHaveBeenCalledWith("/s/beta", true),
    );
  });

  it("self-hides when the skill IPC is unavailable (remote mode)", async () => {
    stubApi({
      listSkins: vi.fn().mockResolvedValue([]),
      listInstalledSkills: vi.fn().mockRejectedValue(new Error("remote")),
      listDisabledSkills: vi.fn().mockRejectedValue(new Error("remote")),
    });
    render(<TweaksPanel />);

    // Storage still renders; the skills section never appears.
    expect(await screen.findByText("Storage")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Active skills")).toBeNull());
  });
});
