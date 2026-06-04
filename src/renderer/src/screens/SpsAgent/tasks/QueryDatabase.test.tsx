// QueryDatabase.test.tsx — S4: the folder-backed query database + inline form.
// IPC is stubbed; we assert rows render from the index and the form/delete write
// the right row-files.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryDatabase } from "./QueryDatabase";
import type { Block } from "../types";

function stubApi(overrides: Record<string, unknown>): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = overrides;
}

const block: Block = { id: "b1", type: "database", text: "", source: "db1" };

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  vi.restoreAllMocks();
});

describe("QueryDatabase", () => {
  it("renders rows queried from the index", async () => {
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
    const cell = await screen.findByText("Row One");
    // The status renders in the same row as the title (a <td>, not the form select).
    const statusCell = cell.closest("tr")?.querySelector("td:nth-child(2)");
    expect(statusCell?.textContent).toBe("doing");
  });

  it("shows an empty state when there are no rows", async () => {
    stubApi({ spsIndexQuery: vi.fn().mockResolvedValue([]) });
    render(<QueryDatabase block={block} />);
    expect(await screen.findByText("No rows yet")).toBeTruthy();
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

  it("deletes a row by id", async () => {
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
});
