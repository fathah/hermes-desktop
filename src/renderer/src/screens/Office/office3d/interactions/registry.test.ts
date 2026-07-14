// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getRepresentative, REPRESENTATIVES } from "./registry";

describe("space representative registry", () => {
  it("every rep is well-formed: labels and at least one executable action", () => {
    expect(REPRESENTATIVES.length).toBeGreaterThan(0);
    for (const rep of REPRESENTATIVES) {
      expect(rep.labelKey).toBeTruthy();
      expect(rep.spaceLabelKey).toBeTruthy();
      expect(rep.actions.length).toBeGreaterThan(0);
      // A rep with only coming-soon entries would render a dead menu.
      expect(rep.actions.some((a) => !a.disabled)).toBe(true);
    }
  });

  it("rep ids are unique", () => {
    const ids = REPRESENTATIVES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the bank teller is registered with the bank space", () => {
    const rep = getRepresentative("bank-teller");
    expect(rep).not.toBeNull();
    expect(rep!.spaceId).toBe("bank");
    const actionIds = rep!.actions.map((a) => a.id);
    expect(actionIds).toContain("checkBalance");
    expect(actionIds).toContain("accountStatus");
    expect(actionIds).toContain("createAccount");
  });

  it("unknown ids resolve to null", () => {
    expect(getRepresentative("nope")).toBeNull();
    expect(getRepresentative(null)).toBeNull();
  });
});
