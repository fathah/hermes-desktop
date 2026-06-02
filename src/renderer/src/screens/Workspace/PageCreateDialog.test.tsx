import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PageCreateDialog from "./PageCreateDialog";

describe("PageCreateDialog", () => {
  it("submits the selected template content when creating a page", () => {
    const onSubmit = vi.fn();
    render(
      <PageCreateDialog
        mode="create"
        templates={[
          {
            id: "template-prd",
            title: "PRD",
            content: "# PRD\n",
            kind: "page",
          },
        ]}
        onCancel={() => undefined}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Page name"), {
      target: { value: "New PRD" },
    });
    fireEvent.change(screen.getByLabelText("Template"), {
      target: { value: "template-prd" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create page" }));

    expect(onSubmit).toHaveBeenCalledWith("New PRD", "# PRD\n");
  });
});
