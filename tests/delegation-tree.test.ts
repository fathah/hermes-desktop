import { describe, it, expect } from "vitest";
import {
  initDelegationState,
  applyDelegateEvent,
  buildTree,
  MAX_CONCURRENT_CHILDREN,
  type DelegateEvent,
  type DelegationState,
} from "../src/shared/delegation";

function feed(events: DelegateEvent[]): DelegationState {
  let s = initDelegationState();
  for (const e of events) s = applyDelegateEvent(s, e);
  return s;
}

describe("applyDelegateEvent / buildTree", () => {
  it("builds a parent→children tree", () => {
    const s = feed([
      { id: "root", status: "running", goal: "orchestrate", depth: 0 },
      {
        id: "c1",
        parentId: "root",
        status: "running",
        goal: "search",
        depth: 1,
      },
      { id: "c2", parentId: "root", status: "done", goal: "read", depth: 1 },
    ]);
    const tree = buildTree(s);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("root");
    expect(tree[0].children.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
  });

  it("handles out-of-order events (child before parent)", () => {
    const s = feed([
      { id: "c1", parentId: "root", status: "running", depth: 1 },
      { id: "root", status: "running", depth: 0 },
    ]);
    const tree = buildTree(s);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("root");
    expect(tree[0].children[0].id).toBe("c1");
  });

  it("updates status on a later event for the same id", () => {
    const s = feed([
      { id: "x", status: "running" },
      { id: "x", status: "done" },
    ]);
    expect(s.nodes["x"].status).toBe("done");
  });

  it("normalizes status synonyms", () => {
    const s = feed([
      { id: "a", status: "completed" },
      { id: "b", status: "failed" },
      { id: "c", status: "weird" },
    ]);
    expect(s.nodes["a"].status).toBe("done");
    expect(s.nodes["b"].status).toBe("error");
    expect(s.nodes["c"].status).toBe("running");
  });

  it("caps rendered children at MAX_CONCURRENT_CHILDREN", () => {
    const events: DelegateEvent[] = [
      { id: "root", status: "running", depth: 0 },
    ];
    for (let i = 0; i < MAX_CONCURRENT_CHILDREN + 2; i++) {
      events.push({
        id: `c${i}`,
        parentId: "root",
        status: "running",
        depth: 1,
      });
    }
    const tree = buildTree(feed(events));
    expect(tree[0].children.length).toBe(MAX_CONCURRENT_CHILDREN);
  });

  it("does not render beyond MAX_DEPTH", () => {
    const s = feed([
      { id: "r", status: "running", depth: 0 },
      { id: "d1", parentId: "r", status: "running", depth: 1 },
      { id: "d2", parentId: "d1", status: "running", depth: 2 },
      { id: "d3", parentId: "d2", status: "running", depth: 3 },
    ]);
    const tree = buildTree(s);
    // r → d1 → d2 (depth 2) rendered; d3 (depth 3) pruned
    const d2 = tree[0].children[0].children[0];
    expect(d2.id).toBe("d2");
    expect(d2.children).toEqual([]);
  });
});
