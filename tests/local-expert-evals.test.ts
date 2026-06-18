import { describe, expect, it } from "vitest";

import {
  MACOS_LOCAL_EXPERT_EVALS,
  runLocalExpertEvalSuite,
} from "../src/main/local-experts/macos-evals";
import { MACOS_LOCAL_EXPERT_PACK } from "../src/main/local-experts/macos-pack";

describe("local expert evals", () => {
  it("covers the expected Mac Expert topic set", () => {
    const topics = new Set(
      MACOS_LOCAL_EXPERT_EVALS.cases.map((item) => item.topic),
    );

    expect(topics).toEqual(
      new Set([
        "permissions",
        "filevault",
        "gatekeeper",
        "updates",
        "login-items",
        "storage",
        "networking",
        "time-machine",
        "keychain",
        "notarization",
        "sandboxing",
        "tcc",
      ]),
    );
  });

  it("fails when required records or safety language are missing", () => {
    const brokenPack = {
      ...MACOS_LOCAL_EXPERT_PACK,
      records: MACOS_LOCAL_EXPERT_PACK.records.filter(
        (record) => record.id !== "security-filevault",
      ),
      recipe: {
        ...MACOS_LOCAL_EXPERT_PACK.recipe,
        job: "Answer Mac questions quickly.",
      },
    };

    const result = runLocalExpertEvalSuite(
      brokenPack,
      MACOS_LOCAL_EXPERT_EVALS,
    );

    expect(result.ok).toBe(false);
    expect(result.failed).toBeGreaterThan(0);
    expect(
      result.results.some((item) =>
        item.missingRecordIds.includes("security-filevault"),
      ),
    ).toBe(true);
    expect(
      result.results.some((item) => item.missingSafetyRules.length > 0),
    ).toBe(true);
  });

  it("passes for the built-in Mac Expert pack", () => {
    const result = runLocalExpertEvalSuite(
      MACOS_LOCAL_EXPERT_PACK,
      MACOS_LOCAL_EXPERT_EVALS,
    );

    expect(result.ok).toBe(true);
    expect(result.passed).toBe(MACOS_LOCAL_EXPERT_EVALS.cases.length);
    expect(result.failed).toBe(0);
  });
});
