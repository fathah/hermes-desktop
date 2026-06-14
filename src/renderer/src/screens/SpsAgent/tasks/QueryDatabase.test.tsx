// QueryDatabase.test.tsx — S4 + F1: the folder-backed query database renders
// rows through the shared TasksDB views, the form/delete write the right
// row-files, and inline edits write merged frontmatter back to disk. IPC is
// stubbed throughout.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryDatabase } from "./QueryDatabase";
import type { Block } from "../types";

function stubApi(overrides: Record<string, unknown>): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = overrides;
}

const block: Block = { id: "b1", type: "database", text: "", source: "db1" };

function blockWith(view: Block["view"]): Block {
  return { ...block, view };
}

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  vi.restoreAllMocks();
});

describe("QueryDatabase", () => {
  it("renders rows queried from the index (default table view)", async () => {
    stubApi({
      spsIndexQuery: vi.fn().mockResolvedValue([
        {
          path: "db1/r1.md",
          title: "Row One",
          props: { status: "doing" },
          mtime: 1,
        },
      ]),
    });
    render(<QueryDatabase block={block} />);
    expect(await screen.findByText("Row One")).toBeTruthy();
    // Status renders as the shared StatusChip (label, not the raw key).
    expect(screen.getAllByText("In progress")[0]).toBeTruthy();
  });

  it("shows an empty state when there are no rows", async () => {
    stubApi({ spsIndexQuery: vi.fn().mockResolvedValue([]) });
    render(<QueryDatabase block={block} />);
    expect(await screen.findByText("No rows yet")).toBeTruthy();
  });

  it.each([
    ["board", "In progress"],
    ["table", "In progress"],
    ["list", "Row One"],
    ["gallery", "Row One"],
    ["calendar", "Row One"],
  ] as const)("renders the %s view", async (view, expected) => {
    stubApi({
      spsIndexQuery: vi.fn().mockResolvedValue([
        {
          path: "db1/r1.md",
          title: "Row One",
          props: { status: "doing", due: "Jun 9" },
          mtime: 1,
        },
      ]),
    });
    render(<QueryDatabase block={blockWith(view)} />);
    if (expected === "In progress") {
      expect((await screen.findAllByText(expected)).length).toBeGreaterThan(0);
    } else {
      expect(await screen.findByText(expected)).toBeTruthy();
    }
  });

  it("writes a row-file (the Form) on add, with frontmatter from the inputs", async () => {
    const exportRow = vi.fn().mockResolvedValue(true);
    stubApi({
      spsIndexQuery: vi.fn().mockResolvedValue([]),
      spsExportRow: exportRow,
    });
    render(<QueryDatabase block={block} />);
    fireEvent.change(screen.getByPlaceholderText("New row…"), {
      target: { value: "New Task" },
    });
    fireEvent.click(screen.getByText("Add"));
    await waitFor(() => expect(exportRow).toHaveBeenCalledTimes(1));
    const [folder, rowId, markdown] = exportRow.mock.calls[0];
    expect(folder).toBe("db1");
    expect(typeof rowId).toBe("string");
    expect(markdown).toContain('title: "New Task"');
    expect(markdown).toContain('status: "todo"');
  });

  it("does not write an empty row", async () => {
    const exportRow = vi.fn().mockResolvedValue(true);
    stubApi({
      spsIndexQuery: vi.fn().mockResolvedValue([]),
      spsExportRow: exportRow,
    });
    render(<QueryDatabase block={block} />);
    fireEvent.click(screen.getByText("Add"));
    expect(exportRow).not.toHaveBeenCalled();
  });

  it("deletes a row by id (table view)", async () => {
    const deleteRow = vi.fn().mockResolvedValue(true);
    stubApi({
      spsIndexQuery: vi
        .fn()
        .mockResolvedValue([
          { path: "db1/r1.md", title: "Row One", props: {}, mtime: 1 },
        ]),
      spsDeleteRow: deleteRow,
    });
    render(<QueryDatabase block={block} />);
    await screen.findByText("Row One");
    fireEvent.click(screen.getByLabelText("Delete row"));
    await waitFor(() => expect(deleteRow).toHaveBeenCalledWith("db1", "r1"));
  });

  it("writes merged frontmatter on an inline status change (list cycle)", async () => {
    const exportRow = vi.fn().mockResolvedValue(true);
    stubApi({
      spsIndexQuery: vi.fn().mockResolvedValue([
        {
          path: "db1/r1.md",
          title: "Row One",
          props: { status: "todo", region: "north" },
          mtime: 1,
        },
      ]),
      spsExportRow: exportRow,
    });
    render(<QueryDatabase block={blockWith("list")} />);
    await screen.findByText("Row One");
    // The list-view check cycles status todo → doing.
    fireEvent.click(document.querySelector(".lst-row .check") as Element);
    await waitFor(() => expect(exportRow).toHaveBeenCalledTimes(1));
    const [folder, rowId, markdown] = exportRow.mock.calls[0];
    expect(folder).toBe("db1");
    expect(rowId).toBe("r1");
    expect(markdown).toContain('status: "doing"');
    // Merge preserves title + unknown props rather than reconstructing them.
    expect(markdown).toContain('title: "Row One"');
    expect(markdown).toContain('region: "north"');
  });

  it("persists the view switch via the update callback", async () => {
    const update = vi.fn();
    stubApi({ spsIndexQuery: vi.fn().mockResolvedValue([]) });
    render(<QueryDatabase block={block} update={update} />);
    fireEvent.click(await screen.findByTitle("Switch Database View"));
    fireEvent.click(await screen.findByText("Board"));
    expect(update).toHaveBeenCalledWith({ view: "board" });
  });
});
