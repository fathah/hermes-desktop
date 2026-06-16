import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentStudioSurface } from "./ContentStudioSurface";
import type { PageMeta, TreeNode } from "../types";

const store = vi.hoisted(() => ({
  tree: [] as TreeNode[],
  meta: {} as Record<string, PageMeta>,
  makePage: vi.fn(),
  selectPage: vi.fn(),
  setSurface: vi.fn(),
  flash: vi.fn(),
}));
const api = vi.hoisted(() => ({
  spsExportRow: vi.fn(),
  spsIndexQuery: vi.fn(),
  spsReadRow: vi.fn(),
  spsListAssistantRecipes: vi.fn(),
  spsCreateAssistantRecipe: vi.fn(),
  spsRunAssistantRecipe: vi.fn(),
  spsSaveAssistantRecipeRun: vi.fn(),
  createLearningProposal: vi.fn(),
  spsCreateVaultProposal: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

beforeEach(() => {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
  store.tree = [];
  store.meta = {};
  store.makePage.mockReset();
  store.selectPage.mockReset();
  store.setSurface.mockReset();
  store.flash.mockReset();
  store.makePage.mockImplementation(
    () => `pg-${store.makePage.mock.calls.length}`,
  );
  api.spsExportRow.mockResolvedValue(true);
  api.spsIndexQuery.mockResolvedValue([]);
  api.spsReadRow.mockResolvedValue(null);
  api.spsListAssistantRecipes.mockResolvedValue([]);
  api.spsCreateAssistantRecipe.mockResolvedValue({
    ok: true,
    recipe: { id: "recipe-content", kind: "content-writer", enabled: true },
  });
  api.spsRunAssistantRecipe.mockResolvedValue({
    ok: true,
    run: {
      id: "assistant-run-1",
      resultText: `Variant A
hookRoute: proof-led
draftText: First sourced draft.
sourceNotes: Uses the source.
assetBrief: Workflow screenshot.
disclosureNotes: None.

Variant B
hookRoute: checklist
draftText: Second sourced draft.
sourceNotes: Uses the source.
assetBrief: Checklist visual.
disclosureNotes: None.

Variant C
hookRoute: contrarian
draftText: Third sourced draft.
sourceNotes: Uses the source.
assetBrief: Diagram.
disclosureNotes: None.`,
    },
  });
  api.spsSaveAssistantRecipeRun.mockResolvedValue({ ok: true });
  api.createLearningProposal.mockResolvedValue({ ok: true });
  api.spsCreateVaultProposal.mockResolvedValue({ id: "proposal-1" });
});

describe("ContentStudioSurface", () => {
  it("creates the first-run workspace pack as SPS pages", async () => {
    render(<ContentStudioSurface />);

    expect(await screen.findByText("Content Studio")).toBeInTheDocument();
    expect(store.makePage).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Content Studio" }),
      expect.any(Array),
      null,
    );
    for (const title of [
      "Ideas",
      "Runs",
      "Drafts",
      "Assets",
      "Published",
      "Post Log",
      "Weekly Review",
    ]) {
      expect(store.makePage).toHaveBeenCalledWith(
        expect.objectContaining({ title }),
        expect.arrayContaining([
          expect.objectContaining({
            type: title === "Weekly Review" ? "p" : "database",
          }),
        ]),
        "pg-1",
      );
    }
  });

  it("backfills pack pages when Sources created the root first", async () => {
    store.tree = [{ id: "content-root", children: [] }];
    store.meta = {
      "content-root": { icon: "CS", title: "Content Studio", cover: null },
    };

    render(<ContentStudioSurface />);

    expect(await screen.findByText("Content Studio")).toBeInTheDocument();
    for (const title of [
      "Ideas",
      "Runs",
      "Drafts",
      "Assets",
      "Published",
      "Post Log",
      "Weekly Review",
    ]) {
      expect(store.makePage).toHaveBeenCalledWith(
        expect.objectContaining({ title }),
        expect.any(Array),
        "content-root",
      );
    }
  });

  it("blocks starting a run for low-score ideas until override is selected", async () => {
    render(<ContentStudioSurface />);

    fireEvent.change(screen.getByLabelText("Idea title"), {
      target: { value: "Thin trend post" },
    });
    fireEvent.change(screen.getByLabelText("Source URL"), {
      target: { value: "https://example.com/post" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Score idea" }));

    expect(await screen.findByText(/Score: 0\/14/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start content run" }));

    expect(
      await screen.findByText(/Score at least 10\/14/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Override low score"));
    fireEvent.click(screen.getByRole("button", { name: "Start content run" }));

    await waitFor(() =>
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "content-runs",
        expect.stringContaining("content-run-run-thin-trend-post"),
        expect.stringContaining('type: "content-run"'),
      ),
    );
  });

  it("generates three draft rows through the review-first assistant recipe", async () => {
    render(<ContentStudioSurface />);

    fireEvent.change(screen.getByLabelText("Idea title"), {
      target: { value: "Proof-led setup" },
    });
    fireEvent.change(screen.getByLabelText("Source URL"), {
      target: { value: "https://example.com/source" },
    });
    fireEvent.click(screen.getByLabelText("Override low score"));
    fireEvent.click(screen.getByRole("button", { name: "Start content run" }));

    await waitFor(() => expect(api.spsExportRow).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Generate variants" }));

    await waitFor(() => {
      expect(api.spsRunAssistantRecipe).toHaveBeenCalledWith(
        "recipe-content",
        expect.stringContaining("Variant A"),
        "default",
      );
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "content-drafts",
        expect.stringContaining("draft-variant"),
        expect.stringContaining('hookRoute: "proof-led"'),
      );
    });
    expect(
      await screen.findByText(/Saved 3 draft variants/),
    ).toBeInTheDocument();
  });

  it("blocks final approval for unsupported claims and persists publish packets", async () => {
    render(<ContentStudioSurface />);

    fireEvent.change(screen.getByLabelText("Final draft"), {
      target: { value: "This free workflow always gets 300K views." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Approve final draft" }),
    );

    expect(await screen.findByText(/Support claims/)).toBeInTheDocument();
    expect(api.spsExportRow).not.toHaveBeenCalledWith(
      "content-published",
      expect.any(String),
      expect.any(String),
    );

    fireEvent.change(screen.getByLabelText("Source URL"), {
      target: { value: "https://example.com/proof" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Approve final draft" }),
    );

    await waitFor(() =>
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "content-published",
        expect.stringContaining("published-post"),
        expect.stringContaining('type: "published-post"'),
      ),
    );
  });

  it("computes BM/Like when analytics are logged", async () => {
    render(<ContentStudioSurface />);

    fireEvent.change(screen.getByLabelText("Analytics slug"), {
      target: { value: "agent-reach-setup" },
    });
    fireEvent.change(screen.getByLabelText("Bookmarks"), {
      target: { value: "45" },
    });
    fireEvent.change(screen.getByLabelText("Likes"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log analytics" }));

    expect(await screen.findByText("BM/Like 1.50")).toBeInTheDocument();
    expect(api.spsExportRow).toHaveBeenCalledWith(
      "content-analytics",
      expect.stringContaining("analytics-snapshot-agent-reach-setup"),
      expect.stringContaining("bmLike: 1.5"),
    );
  });

  it("queues weekly review proposals without applying them", async () => {
    api.spsIndexQuery
      .mockResolvedValueOnce([
        {
          path: "content-analytics/a.md",
          title: "winner",
          props: {
            slug: "winner",
            bmLike: 2,
            bookmarks: 20,
            likes: 10,
            hookRoute: "proof-led",
          },
          mtime: 1,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    render(<ContentStudioSurface />);

    fireEvent.click(screen.getByRole("button", { name: "Run weekly review" }));

    await waitFor(() => {
      expect(api.createLearningProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "memory",
          body: expect.stringContaining("proof-led"),
        }),
        "default",
      );
      expect(api.spsCreateVaultProposal).toHaveBeenCalled();
    });
  });
});
