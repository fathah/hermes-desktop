// chips.test.tsx — the delegated-row agent badge. Presentational: it turns a raw
// Kanban status into a chip, and renders nothing when the status is unknown so a
// non-delegated or unreachable row stays clean.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { KanbanStatusBadge } from "./chips";

describe("KanbanStatusBadge", () => {
  it("renders the agent's live status as a palette-aligned chip", () => {
    const { container } = render(<KanbanStatusBadge status="running" />);
    const chip = container.querySelector(".chip");
    expect(chip).not.toBeNull();
    expect(chip?.className).toContain("s-doing");
    expect(container.textContent).toContain("Running");
  });

  it("renders nothing for an unknown or absent status", () => {
    expect(
      render(<KanbanStatusBadge status="archived" />).container,
    ).toBeEmptyDOMElement();
    expect(
      render(<KanbanStatusBadge status={undefined} />).container,
    ).toBeEmptyDOMElement();
  });
});
