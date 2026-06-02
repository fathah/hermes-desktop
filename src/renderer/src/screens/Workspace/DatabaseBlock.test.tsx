import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DatabaseBlock from "./DatabaseBlock";

const content = `hermesType: database
version: 2
title: Tasks
properties:
  name: { type: title }
  status: { type: status, options: [Todo, Done] }
views:
  - id: table
    name: Table
    type: table
    openMode: side
items:
  - id: row-1
    name: Build UI
    status: Done
  - id: row-2
    name: Write docs
    status: Todo
rowPages:
  row-1: "Existing body"
`;

describe("DatabaseBlock", () => {
  it("searches rows, opens side peek, edits row page body, and changes open mode", () => {
    const onChange = vi.fn();
    render(<DatabaseBlock content={content} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Database search"), {
      target: { value: "Build" },
    });

    expect(screen.getByDisplayValue("Build UI")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Write docs")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Build UI" }));
    expect(
      screen.getByRole("dialog", { name: "Build UI" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Row page body"), {
      target: { value: "Updated body" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.stringContaining("Updated body"),
    );

    fireEvent.change(screen.getByLabelText("Open rows as"), {
      target: { value: "full" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.stringContaining("openMode: full"),
    );
  });
});
