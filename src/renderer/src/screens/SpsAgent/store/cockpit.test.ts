// cockpit.test.ts — the customizable cockpit dashboard layout: reorder, resize,
// add/remove widgets, reset, and localStorage round-trip (jsdom).
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "./index";
import { loadCockpit, saveCockpit } from "./slices/cockpit";
import type { CockpitWidget } from "./storeTypes";

afterEach(() => {
  localStorage.clear();
  useStore.getState().resetCockpit();
});

describe("cockpit persistence", () => {
  it("seeds operator widgets first for a new cockpit", () => {
    expect(loadCockpit().slice(0, 6)).toEqual([
      { kind: "operatorTasks", span: 2 },
      { kind: "operatorInbox", span: 1 },
      { kind: "operatorBrief", span: 1 },
      { kind: "operatorApprovals", span: 1 },
      { kind: "operatorUpdates", span: 2 },
      { kind: "equityAlerts", span: 1 },
    ]);
  });

  it("round-trips and falls back to defaults on garbage", () => {
    const layout: CockpitWidget[] = [
      { kind: "ask", span: 2 },
      { kind: "glance", span: 1 },
    ];
    saveCockpit(layout);
    expect(loadCockpit()).toEqual(layout);

    localStorage.setItem("sps-agent-cockpit-v1", "not json");
    expect(loadCockpit().length).toBeGreaterThan(0); // default layout

    localStorage.setItem(
      "sps-agent-cockpit-v1",
      JSON.stringify([
        { kind: "nope", span: 9 },
        { kind: "ask", span: 3 },
      ]),
    );
    // unknown kind dropped; out-of-range span clamps to 1
    expect(loadCockpit()).toEqual([{ kind: "ask", span: 1 }]);
  });
});

describe("cockpit mutations", () => {
  it("reorders widgets", () => {
    useStore.setState({
      cockpit: [
        { kind: "quick", span: 2 },
        { kind: "glance", span: 1 },
        { kind: "ask", span: 1 },
      ],
    });
    useStore.getState().reorderCockpit(0, 2);
    expect(useStore.getState().cockpit.map((w) => w.kind)).toEqual([
      "glance",
      "ask",
      "quick",
    ]);
  });

  it("sets a widget span, adds, and removes", () => {
    useStore.setState({ cockpit: [{ kind: "quick", span: 1 }] });
    useStore.getState().setCockpitSpan(0, 2);
    expect(useStore.getState().cockpit[0].span).toBe(2);

    useStore.getState().addCockpitWidget("notes");
    expect(useStore.getState().cockpit.map((w) => w.kind)).toEqual([
      "quick",
      "notes",
    ]);

    useStore.getState().removeCockpitWidget(0);
    expect(useStore.getState().cockpit.map((w) => w.kind)).toEqual(["notes"]);
  });
});
