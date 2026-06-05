import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../src/renderer/src/screens/SpsAgent/store";

// ensureSourcesFolder: ingested PDFs get a dedicated "Sources" home (item 4).
// Identified by title at root, find-or-create, no persisted marker.

function resetWorkspace(): void {
  useStore.setState({
    tree: [{ id: "home", children: [] }],
    meta: { home: { icon: "🏠", title: "Home", cover: null } },
    docs: { home: [] },
    page: "home",
  });
}

describe("ensureSourcesFolder", () => {
  beforeEach(resetWorkspace);

  it("creates a 'Sources' folder at root on first call", () => {
    const id = useStore.getState().ensureSourcesFolder();
    const { tree, meta } = useStore.getState();
    expect(meta[id]?.title).toBe("Sources");
    expect(tree.some((n) => n.id === id)).toBe(true); // root level
  });

  it("reuses the same folder on subsequent calls (no duplicate)", () => {
    const first = useStore.getState().ensureSourcesFolder();
    const second = useStore.getState().ensureSourcesFolder();
    expect(second).toBe(first);
    const roots = useStore
      .getState()
      .tree.filter((n) => useStore.getState().meta[n.id]?.title === "Sources");
    expect(roots).toHaveLength(1);
  });

  it("reuses a pre-existing root page titled 'Sources'", () => {
    useStore.setState((s) => ({
      tree: [...s.tree, { id: "pre", children: [] }],
      meta: { ...s.meta, pre: { icon: "📁", title: "Sources", cover: null } },
      docs: { ...s.docs, pre: [] },
    }));
    expect(useStore.getState().ensureSourcesFolder()).toBe("pre");
  });

  it("makes ingested pages nest inside the Sources folder", () => {
    const sources = useStore.getState().ensureSourcesFolder();
    const child = useStore
      .getState()
      .makePage({ icon: "📄", title: "Doc" }, [], sources);
    const node = useStore.getState().tree.find((n) => n.id === sources);
    expect(node?.children.some((c) => c.id === child)).toBe(true);
  });
});
