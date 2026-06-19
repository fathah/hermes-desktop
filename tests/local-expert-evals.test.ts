import { describe, expect, it } from "vitest";

import {
  MACOS_LOCAL_EXPERT_EVALS,
  runLocalExpertAnswerEval,
  runLocalExpertEvalSuite,
  runLocalExpertScenarioEval,
} from "../src/main/local-experts/macos-evals";
import { MACOS_LOCAL_EXPERT_PACK } from "../src/main/local-experts/macos-pack";
import { GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_EVALS } from "../src/main/local-experts/google-workspace-evals";
import { GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK } from "../src/main/local-experts/google-workspace-pack";

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
        "full-disk-access",
        "firewall",
        "sip",
        "failed-updates",
        "launchagents",
      ]),
    );
  });

  it("uses the Mac admin source-list patch version and standards source", () => {
    expect(MACOS_LOCAL_EXPERT_PACK.version).toBe("1.0.1");
    expect(
      MACOS_LOCAL_EXPERT_PACK.records.some(
        (record) => record.sourceTier === "standards_project",
      ),
    ).toBe(true);
    expect(
      MACOS_LOCAL_EXPERT_PACK.records.some((record) =>
        record.sourceUrls.includes(
          "https://github.com/usnistgov/macos_security",
        ),
      ),
    ).toBe(true);
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

  it("covers the expected Google Docs Editors Expert topic set", () => {
    const topics = new Set(
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_EVALS.cases.map((item) => item.topic),
    );

    expect(topics).toEqual(
      new Set([
        "drive-sharing",
        "public-link-risk",
        "stop-sharing",
        "docs",
        "sheets",
        "slides",
        "macros",
        "apps-script",
        "quotas",
        "admin-boundary",
      ]),
    );
    expect(
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_EVALS.cases.every(
        (item) =>
          item.requiredAnswerSections?.join("|") ===
          "What to check|Steps|Verification|Risk|Sources",
      ),
    ).toBe(true);
  });

  it("fails Google evals when required records or safety language are missing", () => {
    const brokenPack = {
      ...GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK,
      records: GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.records.filter(
        (record) => record.id !== "workspace-admin-policy-boundaries",
      ),
      recipe: {
        ...GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.recipe,
        job: "Answer Google Workspace questions quickly.",
      },
    };

    const result = runLocalExpertEvalSuite(
      brokenPack,
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_EVALS,
    );

    expect(result.ok).toBe(false);
    expect(result.failed).toBeGreaterThan(0);
    expect(
      result.results.some((item) =>
        item.missingRecordIds.includes("workspace-admin-policy-boundaries"),
      ),
    ).toBe(true);
    expect(
      result.results.some((item) => item.missingSafetyRules.length > 0),
    ).toBe(true);
  });

  it("passes for the built-in Google Docs Editors Expert pack", () => {
    const result = runLocalExpertEvalSuite(
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK,
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_EVALS,
    );

    expect(result.ok).toBe(true);
    expect(result.passed).toBe(
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_EVALS.cases.length,
    );
    expect(result.failed).toBe(0);
  });

  it("fails Google answer-shape evals for unsafe or incomplete answers", () => {
    const testCase = GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_EVALS.cases.find(
      (item) => item.id === "drive-stop-limit-sharing",
    )!;

    const result = runLocalExpertAnswerEval(
      testCase,
      "I checked your Drive. Remove the collaborator and you are safe now.",
    );

    expect(result.ok).toBe(false);
    expect(result.forbiddenMatches).toContain("I checked your Drive");
    expect(result.missingAnswerSections).toEqual(
      expect.arrayContaining([
        "What to check",
        "Steps",
        "Verification",
        "Risk",
        "Sources",
      ]),
    );
  });

  it("passes Google answer-shape evals for source-backed scenario fixtures", () => {
    const fixtures: Record<string, string> = {
      "drive-share-specific-people": `
## What to check
Check the share dialog for the intended viewer, commenter, or editor role and any external sharing may be blocked by work/school policy message.
## Steps
Use Share, add the teammate, and choose the least access needed.
## Verification
Confirm the person or group appears with the expected role.
## Risk
Medium risk because admin policy can block sharing and sensitive files may leak.
## Sources
Use the Google Drive sharing record.
`,
      "drive-public-link-risk": `
## What to check
Check whether General access is restricted or anyone with the link and whether the file contains sensitive content.
## Steps
Prefer restricted access unless the audience is clear.
## Verification
Confirm who should have access before sending the link.
## Risk
High risk when broader link access exposes sensitive office information.
## Sources
Use the Google Drive link-sharing record.
`,
      "drive-stop-limit-sharing": `
## What to check
Check owner, editor, and remove access settings in the share dialog.
## Steps
Remove access or reduce editor to viewer/commenter.
## Verification
Confirm remaining roles match the intended access list.
## Risk
Medium risk because removed collaborators can lose work access.
## Sources
Use the Drive stop-sharing record.
`,
      "docs-create-edit-comment": `
## What to check
Check whether comments, suggestions, or collaborator permissions fit the review workflow.
## Steps
Use comments or suggestions for review instead of direct edits.
## Verification
Confirm collaborators have the intended document role.
## Risk
Low risk when roles are limited to the review need.
## Sources
Use the Google Docs collaboration record.
`,
      "sheets-create-format-share": `
## What to check
Check formulas, functions, sharing, and protected ranges before changing access.
## Steps
Open the spreadsheet and assign collaborator access with Share.
## Verification
Confirm formulas calculate and permissions match the intended collaborators.
## Risk
Low risk if edit access is limited to trusted collaborators.
## Sources
Use the Google Sheets basics record.
`,
      "slides-create-format-share": `
## What to check
Check present mode, themes, sharing, and whether reviewers need comment-only access.
## Steps
Share the deck with viewer, commenter, or editor access as needed.
## Verification
Confirm the deck presents and sharing matches collaborator roles.
## Risk
Low risk when reviewers are not given unnecessary edit access.
## Sources
Use the Google Slides basics record.
`,
      "sheets-macros-apps-script": `
## What to check
Check the macro, Apps Script code, and first-run authorization prompt before trusting it.
## Steps
Review generated Apps Script before allowing a macro to run.
## Verification
Confirm the macro matches the intended sheet workflow.
## Risk
Medium risk because authorization can grant Google account permissions.
## Sources
Use the Sheets macro record.
`,
      "apps-script-overview": `
## What to check
Check which Google services, server-side JavaScript, and authorization scopes the automation needs.
## Steps
Plan the Apps Script workflow without creating or running a project here.
## Verification
Confirm the script purpose and requested permissions are understood.
## Risk
Medium risk because Apps Script can affect Google Workspace data after authorization.
## Sources
Use the Apps Script overview record.
`,
      "apps-script-quotas": `
## What to check
Check the exact exception message, Apps Script quotas, and whether limits are subject to change.
## Steps
Reduce calls, batch work, or schedule smaller runs.
## Verification
Confirm the mitigation reduces calls, runtime, or batch size.
## Risk
Medium risk because recurring automations can fail at office scale.
## Sources
Use the Apps Script quotas record.
`,
      "workspace-admin-policy-boundaries": `
## What to check
Check external sharing, app authorization, Apps Script access, Marketplace app settings, and whether a Workspace admin policy is blocking the action.
## Steps
Collect the error text and ask a Workspace admin to confirm the relevant policy.
## Verification
Confirm the admin policy or service setting before changing user workflow.
## Risk
High risk because policy changes can expose data or enable app access.
## Sources
Use the Workspace admin boundary record.
`,
    };

    for (const testCase of GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_EVALS.cases) {
      const result = runLocalExpertAnswerEval(testCase, fixtures[testCase.id]);
      expect(result, testCase.id).toMatchObject({ ok: true });
    }
  });

  it("passes scenario evals for all Google workflows", () => {
    for (const scenario of GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.scenarios ||
      []) {
      const result = runLocalExpertScenarioEval(
        GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK,
        scenario,
      );

      expect(result, scenario.id).toMatchObject({ ok: true });
    }
  });

  it("fails scenario evals for broken links, missing evidence, and incomplete sections", () => {
    const scenario = GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK.scenarios![0];

    const missingLink = runLocalExpertScenarioEval(
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK,
      { ...scenario, recordIds: ["missing-record"] },
    );
    const missingEvidence = runLocalExpertScenarioEval(
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK,
      { ...scenario, requiredEvidence: [] },
    );
    const missingSection = runLocalExpertScenarioEval(
      GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK,
      { ...scenario, expectedSections: ["What to check", "Verification"] },
    );

    expect(missingLink).toMatchObject({
      ok: false,
      missingRecordIds: ["missing-record"],
    });
    expect(missingEvidence).toMatchObject({
      ok: false,
      missingEvidence: true,
    });
    expect(missingSection).toMatchObject({
      ok: false,
      missingAnswerSections: expect.arrayContaining([
        "Steps",
        "Risk",
        "Sources",
      ]),
    });
  });
});
