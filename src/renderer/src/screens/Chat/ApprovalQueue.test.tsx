import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "./ApprovalQueue";
import type { ApprovalState } from "../../../../shared/approval";

// LOW-5: the approval queue must be announced to assistive tech. Without a live
// region + dialog roles, screen-reader users never learn a dangerous command is
// waiting on them.
describe("ApprovalQueue accessibility", () => {
  it("renders nothing when the queue is empty", () => {
    const state: ApprovalState = { queue: [], safe: [] };
    const { container } = render(
      <ApprovalQueue state={state} onRespond={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("exposes a live region and an alertdialog per pending approval", () => {
    const state: ApprovalState = {
      queue: [
        { id: "a1", command: "rm -rf build", patternKey: "rm", enqueuedAt: 0 },
      ],
      safe: [],
    };
    const { getByRole } = render(
      <ApprovalQueue state={state} onRespond={vi.fn()} />,
    );

    const region = getByRole("region", { name: "Command approvals" });
    expect(region.getAttribute("aria-live")).toBe("assertive");

    const card = getByRole("alertdialog");
    expect(card.getAttribute("aria-label")).toContain("rm -rf build");
  });
});
