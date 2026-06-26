// ListView.test.tsx — F1: the delegated-row agent badge is wired through the
// list view. A row shows its live Kanban status only when it was routed to the
// agent (has a delegatedTo id); an ordinary row stays clean.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListView } from "./ListView";
import type { Task } from "../types";

function task(overrides: Partial<Task>): Task {
  return {
    id: "r1",
    title: "Patrol log",
    status: "doing",
    prio: "med",
    who: "you",
    due: "",
    est: "",
    ...overrides,
  };
}

describe("ListView agent badge", () => {
  it("shows the live agent status on a delegated row", () => {
    render(
      <ListView
        tasks={[task({ delegatedTo: "k-1" })]}
        onOpenTask={() => {}}
        cycle={() => {}}
        statusFor={(id) => (id === "k-1" ? "running" : undefined)}
      />,
    );
    expect(screen.getByTitle("Agent status: Running")).toBeInTheDocument();
  });

  it("shows no agent badge on a row that was never delegated", () => {
    render(
      <ListView tasks={[task({})]} onOpenTask={() => {}} cycle={() => {}} />,
    );
    expect(screen.queryByTitle(/Agent status/)).toBeNull();
  });
});
