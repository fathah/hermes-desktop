import type {
  LocalExpertPack,
  LocalExpertRecord,
} from "../../shared/local-experts";

const EXCEL_SCENARIO_SECTIONS = [
  "What to check",
  "Steps",
  "Verification",
  "Risk",
  "Sources",
];

function withExcelRecordDefaults(record: LocalExpertRecord): LocalExpertRecord {
  return {
    freshnessDays: 120,
    commonQuestions: [
      `How do I handle ${record.title.toLowerCase()}?`,
      "What can I verify in Excel or Microsoft 365 without guessing?",
    ],
    dontSay: [
      "Do not claim the current Excel, OneDrive, SharePoint, or Microsoft 365 tenant state unless the user provided evidence.",
      "Do not open Excel files, run VBA macros, run Office Scripts, or change sharing.",
      "Do not ask for Microsoft credentials, call Microsoft Graph, or change tenant/admin policy.",
    ],
    authorityNotes:
      "Prefer Microsoft Support, Microsoft 365, SharePoint, OneDrive, Power Query, and Microsoft Learn documentation. Treat managed work or school tenant policy as authoritative when it restricts sharing, macros, add-ins, or automation.",
    ...record,
  };
}

export const EXCEL_LOCAL_EXPERT_PACK: LocalExpertPack = {
  id: "excel",
  title: "Excel Expert",
  domain: "microsoft-office",
  version: "1.0.0",
  description:
    "Source-backed Microsoft Excel guidance for coauthoring, formulas, imports, PivotTables, charts, workbook protection, and macro/VBA review.",
  sourceTiers: ["microsoft_365_official", "microsoft_developer_official"],
  recipe: {
    name: "Excel Expert",
    description:
      "Answer Microsoft Excel and Microsoft 365 workbook questions with cited, review-first guidance.",
    job: "Answer Microsoft Excel and Microsoft 365 workbook questions with cited, review-first guidance from the curated Excel Expert records. Ask for visible symptoms or exact error text before diagnosing. Never claim current Excel, OneDrive, SharePoint, or Microsoft 365 tenant state unless evidence is provided. Never open Excel files, run VBA macros, run Office Scripts, or change sharing. Do not request credentials, call Microsoft Graph, inspect OneDrive or SharePoint directly, change tenant/admin policy, or treat workbook protection as a substitute for safe sharing.",
    inputs:
      "The user's Excel question, visible symptoms or error text if provided, workbook format and storage location if known, account type if known, and the installed Excel Expert vault records under expert_excel.",
    output:
      "A concise answer with source-backed checks, steps, verification, risk notes, and source references. If workbook, sharing, macro, or tenant evidence is missing, say what the user should inspect or ask their Microsoft 365 admin to confirm.",
  },
  records: (
    [
      {
        id: "excel-coauthoring-cloud-requirements",
        title: "Coauthor Excel Workbooks From Supported Cloud Locations",
        topic: "excel.coauthoring",
        sourceTier: "microsoft_365_official",
        appliesTo: [
          "Excel for Microsoft 365",
          "Excel for the web",
          "OneDrive",
          "SharePoint Online",
        ],
        symptoms: [
          "Multiple people cannot edit an Excel workbook at the same time",
          "The workbook opens read-only or does not show other authors' changes",
          "A collaborator can edit in the browser but not in the desktop app",
        ],
        steps: [
          "Confirm the workbook is stored in OneDrive, OneDrive for Business, or a SharePoint Online library.",
          "Confirm the workbook format is .xlsx, .xlsm, or .xlsb, because strict Open XML workbooks do not support coauthoring.",
          "Confirm the user is signed in with a Microsoft 365 subscription account and has a current Excel version that supports coauthoring.",
          "Use Share to invite collaborators and choose whether they can edit or only view.",
          "For managed work or school accounts, collect the exact message if the administrator has not provided a supported version or blocks the workflow.",
        ],
        verification: [
          "The workbook is in a supported OneDrive or SharePoint Online location.",
          "The file format is .xlsx, .xlsm, or .xlsb.",
          "Collaborators can open the workbook and see editing changes or selections according to the platform they use.",
          "Any admin, version, or storage limitation is captured as evidence rather than guessed.",
        ],
        risk: "medium",
        sourceUrls: [
          "https://support.microsoft.com/en-US/Excel/get-started/collaborate-on-excel-workbooks-at-the-same-time-with-co-authoring",
        ],
        lastVerified: "2026-06-22",
        tags: ["coauthoring", "sharing", "onedrive", "sharepoint"],
        commonQuestions: [
          "Why can't two people edit this workbook at the same time?",
          "What does an Excel workbook need before coauthoring works?",
          "Should this workbook be in OneDrive or SharePoint before sharing?",
        ],
        relatedRecordIds: ["excel-sharing-admin-boundaries"],
      },
      {
        id: "excel-sharing-admin-boundaries",
        title: "Recognize SharePoint And OneDrive Sharing Boundaries",
        topic: "microsoft365.sharing.admin",
        sourceTier: "microsoft_365_official",
        appliesTo: [
          "Microsoft 365",
          "SharePoint Online",
          "OneDrive",
          "Excel workbooks",
        ],
        symptoms: [
          "An external client cannot open a shared Excel workbook",
          "A sharing link works internally but not outside the organization",
          "A work or school account shows administrator-controlled sharing behavior",
        ],
        steps: [
          "Identify whether the workbook is stored in OneDrive or SharePoint.",
          "Collect the link type, external collaborator address, and exact access or policy message.",
          "Check whether organization-level sharing, site-level sharing, OneDrive sharing, link type, or Microsoft Entra B2B settings could be more restrictive than the user expects.",
          "Ask a Microsoft 365 or SharePoint admin to confirm tenant and site policy before suggesting broader external sharing.",
          "Prefer a narrower specific-people link for sensitive workbooks when external sharing is allowed.",
        ],
        verification: [
          "The user can name the storage location, link type, and whether the collaborator is inside or outside the organization.",
          "The exact policy, access request, or sign-in message is captured.",
          "A tenant or site admin confirms any organization-level, site-level, OneDrive, or Microsoft Entra B2B restriction before the workflow changes.",
        ],
        risk: "high",
        sourceUrls: [
          "https://learn.microsoft.com/en-us/sharepoint/turn-external-sharing-on-or-off",
        ],
        lastVerified: "2026-06-22",
        tags: ["sharing", "admin", "onedrive", "sharepoint", "entra"],
        commonQuestions: [
          "External client cannot open this workbook. What should I check first?",
          "Could SharePoint or OneDrive policy block this Excel link?",
          "What should I ask our Microsoft 365 admin to confirm?",
        ],
        relatedRecordIds: [
          "excel-coauthoring-cloud-requirements",
          "excel-protection-passwords",
        ],
      },
      {
        id: "excel-formulas-references",
        title: "Troubleshoot Excel Formulas And References",
        topic: "excel.formulas.references",
        sourceTier: "microsoft_365_official",
        appliesTo: ["Excel for Microsoft 365", "Excel for the web"],
        symptoms: [
          "A formula returns a result that does not match expectations",
          "A copied formula points to the wrong cells",
          "A workbook uses links or external references that may be stale",
        ],
        steps: [
          "Inspect the formula in the Formula bar and confirm it begins with an equal sign.",
          "Separate functions, references, operators, and constants before changing the formula.",
          "Check whether relative, absolute, or mixed cell references changed while copying or filling the formula.",
          "Check whether the formula uses references to another sheet, workbook, or external link.",
          "Compare expected input cells with the actual referenced range before rewriting the formula.",
        ],
        verification: [
          "The exact formula text and referenced cells are visible.",
          "The user can identify functions, references, operators, and constants in the formula.",
          "Relative, absolute, mixed, sheet, workbook, or external references explain the result or are ruled out.",
        ],
        risk: "low",
        sourceUrls: [
          "https://support.microsoft.com/en-US/Excel/get-started/overview-of-formulas-in-excel",
        ],
        lastVerified: "2026-06-22",
        tags: ["formulas", "references", "functions", "troubleshooting"],
        commonQuestions: [
          "Why is this Excel formula returning the wrong value?",
          "Should this reference be relative, absolute, or mixed?",
          "What evidence should I collect before rewriting a formula?",
        ],
        relatedRecordIds: ["excel-data-import-power-query"],
      },
      {
        id: "excel-tables-data-validation",
        title: "Use Tables And Data Validation For Controlled Entry",
        topic: "excel.tables.validation",
        sourceTier: "microsoft_365_official",
        appliesTo: ["Excel tables", "Excel data validation"],
        symptoms: [
          "A worksheet needs controlled data entry",
          "Users enter invalid dates, numbers, or status values",
          "A validation command is unavailable because the sheet is protected or shared",
        ],
        steps: [
          "Use tables when the data should have consistent columns and a clear header row.",
          "Use Data Validation to restrict whole numbers, decimals, lists, dates, times, text length, or custom formulas.",
          "For a drop-down list, set the allowed type to List and provide the source values.",
          "Add an input message and error alert so users know what valid data looks like.",
          "If validation controls are unavailable, check whether the worksheet is protected or the workbook is shared before changing the design.",
        ],
        verification: [
          "Invalid input is rejected or warned according to the chosen data validation style.",
          "The drop-down list or custom formula accepts the intended values.",
          "Protected worksheet or shared workbook state is understood before editing validation rules.",
        ],
        risk: "medium",
        sourceUrls: [
          "https://support.microsoft.com/en-US/Excel/get-started/apply-data-validation-to-cells",
        ],
        lastVerified: "2026-06-22",
        tags: ["tables", "data-validation", "dropdowns", "entry"],
        commonQuestions: [
          "How do I stop users from typing invalid values into this sheet?",
          "Why is Data Validation unavailable?",
          "How should I verify a drop-down list works before sharing a workbook?",
        ],
        relatedRecordIds: ["excel-protection-passwords"],
      },
      {
        id: "excel-data-import-power-query",
        title: "Import CSV Data And Use Power Query Carefully",
        topic: "excel.import.power_query",
        sourceTier: "microsoft_365_official",
        appliesTo: ["Excel", "CSV files", "Power Query"],
        symptoms: [
          "Opening a CSV changes dates, identifiers, or leading zeros",
          "A data import needs repeatable cleanup before analysis",
          "A Power Query refresh fails or changes shaped data",
        ],
        steps: [
          "Decide whether to open a .csv directly or import it as an external data range with From Text/CSV.",
          "Inspect delimiters, date formats, numeric identifiers, and leading zeros before accepting inferred data types.",
          "Use Power Query for repeatable extract, transform, and load processing when the same cleanup will happen again.",
          "Review generated Power Query M steps before treating a transformation as reusable.",
          "Remember Excel worksheet limits such as 1,048,576 rows and 16,384 columns when importing large text files.",
        ],
        verification: [
          "The user can show sample source rows, the delimiter, and the imported result.",
          "Identifiers, dates, and leading zeros retain the intended data types.",
          "Power Query steps are reviewable and can be refreshed without silently changing the model.",
        ],
        risk: "medium",
        sourceUrls: [
          "https://support.microsoft.com/en-US/Excel/get-started/import-or-export-text-txt-or-csv-files",
          "https://learn.microsoft.com/en-us/power-query/power-query-what-is-power-query",
        ],
        lastVerified: "2026-06-22",
        tags: ["csv", "import", "power-query", "data-types"],
        commonQuestions: [
          "Why did Excel remove leading zeros from my CSV?",
          "Should I open a CSV directly or import it with From Text/CSV?",
          "When should I use Power Query for repeatable cleanup?",
        ],
        relatedRecordIds: [
          "excel-formulas-references",
          "excel-pivottable-analysis",
        ],
      },
      {
        id: "excel-pivottable-analysis",
        title: "Prepare Source Data Before Building PivotTables",
        topic: "excel.pivottables",
        sourceTier: "microsoft_365_official",
        appliesTo: ["Excel PivotTables", "Excel data model"],
        symptoms: [
          "A PivotTable field list is confusing or missing expected columns",
          "A PivotTable total does not match source data",
          "The user is not sure whether to use a range, table, or data model",
        ],
        steps: [
          "Confirm the source data is organized in columns with a single header row.",
          "Select the cells, table, or range that should feed the PivotTable.",
          "Choose whether the PivotTable belongs in a new worksheet or an existing worksheet.",
          "If Add this data to the Data Model is selected, confirm the workbook model should include that table or range.",
          "Use the field list to arrange fields, then verify filters and source range before trusting totals.",
        ],
        verification: [
          "The selected source range or table has one clear header row and expected fields.",
          "The PivotTable field list contains the intended columns.",
          "Totals, filters, and data model inclusion are checked against source data.",
        ],
        risk: "medium",
        sourceUrls: [
          "https://support.microsoft.com/en-US/Excel/get-started/create-a-pivottable-to-analyze-worksheet-data",
        ],
        lastVerified: "2026-06-22",
        tags: ["pivottables", "analysis", "data-model", "fields"],
        commonQuestions: [
          "Why is my PivotTable missing expected columns?",
          "What source range should I use for this PivotTable?",
          "How do I verify a PivotTable total before sharing it?",
        ],
        relatedRecordIds: [
          "excel-data-import-power-query",
          "excel-formulas-references",
        ],
      },
      {
        id: "excel-charts-office-embedding",
        title: "Create Charts And Understand Office Chart Data",
        topic: "excel.charts.embedding",
        sourceTier: "microsoft_365_official",
        appliesTo: ["Excel charts", "Word charts", "PowerPoint charts"],
        symptoms: [
          "A chart does not reflect the intended data range",
          "A chart in Word or PowerPoint opens Excel data for editing",
          "The user wants a trendline or chart element but is not sure what data is plotted",
        ],
        steps: [
          "Select the data that should appear in the chart before inserting it.",
          "Use Recommended Charts or choose a specific chart type, then preview whether it matches the data.",
          "Review chart title, legend, axis labels, gridlines, and plotted range before sharing.",
          "Add a trendline only when the chart type and data support the intended analysis.",
          "For charts inserted into Word or PowerPoint, remember the chart data is entered and saved in an Excel worksheet inside that document or presentation.",
        ],
        verification: [
          "The chart range contains the intended categories and series.",
          "Chart elements identify what the audience should compare.",
          "Embedded Word or PowerPoint chart data is reviewed through the Excel worksheet that stores it.",
        ],
        risk: "low",
        sourceUrls: [
          "https://support.microsoft.com/en-US/Excel/get-started/create-a-chart-from-start-to-finish",
        ],
        lastVerified: "2026-06-22",
        tags: ["charts", "trendlines", "powerpoint", "word", "embedding"],
        commonQuestions: [
          "Why does this chart show the wrong series?",
          "Where is chart data stored in a PowerPoint deck?",
          "What should I verify before sending a chart externally?",
        ],
        relatedRecordIds: [
          "excel-formulas-references",
          "excel-pivottable-analysis",
        ],
      },
      {
        id: "excel-protection-passwords",
        title: "Understand Excel File Protection And Password Risk",
        topic: "excel.protection.passwords",
        sourceTier: "microsoft_365_official",
        appliesTo: [
          "Excel files",
          "Workbook protection",
          "Worksheet protection",
        ],
        symptoms: [
          "A workbook contains sensitive data",
          "The user wants to prevent others from opening or editing an Excel file",
          "A password-protected workbook needs to be shared safely",
        ],
        steps: [
          "Distinguish file-level protection from workbook or worksheet protection before advising a control.",
          "Use file-level encryption with a password only when the password can be managed safely.",
          "Warn that Microsoft cannot retrieve forgotten passwords.",
          "Warn that distributing password-protected files or passwords can still expose sensitive information if they reach unintended users.",
          "Pair workbook protection decisions with narrow sharing permissions instead of relying on passwords alone.",
        ],
        verification: [
          "The user can name whether the goal is preventing open access, workbook changes, or worksheet edits.",
          "The password handling and sharing path are known before the workbook is distributed.",
          "Sensitive data is not treated as safe only because a password exists.",
        ],
        risk: "high",
        sourceUrls: [
          "https://support.microsoft.com/en-US/Excel/get-started/protect-an-excel-file",
        ],
        lastVerified: "2026-06-22",
        tags: ["protection", "passwords", "sensitive-data", "sharing"],
        commonQuestions: [
          "Should I password-protect this Excel workbook before sending it?",
          "What is the difference between file, workbook, and worksheet protection?",
          "What should I verify before sharing a sensitive workbook?",
        ],
        relatedRecordIds: ["excel-sharing-admin-boundaries"],
      },
      {
        id: "excel-macro-security",
        title: "Review Excel Macro Security Before Trusting A File",
        topic: "excel.macros.security",
        sourceTier: "microsoft_365_official",
        appliesTo: ["Excel macros", "Microsoft 365 Trust Center"],
        symptoms: [
          "Excel shows a macro security warning",
          "A workbook from email or the internet asks to enable content",
          "A managed device blocks macro settings",
        ],
        steps: [
          "Never enable macros unless the user knows what the macros do and wants the functionality.",
          "Treat viewing or editing the workbook as separate from enabling macros.",
          "Review Trust Center macro settings for the current Microsoft 365 app, not all apps.",
          "Prefer disabled macros with notification or digitally signed macros over broad trust.",
          "For managed work or school devices, ask an administrator to confirm policy instead of trying to route around it.",
          "Treat Excel 4.0 XLM macros and VBA project object model access as separate high-risk settings.",
        ],
        verification: [
          "The file origin, security warning, publisher/signature state, and user need for macro functionality are known.",
          "The current app's Trust Center setting is identified without assuming all Office apps match.",
          "No macro is trusted or run without evidence that the user reviewed its purpose and source.",
        ],
        risk: "high",
        sourceUrls: [
          "https://support.microsoft.com/en-US/Office/vba/enable-or-disable-macros-in-microsoft-365-files",
        ],
        lastVerified: "2026-06-22",
        tags: ["macros", "trust-center", "security", "vba", "xlm"],
        commonQuestions: [
          "Excel says macros are disabled. Should I enable content?",
          "Why can I view a workbook without enabling macros?",
          "What macro evidence should I collect before trusting this file?",
        ],
        relatedRecordIds: ["excel-macro-vba-review"],
      },
      {
        id: "excel-macro-vba-review",
        title: "Review Recorded Macros And VBA Object Model Boundaries",
        topic: "excel.macros.vba",
        sourceTier: "microsoft_developer_official",
        appliesTo: ["Excel macros", "VBA", "Visual Basic Editor"],
        symptoms: [
          "A user recorded a macro and wants to understand the generated code",
          "A workbook automation needs to be reviewed before use",
          "A macro interacts with workbook objects in a way the user cannot explain",
        ],
        steps: [
          "Use the Developer tab to record only repeatable workbook actions that the user understands.",
          "Review the generated macro in the Visual Basic Editor before using it on important data.",
          "Use the Excel VBA reference and object model concepts to identify which workbook, worksheet, range, or chart objects the macro touches.",
          "Keep macro guidance to review and explanation unless the user explicitly provides code and asks for a safe edit.",
          "Do not run the macro, change Trust Center settings, or grant VBA project object model access from the expert workflow.",
        ],
        verification: [
          "The user can explain the macro's intended workbook action.",
          "The VBA code and affected Excel object model areas are visible for review.",
          "No macro has been run or trusted as part of the guidance-only expert workflow.",
        ],
        risk: "medium",
        sourceUrls: [
          "https://support.microsoft.com/en-US/Excel/get-started-with-excel/quick-start-create-a-macro",
          "https://learn.microsoft.com/en-us/office/vba/api/overview/excel",
        ],
        lastVerified: "2026-06-22",
        tags: ["macros", "vba", "visual-basic-editor", "object-model"],
        commonQuestions: [
          "What should I review after recording an Excel macro?",
          "How can I tell what workbook objects this VBA touches?",
          "Should this macro be run before someone reviews the code?",
        ],
        relatedRecordIds: ["excel-macro-security"],
      },
    ] satisfies LocalExpertRecord[]
  ).map(withExcelRecordDefaults),
  scenarios: [
    {
      id: "shared-workbook-cannot-coauthor",
      title: "Shared workbook cannot coauthor",
      prompt:
        "A team cannot edit the same Excel workbook at the same time or cannot see each other's workbook changes.",
      recordIds: [
        "excel-coauthoring-cloud-requirements",
        "excel-sharing-admin-boundaries",
      ],
      requiredEvidence: [
        "Workbook storage location: OneDrive, OneDrive for Business, SharePoint Online, or another location",
        "Workbook format: .xlsx, .xlsm, .xlsb, or another format",
        "Whether each collaborator is signed in with a Microsoft 365 subscription account",
        "Exact read-only, version, sync, or administrator message",
      ],
      expectedSections: EXCEL_SCENARIO_SECTIONS,
      risk: "medium",
    },
    {
      id: "external-client-cannot-open-excel",
      title: "External client cannot open Excel workbook",
      prompt:
        "A client outside the organization cannot open or edit a shared Excel workbook.",
      recordIds: [
        "excel-sharing-admin-boundaries",
        "excel-coauthoring-cloud-requirements",
        "excel-protection-passwords",
      ],
      requiredEvidence: [
        "Exact access request, sign-in, or policy message",
        "Current link type and whether it is a specific-people link",
        "Whether the collaborator is outside the Microsoft 365 tenant",
        "Whether file-level password protection or workbook protection is involved",
      ],
      expectedSections: EXCEL_SCENARIO_SECTIONS,
      risk: "high",
    },
    {
      id: "formula-returns-wrong-result",
      title: "Formula returns the wrong result",
      prompt:
        "An Excel formula returns a value the user believes is wrong after copying, filling, or linking workbook data.",
      recordIds: ["excel-formulas-references", "excel-data-import-power-query"],
      requiredEvidence: [
        "Exact formula text from the Formula bar",
        "Expected result and actual result",
        "Referenced cells, sheets, workbooks, or external links",
        "Whether data came from an import or Power Query step",
      ],
      expectedSections: EXCEL_SCENARIO_SECTIONS,
      risk: "medium",
    },
    {
      id: "csv-import-changed-identifiers",
      title: "CSV import changed identifiers",
      prompt:
        "Opening or importing a CSV changed leading zeros, dates, delimiters, or identifier columns.",
      recordIds: [
        "excel-data-import-power-query",
        "excel-tables-data-validation",
        "excel-formulas-references",
      ],
      requiredEvidence: [
        "Sample source rows from the CSV",
        "Delimiter and locale/date format expectations",
        "Columns that should remain text, such as IDs with leading zeros",
        "Whether the file was opened directly or imported with From Text/CSV",
      ],
      expectedSections: EXCEL_SCENARIO_SECTIONS,
      risk: "medium",
    },
    {
      id: "pivottable-source-data-confusing",
      title: "PivotTable source data is confusing",
      prompt:
        "A PivotTable is missing expected fields or produces totals that do not match source data.",
      recordIds: [
        "excel-pivottable-analysis",
        "excel-data-import-power-query",
        "excel-formulas-references",
      ],
      requiredEvidence: [
        "Source range or table name",
        "Header row and expected field names",
        "PivotTable field list, filters, and layout",
        "Whether the data model or Power Query refresh is involved",
      ],
      expectedSections: EXCEL_SCENARIO_SECTIONS,
      risk: "medium",
    },
    {
      id: "macro-security-warning",
      title: "Macro security warning",
      prompt:
        "An Excel workbook shows a macro security warning or asks whether macros should be enabled.",
      recordIds: [
        "excel-macro-security",
        "excel-macro-vba-review",
        "excel-sharing-admin-boundaries",
      ],
      requiredEvidence: [
        "Exact macro security warning text",
        "Where the workbook came from",
        "Whether the macro is signed or from a trusted location",
        "What workbook task the macro is supposed to automate",
      ],
      expectedSections: EXCEL_SCENARIO_SECTIONS,
      risk: "high",
    },
  ],
};
