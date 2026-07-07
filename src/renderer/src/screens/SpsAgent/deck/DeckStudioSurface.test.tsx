import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeckProject } from "../../../../../shared/deck-studio";
import { DeckStudioSurface } from "./DeckStudioSurface";
import type { PageMeta, TreeNode } from "../types";

const store = vi.hoisted(() => ({
  tree: [] as TreeNode[],
  meta: {} as Record<string, PageMeta>,
  docs: {
    home: [
      { id: "b1", type: "p", text: "Wallet Club rough launch notes" },
      { id: "b2", type: "p", text: "Scattered budgeting is the problem" },
    ],
  },
  page: "home",
  pendingDeckStudioInput: null as
    | Parameters<typeof createDeckProject>[0]
    | null,
  makePage: vi.fn(),
  flash: vi.fn(),
  clearPendingDeckStudioInput: vi.fn(),
}));

const api = vi.hoisted(() => ({
  deckGenerate: vi.fn(),
  deckSave: vi.fn(),
  deckList: vi.fn(),
  deckRead: vi.fn(),
  deckExportPdf: vi.fn(),
  deckExportPptx: vi.fn(),
  deckOpenExport: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

beforeEach(() => {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
  store.tree = [];
  store.meta = {};
  store.page = "home";
  store.pendingDeckStudioInput = null;
  store.makePage.mockReset();
  store.flash.mockReset();
  store.clearPendingDeckStudioInput.mockReset();
  store.makePage.mockImplementation(
    () => `pg-${store.makePage.mock.calls.length}`,
  );
  api.deckList.mockResolvedValue([]);
  api.deckRead.mockResolvedValue(null);
  api.deckSave.mockResolvedValue({ ok: true, rowId: "deck-project-wallet" });
  api.deckExportPdf.mockResolvedValue({
    ok: true,
    path: "/tmp/deck-project-wallet.pdf",
    notesPath: "/tmp/deck-project-wallet-notes.md",
  });
  api.deckExportPptx.mockResolvedValue({
    ok: true,
    path: "/tmp/deck-project-wallet.pptx",
    notesPath: "/tmp/deck-project-wallet-notes.md",
  });
  api.deckOpenExport.mockResolvedValue({ ok: true });
  api.deckGenerate.mockResolvedValue({
    ok: true,
    mode: "model",
    project: createDeckProject({
      notes:
        "Wallet Club\nSubscription fatigue\nScattered budgeting\nSmart auto-budgeting",
      audience: "seed investors",
      goal: "raise a seed round",
      theme: "investor",
      slideCount: 5,
      createdAt: "2026-06-17T00:00:00.000Z",
    }),
    issues: [],
  });
});

describe("DeckStudioSurface", () => {
  it("opens from navigation context and creates the first-run deck pack", async () => {
    render(<DeckStudioSurface />);

    expect(await screen.findByText("Deck Studio")).toBeInTheDocument();
    expect(store.makePage).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Deck Studio" }),
      expect.any(Array),
      null,
    );
    expect(store.makePage).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Decks" }),
      expect.any(Array),
      "pg-1",
    );
  });

  it("drafts an outline from rough notes and approves it into slide previews", async () => {
    render(<DeckStudioSurface />);

    fireEvent.change(screen.getByLabelText("Rough notes"), {
      target: {
        value:
          "Wallet Club\nSubscription fatigue\nScattered budgeting\nSmart auto-budgeting",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate outline" }));

    await waitFor(() => expect(api.deckGenerate).toHaveBeenCalled());
    expect(
      await screen.findByText("Generation mode: model"),
    ).toBeInTheDocument();
    expect(await screen.findByText("The Problem")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve outline" }));

    await waitFor(() => expect(api.deckSave).toHaveBeenCalled());
    expect(screen.getByTestId("deck-canvas")).toHaveAttribute(
      "data-theme",
      "investor",
    );
    expect(screen.getAllByText("Wallet Club").length).toBeGreaterThan(0);
  });

  it("switches theme without changing slide content", async () => {
    render(<DeckStudioSurface />);

    fireEvent.change(screen.getByLabelText("Rough notes"), {
      target: { value: "Wallet Club\nSmart auto-budgeting" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate outline" }));
    await screen.findByText("The Problem");
    fireEvent.click(screen.getByRole("button", { name: "Approve outline" }));

    await waitFor(() =>
      expect(screen.getByTestId("deck-canvas")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText("Theme"), {
      target: { value: "research" },
    });

    expect(screen.getByTestId("deck-canvas")).toHaveAttribute(
      "data-theme",
      "research",
    );
    expect(screen.getAllByText("Wallet Club").length).toBeGreaterThan(0);
  });

  it("shows a repair state for invalid generated deck IR", async () => {
    api.deckGenerate.mockResolvedValueOnce({
      ok: false,
      mode: "fallback",
      project: createDeckProject({
        notes: "Broken deck",
        audience: "team",
        goal: "review",
        theme: "investor",
        slideCount: 4,
      }),
      issues: [
        {
          code: "title",
          severity: "blocker",
          path: "slides.0.title",
          message: "Every slide needs a title before export.",
        },
      ],
    });

    render(<DeckStudioSurface />);

    fireEvent.change(screen.getByLabelText("Rough notes"), {
      target: { value: "Broken deck" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate outline" }));

    expect(
      await screen.findByText(/Every slide needs a title/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("deck-canvas")).not.toBeInTheDocument();
  });

  it("prefills the brief from a source handoff", async () => {
    store.pendingDeckStudioInput = {
      notes: "Research brief\nEvidence-backed thesis",
      audience: "partners",
      goal: "explain the opportunity",
      theme: "research",
      slideCount: 7,
      style: "quiet executive research",
      sourceRefs: [
        {
          id: "src-research",
          kind: "research",
          label: "Research brief",
        },
      ],
    };

    render(<DeckStudioSurface />);

    expect(screen.getByLabelText("Rough notes")).toHaveValue(
      "Research brief\nEvidence-backed thesis",
    );
    expect(screen.getByLabelText("Audience")).toHaveValue("partners");
    expect(screen.getByLabelText("Theme")).toHaveValue("research");
    expect(store.clearPendingDeckStudioInput).toHaveBeenCalled();
  });

  it("exports PPTX and can open the latest export", async () => {
    render(<DeckStudioSurface />);

    fireEvent.change(screen.getByLabelText("Rough notes"), {
      target: { value: "Wallet Club\nSmart auto-budgeting" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate outline" }));
    await screen.findByText("The Problem");
    fireEvent.click(screen.getByRole("button", { name: "Approve outline" }));
    await waitFor(() =>
      expect(screen.getByTestId("deck-canvas")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "export" }));
    fireEvent.click(screen.getByRole("button", { name: "Export PPTX" }));

    await waitFor(() => expect(api.deckExportPptx).toHaveBeenCalled());
    expect(await screen.findByText(/PPTX exported:/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open export" }));
    expect(api.deckOpenExport).toHaveBeenCalledWith(
      "/tmp/deck-project-wallet.pptx",
      "default",
    );
  });
});
