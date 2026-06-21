import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store";
import type { Block } from "../types";
import { DocHeader } from "./DocHeader";

const saveResult = { ok: true, rev: 1, merged: false };

const api = {
  spsExportPage: vi.fn(),
  spsLintVault: vi.fn(),
  spsSave: vi.fn(),
};

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
}

function paragraph(text: string): Block {
  return { id: "block-1", type: "p", text };
}

function setCurrentPage(title: string, blockText: string) {
  useStore.setState({
    page: "entry",
    tree: [{ id: "entry", children: [] }],
    meta: {
      entry: {
        icon: "📁",
        title,
        cover: null,
      },
    },
    docs: {
      entry: [paragraph(blockText)],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  installApi();
  api.spsExportPage.mockResolvedValue(true);
  api.spsSave.mockResolvedValue(saveResult);
  api.spsLintVault.mockResolvedValue({
    orphans: [],
    stale: [],
    brokenLinks: [],
  });
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  vi.restoreAllMocks();
});

describe("DocHeader health badge", () => {
  it("does not warn on an empty untitled orphan draft", async () => {
    setCurrentPage("Untitled entry", "");
    api.spsLintVault.mockResolvedValue({
      orphans: ["entry.md"],
      stale: [],
      brokenLinks: [],
    });

    render(<DocHeader />);

    await waitFor(() => expect(api.spsLintVault).toHaveBeenCalled());
    expect(screen.queryByText("Warning")).toBeNull();
    expect(screen.queryByText("Needs review")).toBeNull();
    expect(screen.queryByText("Unlinked")).toBeNull();
  });

  it("shows orphan-only meaningful pages as a connection suggestion", async () => {
    setCurrentPage("Launch notes", "Positioning draft for the launch.");
    api.spsLintVault.mockResolvedValue({
      orphans: ["entry.md"],
      stale: [],
      brokenLinks: [],
    });

    render(<DocHeader />);

    const badge = await screen.findByRole("button", { name: /Unlinked/ });
    fireEvent.mouseEnter(badge.closest(".doc-health-badge-container")!);

    expect(screen.getByText("Connection Suggestion")).toBeTruthy();
    expect(screen.getByText(/not connected to the graph yet/i)).toBeTruthy();
    expect(screen.queryByText("Warning")).toBeNull();
  });

  it("keeps stale pages as review-worthy health issues", async () => {
    setCurrentPage("Old plan", "A plan that needs a refresh.");
    api.spsLintVault.mockResolvedValue({
      orphans: [],
      stale: ["entry.md"],
      brokenLinks: [],
    });

    render(<DocHeader />);

    const badge = await screen.findByRole("button", { name: /Needs review/ });
    fireEvent.mouseEnter(badge.closest(".doc-health-badge-container")!);

    expect(screen.getByText("Vault Health Issues")).toBeTruthy();
    expect(
      screen.getByText(/has not been edited for over 30 days/i),
    ).toBeTruthy();
    expect(screen.queryByText("Warning")).toBeNull();
  });
});
