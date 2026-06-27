// TweaksPanel.test.tsx — F5: the Storage settings section shows the right
// control per authoritative mode. IPC is stubbed; storage mode lives in
// localStorage (jsdom).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

describe("TweaksPanel — Learning split", () => {
  it("does not duplicate skill management", async () => {
    render(<TweaksPanel />);

    expect(await screen.findByText("Storage")).toBeTruthy();
    expect(screen.queryByText("Active skills")).toBeNull();
  });
});
