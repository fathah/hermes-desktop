import { describe, expect, it } from "vitest";
import { splitDigestRows } from "./digest";
import type { VaultRow } from "../hooks/useNoteIndex";

function row(path: string, props: Record<string, unknown>): VaultRow {
  return { path, title: path, props, mtime: 0 };
}

describe("splitDigestRows", () => {
  it("separates digest-flagged rows from normal ones, preserving order", () => {
    const rows = [
      row("_inbox/a.md", { source: "email" }),
      row("_inbox/b.md", { source: "email", digest: true }),
      row("_inbox/c.md", { source: "note" }),
      row("_inbox/d.md", { source: "email", digest: "true" }),
    ];

    const { normal, digest } = splitDigestRows(rows);

    expect(normal.map((r) => r.path)).toEqual(["_inbox/a.md", "_inbox/c.md"]);
    expect(digest.map((r) => r.path)).toEqual(["_inbox/b.md", "_inbox/d.md"]);
  });

  it("treats absent or false digest props as normal rows", () => {
    const rows = [
      row("_inbox/a.md", {}),
      row("_inbox/b.md", { digest: false }),
      row("_inbox/c.md", { digest: "false" }),
    ];

    const { normal, digest } = splitDigestRows(rows);

    expect(normal).toHaveLength(3);
    expect(digest).toHaveLength(0);
  });
});
