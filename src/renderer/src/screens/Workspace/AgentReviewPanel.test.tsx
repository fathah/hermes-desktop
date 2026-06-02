import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AgentReviewPanel from "./AgentReviewPanel";

describe("AgentReviewPanel", () => {
  it("accepts and rejects individual hunks", () => {
    const onAcceptHunk = vi.fn();
    const onRejectHunk = vi.fn();
    render(
      <AgentReviewPanel
        proposals={[
          {
            id: "proposal-1",
            path: "page.md",
            baseContent: "Before",
            proposedContent: "After",
            createdAt: 1,
            hunks: [
              {
                id: "hunk-1",
                before: "Before",
                after: "After",
                status: "pending",
              },
            ],
          },
        ]}
        onAccept={() => undefined}
        onReject={() => undefined}
        onAcceptHunk={onAcceptHunk}
        onRejectHunk={onRejectHunk}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept hunk hunk-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject hunk hunk-1" }));

    expect(onAcceptHunk).toHaveBeenCalledWith("proposal-1", "hunk-1");
    expect(onRejectHunk).toHaveBeenCalledWith("proposal-1", "hunk-1");
  });
});
