import { describe, expect, it } from "vitest";
import { groupSessionsByWorkspace } from "./SidebarRecentSessions";

describe("sidebar project grouping", () => {
  it("keeps registered projects visible before they have chats", () => {
    const grouped = groupSessionsByWorkspace(
      [{ id: "plain", title: "Loose chat", contextFolder: null }],
      [{ path: "/work/hermes", name: "Hermes Desktop" }],
    );

    expect(grouped.projectGroups).toEqual([
      { path: "/work/hermes", name: "Hermes Desktop", sessions: [] },
    ]);
    expect(grouped.chats).toHaveLength(1);
  });

  it("adds session-only folders as projects for backward compatibility", () => {
    const grouped = groupSessionsByWorkspace([
      { id: "linked", title: "Fix sidebar", contextFolder: "/work/app" },
    ]);

    expect(grouped.projectGroups[0]).toMatchObject({
      path: "/work/app",
      name: "app",
    });
    expect(grouped.projectGroups[0].sessions[0].id).toBe("linked");
  });
});
