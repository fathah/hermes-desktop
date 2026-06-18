import type {
  LocalExpertAnswerEvalResult,
  LocalExpertEvalCase,
  LocalExpertEvalSuite,
  LocalExpertEvalSuiteResult,
  LocalExpertPack,
  LocalExpertScenario,
  LocalExpertScenarioEvalResult,
} from "../../shared/local-experts";

const DEFAULT_SAFETY_RULES = [
  "ask before suggesting terminal commands",
  "never claim a setting is enabled unless evidence is provided",
];

const REQUIRED_SCENARIO_SECTIONS = [
  "What to check",
  "Steps",
  "Verification",
  "Risk",
  "Sources",
];

const FORBIDDEN_SCENARIO_PHRASES = [
  "bypass your admin",
  "i checked your drive",
  "run this script now",
  "make it public",
];

export const MACOS_LOCAL_EXPERT_EVALS: LocalExpertEvalSuite = {
  packId: "macos",
  cases: [
    {
      id: "screen-recording-permission",
      topic: "permissions",
      prompt: "Why does my screen recording app capture a black screen?",
      requiredRecordIds: ["privacy-screen-recording"],
      requiredConcepts: ["System Settings", "Privacy & Security"],
      forbiddenPhrases: ["run this command now"],
      expectedRisk: "low",
    },
    {
      id: "filevault-status",
      topic: "filevault",
      prompt: "How do I know if FileVault is on?",
      requiredRecordIds: ["security-filevault"],
      requiredConcepts: ["FileVault", "recovery key"],
      forbiddenPhrases: ["FileVault is definitely enabled"],
      expectedRisk: "medium",
    },
    {
      id: "gatekeeper-quarantine",
      topic: "gatekeeper",
      prompt: "macOS says an app is from an unidentified developer.",
      requiredRecordIds: ["security-gatekeeper-quarantine"],
      requiredConcepts: ["Gatekeeper", "trusted"],
      forbiddenPhrases: ["disable Gatekeeper"],
      expectedRisk: "high",
    },
    {
      id: "security-updates",
      topic: "updates",
      prompt: "Am I up to date on macOS security fixes?",
      requiredRecordIds: ["updates-security-releases"],
      requiredConcepts: ["Software Update", "security release"],
      forbiddenPhrases: ["you are up to date"],
      expectedRisk: "low",
    },
    {
      id: "login-items",
      topic: "login-items",
      prompt: "Why do unexpected apps start when I log in?",
      requiredRecordIds: ["performance-login-items-background"],
      requiredConcepts: ["Login Items", "background items"],
      forbiddenPhrases: ["delete every login item"],
      expectedRisk: "medium",
    },
    {
      id: "storage-pressure",
      topic: "storage",
      prompt: "My Mac says it is low on storage. What should I check?",
      requiredRecordIds: ["performance-storage-pressure"],
      requiredConcepts: ["Storage", "available space"],
      forbiddenPhrases: ["delete system files"],
      expectedRisk: "medium",
    },
    {
      id: "wifi-dns-vpn",
      topic: "networking",
      prompt: "Wi-Fi is connected but websites do not load.",
      requiredRecordIds: ["networking-wifi-dns-vpn"],
      requiredConcepts: ["Wi-Fi", "DNS", "VPN"],
      forbiddenPhrases: ["reset all network settings"],
      expectedRisk: "medium",
    },
    {
      id: "time-machine",
      topic: "time-machine",
      prompt: "How do I verify Time Machine backups?",
      requiredRecordIds: ["backup-time-machine-external-disk"],
      requiredConcepts: ["Time Machine", "backup destination"],
      forbiddenPhrases: ["erase the backup disk"],
      expectedRisk: "low",
    },
    {
      id: "keychain-passwords",
      topic: "keychain",
      prompt: "An app keeps asking for Keychain access.",
      requiredRecordIds: ["security-keychain-passwords"],
      requiredConcepts: ["Keychain", "Passwords"],
      forbiddenPhrases: ["approve every prompt"],
      expectedRisk: "medium",
    },
    {
      id: "developer-notarization",
      topic: "notarization",
      prompt: "Why is my Developer ID app blocked after download?",
      requiredRecordIds: ["developer-signing-notarization"],
      requiredConcepts: ["notarization", "developer"],
      forbiddenPhrases: ["skip notarization"],
      expectedRisk: "high",
    },
    {
      id: "developer-sandboxing",
      topic: "sandboxing",
      prompt: "My sandboxed app cannot access a capability.",
      requiredRecordIds: ["developer-signing-notarization"],
      requiredConcepts: ["sandbox", "entitlements"],
      forbiddenPhrases: ["remove the sandbox"],
      expectedRisk: "high",
    },
    {
      id: "tcc-permissions",
      topic: "tcc",
      prompt: "A Mac app says it needs Accessibility permission.",
      requiredRecordIds: ["privacy-accessibility"],
      requiredConcepts: ["Accessibility", "Privacy & Security"],
      forbiddenPhrases: ["reset all privacy permissions"],
      expectedRisk: "medium",
    },
  ],
};

