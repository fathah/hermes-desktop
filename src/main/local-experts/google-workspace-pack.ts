import type {
  LocalExpertPack,
  LocalExpertRecord,
} from "../../shared/local-experts";

const GOOGLE_SCENARIO_SECTIONS = [
  "What to check",
  "Steps",
  "Verification",
  "Risk",
  "Sources",
];

function withGoogleRecordDefaults(
  record: LocalExpertRecord,
): LocalExpertRecord {
  return {
    freshnessDays: 120,
    commonQuestions: [
      `How do I handle ${record.title.toLowerCase()}?`,
      `What can I verify in Google Workspace without guessing?`,
    ],
    dontSay: [
      "Do not claim the current Drive, Docs, Sheets, Slides, Gmail, or Apps Script state unless the user provided evidence.",
      "Do not change sharing, create scripts, publish files, or ask for credentials.",
      "Do not suggest bypassing a Workspace admin policy.",
    ],
    authorityNotes:
      "Prefer Google Workspace, Google Docs Editors, Drive Help, and Apps Script official documentation. Treat managed work or school account policy as authoritative when it restricts sharing or automation.",
    ...record,
  };
}

export const GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK: LocalExpertPack = {
  id: "google-docs-editors",
  title: "Google Docs Editors Expert",
  domain: "google-workspace",
  version: "1.0.0",
  description:
    "Source-backed Google Workspace guidance for Drive sharing, Docs, Sheets, Slides, and lightweight Apps Script automation.",
  sourceTiers: ["google_workspace_official", "google_developer_official"],
  recipe: {
    name: "Google Docs Editors Expert",
    description:
      "Answer Google Workspace Docs, Sheets, Slides, Drive sharing, and Apps Script questions with cited, review-first guidance.",
    job: "Answer Google Workspace Docs, Sheets, Slides, Drive sharing, and Apps Script questions with cited, review-first guidance from the curated Google Docs Editors Expert records. Ask before changing sharing. Never claim current Workspace state unless evidence is provided. Never access Gmail, Drive, Docs, Sheets, Slides, or Apps Script directly. Do not run scripts, create Apps Script projects, publish files, change permissions, ask for credentials, or route around a work or school admin policy.",
    inputs:
      "The user's Google Workspace question, visible symptoms or error text if provided, account type if known, and the installed Google Docs Editors Expert vault records under expert_google-docs-editors.",
    output:
      "A concise answer with source-backed steps, verification checks, risk notes, and source references. If access or policy evidence is missing, say what the user should inspect or ask their Workspace admin to confirm.",
  },
  records: (
    [
      {
        id: "drive-share-specific-people",
        title: "Share Drive Files With Specific People",
        topic: "drive.sharing.people",
        sourceTier: "google_workspace_official",
        appliesTo: ["Google Drive", "Google Docs editors"],
        symptoms: [
          "A collaborator cannot open a Google file",
          "The user needs to choose viewer, commenter, or editor access",
          "A work or school account may block outside sharing",
        ],
        steps: [
          "Open the file in Drive or a Docs editor.",
          "Open Share.",
          "Add the intended person or group.",
          "Choose viewer, commenter, or editor based on the minimum access needed.",
          "If the person is outside the organization, check whether external sharing may be blocked by work/school policy.",
        ],
        verification: [
          "The intended person or group appears in the share dialog.",
          "The assigned role is viewer, commenter, or editor as intended.",
          "If sharing is blocked, the user has the exact policy or error text to ask a Workspace admin about.",
        ],
        risk: "medium",
        sourceUrls: ["https://support.google.com/docs/answer/2494822?hl=en"],
        lastVerified: "2026-06-18",
        tags: ["drive", "sharing", "permissions"],
        commonQuestions: [
          "Client cannot open this file. What should I check first?",
          "Which role should I use for a teammate: viewer, commenter, or editor?",
          "Could a Workspace admin policy be blocking external sharing?",
        ],
        relatedRecordIds: [
          "drive-public-link-risk",
          "workspace-admin-policy-boundaries",
        ],
      },
      {
        id: "drive-public-link-risk",
        title: "Understand Restricted And Link Sharing",
        topic: "drive.sharing.links",
        sourceTier: "google_workspace_official",
        appliesTo: ["Google Drive", "Google Docs editors"],
        symptoms: [
          "A file link works for some people but not others",
          "The user is deciding between restricted access and anyone with the link",
          "A document may expose sensitive office information",
        ],
        steps: [
          "Open Share and review General access.",
          "Prefer restricted access for private office files.",
          "Use broader link access only when the audience and sensitivity are clear.",
          "For work or school accounts, check whether the organization limits link-sharing choices.",
        ],
        verification: [
          "General access shows restricted or the intended link audience.",
          "The user can name who should have access and why.",
          "Sensitive files are not exposed to a broader audience than intended.",
        ],
        risk: "high",
        sourceUrls: [
          "https://support.google.com/docs/answer/2494822?hl=en",
          "https://support.google.com/drive/answer/2494893?hl=en",
        ],
        lastVerified: "2026-06-18",
        tags: ["drive", "sharing", "links", "security"],
        commonQuestions: [
          "Someone shared a private file too broadly. What should we check?",
          "Should this file be restricted or available to anyone with the link?",
          "How do we reduce link-sharing risk without breaking collaboration?",
        ],
        relatedRecordIds: [
          "drive-stop-limit-sharing",
          "workspace-admin-policy-boundaries",
        ],
      },
      {
        id: "drive-stop-limit-sharing",
        title: "Stop Or Limit Drive File Sharing",
        topic: "drive.sharing.limit",
        sourceTier: "google_workspace_official",
        appliesTo: ["Google Drive", "Google Docs editors"],
        symptoms: [
          "A file was shared with the wrong person",
          "A collaborator should lose editor access",
          "The owner wants to reduce link or person-based access",
        ],
        steps: [
          "Open Share for the file.",
          "Review people, groups, and General access.",
          "Remove access or reduce a role from editor to commenter or viewer when appropriate.",
          "Confirm whether editors are allowed to change permissions or share the file.",
        ],
        verification: [
          "The removed person or group no longer appears with access.",
          "Remaining roles match the intended viewer, commenter, or editor access.",
          "Owner and editor permission settings match the office's sharing policy.",
        ],
        risk: "medium",
        sourceUrls: ["https://support.google.com/drive/answer/2494893?hl=en"],
        lastVerified: "2026-06-18",
        tags: ["drive", "sharing", "permissions", "access"],
        commonQuestions: [
          "How do I remove a collaborator from a shared file?",
          "How do I reduce someone's access without deleting the file?",
          "What should I verify after a private file was shared too broadly?",
        ],
        relatedRecordIds: [
          "drive-public-link-risk",
          "workspace-admin-policy-boundaries",
        ],
      },
      {
        id: "workspace-admin-policy-boundaries",
        title: "Recognize Workspace Admin Policy Boundaries",
        topic: "workspace.admin_policy",
        sourceTier: "google_workspace_official",
        appliesTo: [
          "Google Workspace Admin",
          "Google Drive",
          "Google Docs editors",
          "Google Apps Script",
          "Google Workspace Marketplace",
        ],
        symptoms: [
          "External sharing is unavailable or blocked for a work or school account",
          "A script, macro, add-on, or app asks for authorization and cannot proceed",
          "Apps Script access or Marketplace app installation appears disabled",
          "A user sees policy or administrator-controlled access messaging",
        ],
        steps: [
          "Collect the exact error text, affected account, file or script type, and intended collaborator or app.",
          "Check whether the issue is about external sharing, app authorization, Apps Script access, Marketplace app settings, or Drive and Docs service access.",
          "Ask a Workspace admin to confirm the policy before suggesting a workaround.",
          "For sensitive files or scripts, prefer changing the workflow over broadening organization policy.",
        ],
        verification: [
          "The user can identify the affected service and the exact policy or authorization message.",
          "A Workspace admin confirms whether an organizational unit, group, service, app access, Marketplace allowlist, or sharing policy applies.",
          "No sharing, script execution, app installation, or admin policy change is treated as complete without evidence.",
        ],
        risk: "high",
        sourceUrls: [
          "https://support.google.com/a/answer/60781?hl=en",
          "https://knowledge.workspace.google.com/admin/users/access/turn-apps-script-on-or-off-for-users",
          "https://support.google.com/a/answer/7281227?hl=en",
          "https://support.google.com/a/answer/6089179?hl=en",
        ],
        lastVerified: "2026-06-18",
        tags: ["admin", "policy", "sharing", "apps-script", "marketplace"],
        commonQuestions: [
          "Admin policy blocks external sharing or Apps Script access. What evidence should I collect?",
          "How can I tell whether this is a user permission issue or an organization policy?",
          "What should I ask our Workspace admin before changing a workflow?",
        ],
        relatedRecordIds: [
          "drive-share-specific-people",
          "drive-public-link-risk",
          "sheets-macros-apps-script",
          "apps-script-overview",
          "apps-script-quotas",
        ],
      },
      {
        id: "docs-create-edit-comment",
        title: "Create, Edit, And Comment In Google Docs",
        topic: "docs.collaboration",
        sourceTier: "google_workspace_official",
        appliesTo: ["Google Docs"],
        symptoms: [
          "The user needs a new shared document",
          "A team needs comments or suggestions instead of direct edits",
          "A collaborator cannot find editing controls",
        ],
        steps: [
          "Create or open a document in Google Docs.",
          "Use editing mode for direct changes when appropriate.",
          "Use comments or suggestions when changes need review.",
          "Share the document with the minimum role needed for each collaborator.",
        ],
        verification: [
          "The document opens in Google Docs.",
          "Comments, suggestions, or edits appear in the document history or interface.",
          "Collaborators have the intended document access role.",
        ],
        risk: "low",
        sourceUrls: [
          "https://support.google.com/docs/answer/7068618?hl=en",
          "https://support.google.com/docs/answer/2494822?hl=en",
        ],
        lastVerified: "2026-06-18",
        tags: ["docs", "comments", "collaboration"],
        commonQuestions: [
          "How should a team review changes in a Google Doc?",
          "When should reviewers use comments or suggestions instead of direct edits?",
          "How do I keep collaborator access narrow while a document is being reviewed?",
        ],
        relatedRecordIds: ["drive-share-specific-people"],
      },
      {
        id: "sheets-create-format-share",
        title: "Create, Format, And Share Google Sheets",
        topic: "sheets.basics",
        sourceTier: "google_workspace_official",
        appliesTo: ["Google Sheets"],
        symptoms: [
          "The user needs a shared spreadsheet",
          "A sheet needs formulas or functions",
          "A collaborator cannot edit a spreadsheet",
        ],
        steps: [
          "Create or open a spreadsheet in Google Sheets.",
          "Use cells, formatting, formulas, and functions to structure the data.",
          "Use Share to assign collaborator access.",
          "Confirm whether protected ranges or file permissions explain blocked editing.",
        ],
        verification: [
          "The spreadsheet opens in Google Sheets.",
          "Expected formulas or functions calculate correctly.",
          "Sharing and edit permissions match the intended collaborators.",
        ],
        risk: "low",
        sourceUrls: [
          "https://support.google.com/docs/answer/6000292?hl=en",
          "https://support.google.com/docs/answer/2494822?hl=en",
        ],
        lastVerified: "2026-06-18",
        tags: ["sheets", "formulas", "sharing"],
        commonQuestions: [
          "How do I create a shared spreadsheet with formulas?",
          "Why can a collaborator view a sheet but not edit it?",
          "What should I check before changing spreadsheet permissions?",
        ],
        relatedRecordIds: ["drive-share-specific-people"],
      },
      {
        id: "sheets-macros-apps-script",
        title: "Use Sheets Macros With Apps Script Awareness",
        topic: "sheets.macros",
        sourceTier: "google_workspace_official",
        appliesTo: ["Google Sheets", "Google Apps Script"],
        symptoms: [
          "The user wants to repeat spreadsheet steps",
          "A macro creates or opens Apps Script code",
          "A macro asks for authorization before it can run",
        ],
        steps: [
          "Record a macro only for repeatable spreadsheet actions.",
          "Review the generated Apps Script before trusting it.",
          "Expect first-run authorization when a macro needs Google account permissions.",
          "Keep macros limited to the sheet workflow they were created for.",
        ],
        verification: [
          "The macro appears in the spreadsheet's macro menu.",
          "The linked Apps Script code matches the intended spreadsheet actions.",
          "First-run authorization is reviewed before the macro is used.",
        ],
        risk: "medium",
        sourceUrls: ["https://support.google.com/docs/answer/9331168?hl=en"],
        lastVerified: "2026-06-18",
        tags: ["sheets", "macros", "apps-script", "authorization"],
        commonQuestions: [
          "Sheets macro asks for authorization. What should I review first?",
          "Why did recording a macro open Apps Script?",
          "Could Apps Script access be disabled by Workspace admin policy?",
        ],
        relatedRecordIds: [
          "apps-script-overview",
          "apps-script-quotas",
          "workspace-admin-policy-boundaries",
        ],
      },
      {
        id: "slides-create-format-share",
        title: "Create, Format, And Share Google Slides",
        topic: "slides.basics",
        sourceTier: "google_workspace_official",
        appliesTo: ["Google Slides"],
        symptoms: [
          "The user needs a shared presentation",
          "A team needs to edit or present slides",
          "A collaborator cannot access a deck",
        ],
        steps: [
          "Create or open a presentation in Google Slides.",
          "Use themes, layouts, and slide formatting to structure the deck.",
          "Use Present when the deck is ready to show.",
          "Share the presentation with viewer, commenter, or editor access as needed.",
        ],
        verification: [
          "The presentation opens in Google Slides.",
          "The deck can be presented from the Slides interface.",
          "Sharing matches the intended collaborator roles.",
        ],
        risk: "low",
        sourceUrls: [
          "https://support.google.com/docs/answer/2763168?hl=en",
          "https://support.google.com/docs/answer/2494822?hl=en",
        ],
        lastVerified: "2026-06-18",
        tags: ["slides", "presentations", "sharing"],
        commonQuestions: [
          "Presentation should be review-only. Which access role should I use?",
          "How do I share a deck for comments without giving edit access?",
          "What should I verify before sending a presentation link externally?",
        ],
        relatedRecordIds: [
          "drive-share-specific-people",
          "drive-public-link-risk",
        ],
      },
      {
        id: "apps-script-overview",
        title: "Understand Apps Script Boundaries",
        topic: "apps_script.overview",
        sourceTier: "google_developer_official",
        appliesTo: ["Google Apps Script", "Google Workspace"],
        symptoms: [
          "The user wants to automate a Google Workspace workflow",
          "A script interacts with Docs, Sheets, Slides, Drive, or Gmail",
          "The user needs to know where Apps Script runs",
        ],
        steps: [
          "Treat Apps Script as a Google Workspace automation platform using server-side JavaScript.",
          "Identify which Google service the script needs before creating or running it.",
          "Review required authorization scopes before trusting an automation.",
          "Use Apps Script guidance for planning only unless the user explicitly opens and reviews the script project.",
        ],
        verification: [
          "The automation goal names the Google services involved.",
          "The user has reviewed what authorization the script requests.",
          "The guidance does not assume access to the user's Google account or files.",
        ],
        risk: "medium",
        sourceUrls: ["https://developers.google.com/apps-script/overview"],
        lastVerified: "2026-06-18",
        tags: ["apps-script", "automation", "authorization"],
        commonQuestions: [
          "Can Apps Script automate our Google Workspace docs?",
          "What Google services and authorization scopes does this automation need?",
          "Could a Workspace admin policy block Apps Script access?",
        ],
        relatedRecordIds: [
          "sheets-macros-apps-script",
          "apps-script-quotas",
          "workspace-admin-policy-boundaries",
        ],
      },
      {
        id: "apps-script-quotas",
        title: "Handle Apps Script Quotas And Limits",
        topic: "apps_script.quotas",
        sourceTier: "google_developer_official",
        appliesTo: ["Google Apps Script", "Google Workspace"],
        symptoms: [
          "An Apps Script automation stops with a quota exception",
          "A script works for small runs but fails at office scale",
          "The user needs to understand mutable service limits",
        ],
        steps: [
          "Read the exact exception message before changing the script.",
          "Compare the failing operation with the current Apps Script quotas.",
          "Reduce unnecessary service calls, batch work, or schedule smaller runs.",
          "Treat published quotas as subject to change and re-check them when planning recurring automations.",
        ],
        verification: [
          "The exception message identifies the service or quota involved.",
          "The proposed mitigation reduces calls, runtime, or batch size.",
          "The current Apps Script quotas are checked before committing to the automation design.",
        ],
        risk: "medium",
        sourceUrls: [
          "https://developers.google.com/apps-script/guides/services/quotas",
        ],
        lastVerified: "2026-06-18",
        tags: ["apps-script", "quotas", "automation", "limits"],
        commonQuestions: [
          "Apps Script hit a quota. What should I check first?",
          "How should I reduce office-scale Apps Script failures?",
          "What evidence should I collect before changing an automation?",
        ],
        relatedRecordIds: [
          "apps-script-overview",
          "sheets-macros-apps-script",
          "workspace-admin-policy-boundaries",
        ],
      },
    ] satisfies LocalExpertRecord[]
  ).map(withGoogleRecordDefaults),
  scenarios: [
    {
      id: "client-cannot-open-shared-file",
      title: "Client cannot open shared file",
      prompt:
        "A client or outside collaborator says they cannot open a shared Google file.",
      recordIds: [
        "drive-share-specific-people",
        "drive-public-link-risk",
        "workspace-admin-policy-boundaries",
      ],
      requiredEvidence: [
        "Exact error text or access request message",
        "Whether the collaborator is inside or outside the Workspace organization",
        "Current role shown in Share: viewer, commenter, or editor",
        "General access setting: restricted or link-based",
      ],
      expectedSections: GOOGLE_SCENARIO_SECTIONS,
      risk: "medium",
    },
    {
      id: "private-file-shared-too-broadly",
      title: "Private file was shared too broadly",
      prompt:
        "A sensitive Google file may have been shared with too many people or with anyone who has the link.",
      recordIds: [
        "drive-public-link-risk",
        "drive-stop-limit-sharing",
        "workspace-admin-policy-boundaries",
      ],
      requiredEvidence: [
        "General access setting from the Share dialog",
        "People and groups currently listed with access",
        "Sensitivity of the file contents",
        "Whether editors can change permissions or share the file",
      ],
      expectedSections: GOOGLE_SCENARIO_SECTIONS,
      risk: "high",
    },
    {
      id: "sheets-macro-asks-for-authorization",
      title: "Sheets macro asks for authorization",
      prompt:
        "A Google Sheets macro asks for authorization or opens Apps Script before it can run.",
      recordIds: [
        "sheets-macros-apps-script",
        "apps-script-overview",
        "workspace-admin-policy-boundaries",
      ],
      requiredEvidence: [
        "The authorization prompt text",
        "The linked Apps Script project or generated macro code",
        "Which spreadsheet action the macro should perform",
        "Whether Apps Script is enabled for the account",
      ],
      expectedSections: GOOGLE_SCENARIO_SECTIONS,
      risk: "medium",
    },
    {
      id: "apps-script-quota-exception",
      title: "Apps Script quota exception",
      prompt:
        "An Apps Script automation fails with a quota, limit, or service exception during office-scale use.",
      recordIds: [
        "apps-script-quotas",
        "apps-script-overview",
        "workspace-admin-policy-boundaries",
      ],
      requiredEvidence: [
        "Exact exception message",
        "Google service named in the exception",
        "Run frequency, batch size, or trigger schedule",
        "Whether the failure affects one user or multiple users",
      ],
      expectedSections: GOOGLE_SCENARIO_SECTIONS,
      risk: "medium",
    },
    {
      id: "slides-review-only-comments",
      title: "Slides deck needs review-only comments",
      prompt:
        "A presentation should be shared for review comments without giving reviewers edit access.",
      recordIds: [
        "slides-create-format-share",
        "drive-share-specific-people",
        "drive-public-link-risk",
      ],
      requiredEvidence: [
        "Who needs to review the deck",
        "Whether reviewers are inside or outside the organization",
        "Current Share role for reviewers",
        "Whether the deck contains sensitive information",
      ],
      expectedSections: GOOGLE_SCENARIO_SECTIONS,
      risk: "low",
    },
    {
      id: "admin-policy-blocks-workflow",
      title: "Admin policy blocks sharing or automation",
      prompt:
        "A Workspace admin policy appears to block sharing, Apps Script, app authorization, or Marketplace add-ons.",
      recordIds: [
        "workspace-admin-policy-boundaries",
        "drive-share-specific-people",
        "apps-script-overview",
        "sheets-macros-apps-script",
      ],
      requiredEvidence: [
        "Exact policy or administrator-controlled access message",
        "Affected service: Drive, Docs editors, Apps Script, or Marketplace",
        "Whether the account is work/school managed",
        "The business workflow the user is trying to complete",
      ],
      expectedSections: GOOGLE_SCENARIO_SECTIONS,
      risk: "high",
    },
  ],
};
