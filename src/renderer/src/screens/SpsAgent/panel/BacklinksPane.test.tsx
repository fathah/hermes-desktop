import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BacklinksPane } from "./BacklinksPane";
import { useStore } from "../store";
import type { PageMeta, TreeNode } from "../types";

function stubApi(overrides: Record<string, unknown>): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = overrides;
}

function meta(title: string): PageMeta {
  return { icon: "📄", title, cover: null };
}

const tree: TreeNode[] = [
  { id: "home", children: [{ id: "alpha", children: [] }] },
];

beforeEach(() => {
  useStore.setState({
    tree,
    meta: { home: meta("Home"), alpha: meta("Alpha") },
    page: "home",
  });
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  vi.restoreAllMocks();
});

describe("BacklinksPane", () => {
  it("surfaces relation, embed, and block-ref metadata for explicit backlinks", async () => {
    stubApi({
      spsIndexBacklinkDetails: vi.fn().mockResolvedValue([
        {
          source: "alpha.md",
          target: "home.md",
          type: "advisor",
          kind: "embed",
          targetBlockId: "b1",
        },
      ]),
      spsFindUnlinkedMentions: vi.fn().mockResolvedValue([]),
    });

    render(<BacklinksPane />);

    expect(await screen.findByText("Alpha")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("advisor")).toBeTruthy());
    expect(screen.getByText("embed")).toBeTruthy();
    expect(screen.getByText("block")).toBeTruthy();
  });
});
