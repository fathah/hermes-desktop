// GraphView.test.tsx — F4: the local wikilink graph surface. The index IPC is
// stubbed and the store is seeded; we assert nodes/edges render and that
// clicking a node opens that page on the doc surface.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GraphView } from "./GraphView";
import { useStore } from "../store";
import type { PageMeta, TreeNode } from "../types";

function stubApi(overrides: Record<string, unknown>): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = overrides;
}

function meta(title: string): PageMeta {
  return { icon: "📄", title, cover: null };
}

const tree: TreeNode[] = [
  { id: "home", children: [{ id: "tasks", children: [] }] },
];

beforeEach(() => {
  useStore.setState({
    tree,
    meta: { home: meta("Home"), tasks: meta("Tasks") },
    page: "home",
    surface: "graph",
  });
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  vi.restoreAllMocks();
});

describe("GraphView", () => {
  it("renders a node per page and an edge per resolved link", async () => {
    stubApi({
      spsIndexLinks: vi
        .fn()
        .mockResolvedValue([
          { source: "home.md", target: "tasks.md", type: "advisor" },
        ]),
    });
    render(<GraphView />);
    expect(await screen.findByText("Home")).toBeTruthy();
    expect(screen.getByText("Tasks")).toBeTruthy();
    // Header summary updates once the (async) edge arrives.
    await waitFor(() => expect(screen.getByText(/1 link$/)).toBeTruthy());
    expect(screen.getByText("advisor")).toBeTruthy();
  });

  it("opens the clicked page on the doc surface", async () => {
    stubApi({ spsIndexLinks: vi.fn().mockResolvedValue([]) });
    render(<GraphView />);
    fireEvent.click(await screen.findByRole("button", { name: "Tasks" }));
    expect(useStore.getState().page).toBe("tasks");
    expect(useStore.getState().surface).toBe("doc");
  });

  it("shows an empty state when there are no pages", () => {
    useStore.setState({ tree: [], meta: {} });
    stubApi({ spsIndexLinks: vi.fn().mockResolvedValue([]) });
    render(<GraphView />);
    expect(screen.getByText("No pages to graph yet.")).toBeTruthy();
  });
});
