import { beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_LAST_VIEW_KEY,
  normalizeAdminView,
  readLastAdminView,
  writeLastAdminView,
} from "./openSettings";

describe("openSettings view normalization", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("maps legacy admin tabs to task-based Control Center views", () => {
    expect(normalizeAdminView("providers")).toBe("aiSetup");
    expect(normalizeAdminView("gateway")).toBe("connectedApps");
    expect(normalizeAdminView("settings")).toBe("overview");
    expect(normalizeAdminView("spsAgent")).toBe("overview");
    expect(normalizeAdminView("models")).toBe("models");
  });

  it("falls back to overview for missing or unknown values", () => {
    expect(normalizeAdminView()).toBe("overview");
    expect(normalizeAdminView("not-real")).toBe("overview");
  });

  it("reads and writes only normalized last views", () => {
    localStorage.setItem(ADMIN_LAST_VIEW_KEY, "gateway");
    expect(readLastAdminView()).toBe("connectedApps");

    writeLastAdminView("providers");
    expect(localStorage.getItem(ADMIN_LAST_VIEW_KEY)).toBe("aiSetup");
    expect(readLastAdminView()).toBe("aiSetup");
  });
});
