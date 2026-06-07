// templates.test.ts — user-saved templates: snapshot a page into a reusable
// template, persist to localStorage, and remove. IPC isn't needed; localStorage
// is jsdom-backed.
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "./index";
import { loadUserTemplates, saveUserTemplates } from "./slices/templates";
import type { UserTemplate } from "./storeTypes";

afterEach(() => {
  localStorage.clear();
  useStore.setState({ userTemplates: [] });
});

describe("user templates persistence", () => {
  it("round-trips through localStorage and drops malformed entries", () => {
    const tpl: UserTemplate = {
      id: "t1",
      emoji: "📝",
      name: "Daily log",
      desc: "Saved from your page",
      blocks: [{ id: "b1", type: "h2", text: "Today" }],
    };
    saveUserTemplates([tpl]);
    expect(loadUserTemplates()).toEqual([tpl]);

    localStorage.setItem(
      "sps-agent-templates-v1",
      JSON.stringify([tpl, { id: "bad" }, null]),
    );
    expect(loadUserTemplates()).toEqual([tpl]); // malformed entries filtered out
  });
});

describe("saveAsTemplate / removeUserTemplate", () => {
  it("snapshots the page's blocks + icon/title into a new template", () => {
    useStore.setState({
      page: "p1",
      docs: { p1: [{ id: "b1", type: "h2", text: "Agenda" }] },
      meta: { p1: { icon: "🗓️", title: "Meeting", cover: null } },
      userTemplates: [],
    });

    useStore.getState().saveAsTemplate("p1");

    const saved = useStore.getState().userTemplates;
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("Meeting");
    expect(saved[0].emoji).toBe("🗓️");
    expect(saved[0].blocks[0].text).toBe("Agenda");
  });

  it("does not save an empty page", () => {
    useStore.setState({ page: "p2", docs: { p2: [] }, userTemplates: [] });
    useStore.getState().saveAsTemplate("p2");
    expect(useStore.getState().userTemplates).toHaveLength(0);
  });

  it("removes a template by id", () => {
    useStore.setState({
      userTemplates: [
        { id: "t1", emoji: "📝", name: "A", desc: "", blocks: [] },
        { id: "t2", emoji: "📄", name: "B", desc: "", blocks: [] },
      ],
    });
    useStore.getState().removeUserTemplate("t1");
    const left = useStore.getState().userTemplates;
    expect(left.map((t) => t.id)).toEqual(["t2"]);
  });
});
