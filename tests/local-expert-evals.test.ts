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
import { EXCEL_LOCAL_EXPERT_EVALS } from "../src/main/local-experts/excel-evals";
import { EXCEL_LOCAL_EXPERT_PACK } from "../src/main/local-experts/excel-pack";

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

  it("covers the expected Excel Expert topic set", () => {
    const topics = new Set(
      EXCEL_LOCAL_EXPERT_EVALS.cases.map((item) => item.topic),
    );

    expect(topics).toEqual(
      new Set([
        "coauthoring",
        "sharing-admin",
        "formulas",
        "tables-validation",
        "data-import",
        "pivottables",
        "charts",
        "workbook-recovery",
        "embedded-chart-triage",
        "readability-gridlines",
        "worksheet-order",
        "protection",
        "macro-security",
        "vba-review",
      ]),
    );
    expect(
      EXCEL_LOCAL_EXPERT_EVALS.cases.every(
        (item) =>
          item.requiredAnswerSections?.join("|") ===
          "What to check|Steps|Verification|Risk|Sources",
      ),
    ).toBe(true);
  });

  it("fails Excel evals when required records or safety language are missing", () => {
    const brokenPack = {
      ...EXCEL_LOCAL_EXPERT_PACK,
      records: EXCEL_LOCAL_EXPERT_PACK.records.filter(
        (record) => record.id !== "excel-sharing-admin-boundaries",
      ),
      recipe: {
        ...EXCEL_LOCAL_EXPERT_PACK.recipe,
        job: "Answer Excel questions quickly.",
      },
    };

    const result = runLocalExpertEvalSuite(
      brokenPack,
      EXCEL_LOCAL_EXPERT_EVALS,
    );

    expect(result.ok).toBe(false);
    expect(result.failed).toBeGreaterThan(0);
    expect(
      result.results.some((item) =>
        item.missingRecordIds.includes("excel-sharing-admin-boundaries"),
      ),
    ).toBe(true);
    expect(
      result.results.some((item) => item.missingSafetyRules.length > 0),
    ).toBe(true);
  });

  it("passes for the built-in Excel Expert pack", () => {
    const result = runLocalExpertEvalSuite(
      EXCEL_LOCAL_EXPERT_PACK,
      EXCEL_LOCAL_EXPERT_EVALS,
    );

    expect(
      result.ok,
      JSON.stringify(
        result.results.filter((item) => !item.ok),
        null,
        2,
      ),
    ).toBe(true);
    expect(result.passed).toBe(EXCEL_LOCAL_EXPERT_EVALS.cases.length);
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

  it("fails Excel answer-shape evals for unsafe or incomplete answers", () => {
    const testCase = EXCEL_LOCAL_EXPERT_EVALS.cases.find(
      (item) => item.id === "excel-macro-security",
    )!;

    const result = runLocalExpertAnswerEval(
      testCase,
      "Run this macro now. I opened your workbook and it is fine.",
    );

    expect(result.ok).toBe(false);
    expect(result.forbiddenMatches).toContain("run this macro now");
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

  it("passes Excel answer-shape evals for source-backed scenario fixtures", () => {
    const fixtures: Record<string, string> = {
      "excel-coauthoring-cloud-requirements": `
## What to check
Check whether the workbook is in OneDrive or SharePoint Online, uses .xlsx/.xlsm/.xlsb, and whether each collaborator has a Microsoft 365 subscription account.
## Steps
Confirm storage, file format, sign-in state, and the exact version or admin message.
## Verification
Verify the supported cloud location and format before diagnosing coauthoring.
## Risk
Medium risk because sharing and admin policy can block collaboration.
## Sources
Use the Excel coauthoring record.
`,
      "excel-sharing-admin-boundaries": `
## What to check
Check organization-level sharing, site-level sharing, Microsoft Entra B2B, and whether the workbook uses a specific-people link.
## Steps
Collect the exact policy message and ask the Microsoft 365 admin to confirm restrictions.
## Verification
Confirm tenant, site, OneDrive, and link settings before changing workflow.
## Risk
High risk because broader sharing can expose workbook data.
## Sources
Use the SharePoint and OneDrive sharing boundary record.
`,
      "excel-formulas-references": `
## What to check
Check the Formula bar, functions, relative references, absolute references, and external references.
## Steps
Compare formula text and referenced cells with expected inputs.
## Verification
Confirm copied references explain the wrong result or rule them out.
## Risk
Low risk when changes are limited to reviewed formulas.
## Sources
Use the Excel formulas record.
`,
      "excel-tables-data-validation": `
## What to check
Check Data Validation, the drop-down list, protected worksheet state, and whether the workbook is shared.
## Steps
Review allowed values, input messages, and error alerts before editing.
## Verification
Test valid and invalid entries.
## Risk
Medium risk because validation changes can affect data entry.
## Sources
Use the tables and data validation record.
`,
      "excel-data-import-power-query": `
## What to check
Check From Text/CSV settings, Power Query steps, M code, leading zeros, and whether 1,048,576 rows is a limit.
## Steps
Inspect delimiter, date format, and inferred types before accepting the import.
## Verification
Confirm identifiers and dates retain intended types.
## Risk
Medium risk because imports can silently reshape data.
## Sources
Use the CSV import and Power Query record.
`,
      "excel-pivottable-analysis": `
## What to check
Check for a single header row, field list contents, Data Model use, and source range.
## Steps
Review source data and filters before trusting totals.
## Verification
Compare PivotTable fields and totals against source rows.
## Risk
Medium risk because analysis can mislead if source data is wrong.
## Sources
Use the PivotTable record.
`,
      "excel-charts-office-embedding": `
## What to check
Check Recommended Charts, trendline fit, Word embedding, PowerPoint embedding, and the Excel worksheet behind the chart.
## Steps
Review chart range, labels, legend, and embedded data.
## Verification
Confirm chart data and visual meaning before sharing.
## Risk
Low risk when the chart is reviewed against source data.
## Sources
Use the charts and Office embedding record.
`,
      "excel-workbook-recovery-repair": `
## What to check
Check the exact File Recovery warning, whether Open and Repair offers Repair or Extract Data, whether AutoRecover exists, and whether there is a backup copy.
## Steps
Preserve the original workbook, move a copy local if disk or network errors appear, and use Excel recovery options only on evidence.
## Verification
Compare recovered values or formulas against a backup copy or last saved version before trusting the workbook.
## Risk
High risk because corrupted workbook recovery can lose data.
## Sources
Use the workbook recovery and repair record.
`,
      "excel-embedded-chart-triage": `
## What to check
Check the chart range, Excel worksheet, Word or PowerPoint location, and whether the chart depends on a linked workbook.
## Steps
Review series names, axis labels, legend, embedded data, and linked workbook warnings before changing the chart.
## Verification
Confirm the visible chart matches the intended embedded worksheet or linked workbook evidence.
## Risk
Medium risk because chart data can mislead workbook readers.
## Sources
Use the embedded chart triage record.
`,
      "excel-gridlines-readability-cleanup": `
## What to check
Check gridlines, print preview, cell formatting, Freeze Panes, and whether the range should become a table.
## Steps
Adjust readability choices without changing formulas, values, or sharing.
## Verification
Confirm screen, print, and scrolling readability for the intended audience.
## Risk
Low risk when cleanup is limited to presentation.
## Sources
Use the gridlines and readability cleanup record.
`,
      "excel-worksheet-order-cleanup": `
## What to check
Check Move or Copy Sheet, the Before sheet placement, move to end choice, 3-D references, and formulas or charts that reference moved sheets.
## Steps
Record current tab order, choose the intended order, and verify references after moving or copying sheets.
## Verification
Confirm worksheet order and referenced data still match the workbook's workflow.
## Risk
Medium risk because moving sheets can change formula or chart meaning.
## Sources
Use the worksheet order cleanup record.
`,
      "excel-protection-passwords": `
## What to check
Check file-level protection, workbook or worksheet protection, Microsoft cannot retrieve forgotten passwords, and sensitive data.
## Steps
Decide which protection goal applies before distributing the workbook.
## Verification
Confirm password handling and sharing path are safe.
## Risk
High risk because passwords do not replace safe sharing.
## Sources
Use the Excel protection record.
`,
      "excel-macro-security": `
## What to check
Never enable macros without knowing their purpose. Check Trust Center, disabled macros with notification, and Excel 4.0 XLM macros.
## Steps
Review source, signature, and managed policy before trusting content.
## Verification
Confirm the user reviewed the warning and macro need.
## Risk
High risk because macros can run code.
## Sources
Use the macro security record.
`,
      "excel-macro-vba-review": `
## What to check
Check the Developer tab, Visual Basic Editor, Excel VBA reference, object model, and Do not run the macro until reviewed.
## Steps
Review generated VBA and affected workbook objects.
## Verification
Confirm the macro purpose and touched objects are understood.
## Risk
Medium risk because VBA can modify workbook content.
## Sources
Use the VBA review record.
`,
    };

    for (const testCase of EXCEL_LOCAL_EXPERT_EVALS.cases) {
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

  it("passes scenario evals for all Excel workflows", () => {
    for (const scenario of EXCEL_LOCAL_EXPERT_PACK.scenarios || []) {
      const result = runLocalExpertScenarioEval(
        EXCEL_LOCAL_EXPERT_PACK,
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
