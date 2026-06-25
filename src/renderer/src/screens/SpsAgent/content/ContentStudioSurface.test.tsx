import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentStudioSurface } from "./ContentStudioSurface";
import type { ContentIdea } from "../../../lib/content-studio";
import type { PageMeta, TreeNode } from "../types";

const store = vi.hoisted(() => ({
  tree: [] as TreeNode[],
  meta: {} as Record<string, PageMeta>,
  makePage: vi.fn(),
  selectPage: vi.fn(),
  setSurface: vi.fn(),
  flash: vi.fn(),
  pendingContentStudioIdea: null as ContentIdea | null,
  clearPendingContentStudioIdea: vi.fn(),
}));
const api = vi.hoisted(() => ({
  spsExportRow: vi.fn(),
  spsIndexQuery: vi.fn(),
  spsReadRow: vi.fn(),
  spsListAssistantRecipes: vi.fn(),
  spsCreateAssistantRecipe: vi.fn(),
  spsRunAssistantRecipe: vi.fn(),
  spsSaveAssistantRecipeRun: vi.fn(),
  spsCuratedBrief: vi.fn(),
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
  store.pendingContentStudioIdea = null;
  store.clearPendingContentStudioIdea.mockReset();
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
  api.spsCuratedBrief.mockResolvedValue({
    kind: "chat",
    reply: [
      [
        "## Perspectives",
        "Operators need evidence before drafting.",
        "",
        "## Brief",
        "A curated brief turns sources into a draftable angle.",
        "",
        "## Sources",
        "- [Source](https://example.com/source)",
      ].join("\n"),
    ],
  });
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

  it("prefills scoring and run generation from a captured source handoff", async () => {
    store.pendingContentStudioIdea = {
      id: "idea-prefilled-source",
      title: "Prefilled source idea",
      sourceUrls: ["https://example.com/source"],
      audience: "founders",
      angle: "Turn this source into a concrete operator checklist.",
      createdAt: "2026-06-17",
      updatedAt: "2026-06-17",
      status: "captured",
      capturedFrom: "source-preview",
      rubric: {
        bookmarkability: 2,
        proof: 2,
        immediateUse: 2,
        audienceClarity: 2,
        reproducibility: 1,
        hookStrength: 1,
        originality: 1,
      },
    };

    render(<ContentStudioSurface />);

    expect(
      await screen.findByDisplayValue("Prefilled source idea"),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("https://example.com/source"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("founders")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(
        "Turn this source into a concrete operator checklist.",
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Score: 11\/14/)).toBeInTheDocument();
    expect(store.clearPendingContentStudioIdea).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start content run" }));

    await waitFor(() =>
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "content-runs",
        expect.stringContaining("content-run-run-prefilled-source-idea"),
        expect.stringContaining("https://example.com/source"),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate variants" }));

    await waitFor(() =>
      expect(api.spsRunAssistantRecipe).toHaveBeenCalledWith(
        "recipe-content",
        expect.stringContaining("Prefilled source idea"),
        "default",
      ),
    );
  });

  it("generates a Curated Brief from a captured idea before starting a run", async () => {
    store.pendingContentStudioIdea = {
      id: "idea-curated-source",
      title: "Curated source idea",
      sourceUrls: ["https://example.com/source"],
      audience: "operators",
      angle: "Initial angle.",
      createdAt: "2026-06-17",
      updatedAt: "2026-06-17",
      status: "captured",
      capturedFrom: "source-preview",
      rubric: {
        bookmarkability: 2,
        proof: 2,
        immediateUse: 2,
        audienceClarity: 2,
        reproducibility: 1,
        hookStrength: 1,
        originality: 1,
      },
    };

    render(<ContentStudioSurface />);

    expect(
      await screen.findByDisplayValue("Curated source idea"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /generate curated brief/i }),
    );

    await waitFor(() =>
      expect(api.spsCuratedBrief).toHaveBeenCalledWith(
        "Curated source idea",
        expect.stringContaining("https://example.com/source"),
        "default",
      ),
    );
    expect(
      await screen.findByDisplayValue(/curated brief turns sources/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start content run" }));

    await waitFor(() =>
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "content-runs",
        expect.stringContaining("content-run-run-curated-source-idea"),
        expect.stringContaining("https://example.com/source"),
      ),
    );
  });

  it("blocks starting a run for low-score ideas until override is selected", async () => {
    render(<ContentStudioSurface />);

    fireEvent.change(screen.getByLabelText("Idea title"), {
      target: { value: "Thin trend post" },
    });
    fireEvent.change(screen.getByLabelText("Source URLs"), {
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

  it("stores multiple manual source URLs on the content run row", async () => {
    render(<ContentStudioSurface />);

    fireEvent.change(screen.getByLabelText("Idea title"), {
      target: { value: "Multi-source manual idea" },
    });
    fireEvent.change(screen.getByLabelText("Source URLs"), {
      target: {
        value:
          "https://one.example/source\nhttps://two.example/source, https://one.example/source",
      },
    });
    fireEvent.click(screen.getByLabelText("Override low score"));
    fireEvent.click(screen.getByRole("button", { name: "Start content run" }));

    await waitFor(() =>
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "content-runs",
        expect.stringContaining("content-run-run-multi-source-manual-idea"),
        expect.stringContaining("https://two.example/source"),
      ),
    );
    const markdown = String(api.spsExportRow.mock.calls.at(-1)?.[2] ?? "");
    expect(markdown).toContain("https://one.example/source");
    expect(markdown).toContain("https://two.example/source");
  });

  it("generates three draft rows through the review-first assistant recipe", async () => {
    render(<ContentStudioSurface />);

    fireEvent.change(screen.getByLabelText("Idea title"), {
      target: { value: "Proof-led setup" },
    });
    fireEvent.change(screen.getByLabelText("Source URLs"), {
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

    fireEvent.change(screen.getByLabelText("Source URLs"), {
      target: { value: "https://example.com/proof" },
    });
    fireEvent.change(screen.getByLabelText("Evidence source URL"), {
      target: { value: "https://example.com/proof" },
    });
    fireEvent.change(screen.getByLabelText("Evidence snippet"), {
      target: {
        value: "The workflow reached 300K views in a sourced example.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Attach evidence" }));
    await waitFor(() =>
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "content-evidence",
        expect.any(String),
        expect.stringContaining("300K views"),
      ),
    );
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

  it("renders dashboard counts from row-backed Content Studio folders", async () => {
    api.spsIndexQuery.mockImplementation((query: { scope?: string }) => {
      if (query.scope === "content-ideas") {
        return Promise.resolve([
          {
            path: "content-ideas/captured.md",
            title: "Captured idea",
            props: { status: "captured", score: 0 },
            mtime: 1,
          },
          {
            path: "content-ideas/ready.md",
            title: "Ready idea",
            props: { status: "scored", score: 12 },
            mtime: 1,
          },
        ]);
      }
      if (query.scope === "content-runs") {
        return Promise.resolve([
          {
            path: "content-runs/run.md",
            title: "Run",
            props: { id: "run-1", status: "drafting" },
            mtime: 1,
          },
        ]);
      }
      if (query.scope === "content-drafts") {
        return Promise.resolve([
          {
            path: "content-drafts/draft.md",
            title: "Draft",
            props: { runId: "run-2", status: "needs-review" },
            mtime: 1,
          },
        ]);
      }
      if (query.scope === "content-published") {
        return Promise.resolve([
          {
            path: "content-published/ready.md",
            title: "Ready",
            props: { slug: "ready", status: "ready" },
            mtime: 1,
          },
        ]);
      }
      if (query.scope === "content-analytics") {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    render(<ContentStudioSurface />);

    expect(await screen.findByText("Content cockpit")).toBeInTheDocument();
    expect(await screen.findByText("Captured ideas")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Captured ideas\s+1/ }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Ready to publish")).toBeInTheDocument();
  });

  it("requires evidence before approving detected claims", async () => {
    render(<ContentStudioSurface />);

    fireEvent.change(screen.getByLabelText("Final draft"), {
      target: { value: "This workflow always saves 30 minutes." },
    });
    fireEvent.change(screen.getByLabelText("Source URLs"), {
      target: { value: "https://example.com/proof" },
    });
    const callCountBeforeApproval = api.spsExportRow.mock.calls.length;
    fireEvent.click(
      screen.getByRole("button", { name: "Approve final draft" }),
    );

    expect(await screen.findByText(/Attach evidence/)).toBeInTheDocument();
    expect(
      api.spsExportRow.mock.calls
        .slice(callCountBeforeApproval)
        .some(([folder]) => folder === "content-published"),
    ).toBe(false);

    fireEvent.change(screen.getByLabelText("Evidence source URL"), {
      target: { value: "https://example.com/proof" },
    });
    fireEvent.change(screen.getByLabelText("Evidence snippet"), {
      target: { value: "A benchmark showed this workflow saves 30 minutes." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Attach evidence" }));

    await waitFor(() =>
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "content-evidence",
        expect.stringContaining("content-evidence"),
        expect.stringContaining("A benchmark showed"),
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Approve final draft" }),
    );

    await waitFor(() =>
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "content-published",
        expect.any(String),
        expect.stringContaining('status: "ready"'),
      ),
    );
  });

  it("marks publish packets as published and logs historical analytics", async () => {
    render(<ContentStudioSurface />);

    fireEvent.change(screen.getByLabelText("Manual publish URL"), {
      target: { value: "https://x.com/example/status/1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark published" }));

    await waitFor(() =>
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "content-published",
        expect.stringContaining("published-post"),
        expect.stringContaining('status: "published"'),
      ),
    );

    fireEvent.change(screen.getByLabelText("Analytics slug"), {
      target: { value: "agent-reach-setup" },
    });
    fireEvent.change(screen.getByLabelText("Views"), {
      target: { value: "1000" },
    });
    fireEvent.change(screen.getByLabelText("Bookmarks"), {
      target: { value: "45" },
    });
    fireEvent.change(screen.getByLabelText("Likes"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Comments"), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log analytics" }));

    expect(await screen.findByText("BM/Like 1.50")).toBeInTheDocument();
    expect(await screen.findByText("Bookmark rate 4.50%")).toBeInTheDocument();
  });

  it("applies playbook defaults without bypassing scoring", async () => {
    render(<ContentStudioSurface />);

    fireEvent.change(screen.getByLabelText("Creator playbook"), {
      target: { value: "ai-tool-teardown" },
    });

    expect(screen.getByLabelText("Bookmarkable")).toHaveValue(2);
    expect(screen.getByLabelText("Hard proof")).toHaveValue(2);
    expect(screen.getByText(/Score: 12\/14/)).toBeInTheDocument();
  });
});
