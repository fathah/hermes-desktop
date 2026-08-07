import { describe, expect, it } from "vitest";
import { matchesSessionFilters, sessionCategoryForSource } from "./Sessions";

describe("session metadata filters", () => {
  it.each(["cron", "scheduled:daily", "curator", "background_job"])(
    "classifies %s as automation",
    (source) => {
      expect(sessionCategoryForSource(source)).toBe("automation");
    },
  );

  it.each(["desktop", "tui", "telegram", "api_server"])(
    "classifies %s as chat",
    (source) => {
      expect(sessionCategoryForSource(source)).toBe("chats");
    },
  );

  it("combines the type and multi-source filters", () => {
    const sources = new Set(["desktop", "telegram"]);
    expect(matchesSessionFilters({ source: "desktop" }, "chats", sources)).toBe(
      true,
    );
    expect(matchesSessionFilters({ source: "tui" }, "chats", sources)).toBe(
      false,
    );
    expect(matchesSessionFilters({ source: "cron" }, "chats", sources)).toBe(
      false,
    );
    expect(matchesSessionFilters({ source: "cron" }, "all", new Set())).toBe(
      true,
    );
  });
});