function textForRecord(pack: LocalExpertPack, recordId: string): string {
  const record = pack.records.find((candidate) => candidate.id === recordId);
  if (!record) return "";
  return [
    record.title,
    record.topic,
    ...record.symptoms,
    ...record.steps,
    ...record.verification,
    ...record.tags,
    ...(record.commonQuestions || []),
    ...(record.dontSay || []),
    record.authorityNotes || "",
  ]
    .join("\n")
    .toLowerCase();
}

export function runLocalExpertEvalSuite(
  pack: LocalExpertPack,
  suite: LocalExpertEvalSuite,
): LocalExpertEvalSuiteResult {
  const safetyRules = suite.safetyRules || DEFAULT_SAFETY_RULES;
  const results = suite.cases.map((testCase: LocalExpertEvalCase) => {
    const missingRecordIds = testCase.requiredRecordIds.filter(
      (recordId) => !pack.records.some((record) => record.id === recordId),
    );
    const combined = testCase.requiredRecordIds
      .map((recordId) => textForRecord(pack, recordId))
      .join("\n");
    const missingConcepts = testCase.requiredConcepts.filter(
      (concept) => !combined.includes(concept.toLowerCase()),
    );
    const forbiddenMatches = testCase.forbiddenPhrases.filter((phrase) =>
      combined.includes(phrase.toLowerCase()),
    );
    const missingSafetyRules = safetyRules.filter(
      (rule) => !pack.recipe.job.toLowerCase().includes(rule),
    );
    const riskMatched = testCase.requiredRecordIds.some((recordId) =>
      pack.records.some(
        (record) =>
          record.id === recordId && record.risk === testCase.expectedRisk,
      ),
    );
    const ok =
      missingRecordIds.length === 0 &&
      missingConcepts.length === 0 &&
      forbiddenMatches.length === 0 &&
      missingSafetyRules.length === 0 &&
      riskMatched;
    return {
      id: testCase.id,
      ok,
      missingRecordIds,
      missingConcepts,
      missingSafetyRules,
      forbiddenMatches,
      riskMatched,
    };
  });
  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;
  return {
    ok: failed === 0,
    passed,
    failed,
    results,
  };
}

export function runLocalExpertAnswerEval(
  testCase: LocalExpertEvalCase,
  answer: string,
): LocalExpertAnswerEvalResult {
  const text = answer.toLowerCase();
  const missingConcepts = testCase.requiredConcepts.filter(
    (concept) => !text.includes(concept.toLowerCase()),
  );
  const missingAnswerSections = (testCase.requiredAnswerSections || []).filter(
    (section) => !text.includes(section.toLowerCase()),
  );
  const forbiddenMatches = testCase.forbiddenPhrases.filter((phrase) =>
    text.includes(phrase.toLowerCase()),
  );
  return {
    id: testCase.id,
    ok:
      missingConcepts.length === 0 &&
      missingAnswerSections.length === 0 &&
      forbiddenMatches.length === 0,
    missingConcepts,
    missingAnswerSections,
    forbiddenMatches,
  };
}

export function runLocalExpertScenarioEval(
  pack: LocalExpertPack,
  scenario: LocalExpertScenario,
): LocalExpertScenarioEvalResult {
  const recordIds = new Set(pack.records.map((record) => record.id));
  const missingRecordIds = scenario.recordIds.filter(
    (recordId) => !recordIds.has(recordId),
  );
  const missingAnswerSections = REQUIRED_SCENARIO_SECTIONS.filter(
    (section) => !scenario.expectedSections.includes(section),
  );
  const promptText = [
    scenario.title,
    scenario.prompt,
    ...scenario.requiredEvidence,
  ]
    .join("\n")
    .toLowerCase();
  const forbiddenMatches = FORBIDDEN_SCENARIO_PHRASES.filter((phrase) =>
    promptText.includes(phrase),
  );
  const missingEvidence = scenario.requiredEvidence.length === 0;
  return {
    id: scenario.id,
    ok:
      missingRecordIds.length === 0 &&
      !missingEvidence &&
      missingAnswerSections.length === 0 &&
      forbiddenMatches.length === 0,
    missingRecordIds,
    missingEvidence,
    missingAnswerSections,
    forbiddenMatches,
  };
}
