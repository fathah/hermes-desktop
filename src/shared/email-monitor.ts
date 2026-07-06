export type EmailTriageLabel =
  | "urgent"
  | "action"
  | "knowledge"
  | "archive"
  | "ignore";

export type EmailMonitorFeedbackAction =
  | "not-relevant"
  | "always-capture-sender"
  | "ignore-sender"
  | "raise-priority";

export interface EmailMonitorAccount {
  id: string;
  label: string;
  emailAddress: string;
  imapHost: string;
  imapPort: number;
  secure: boolean;
  username: string;
  passwordEnvKey?: string;
  enabled: boolean;
  folders: string[];
  allowSenders: string[];
  allowDomains: string[];
  blockSenders: string[];
  blockDomains: string[];
  importanceKeywords: string[];
  ignoredKeywords: string[];
  captureThreshold: number;
  maxMessageBytes: number;
  maxAttachmentBytes: number;
  pollLimit: number;
  // When on, bulk/low-priority mail (newsletters, list mail) is captured into
  // a collapsed "Newsletters" digest lane instead of being skipped outright.
  digestBulk: boolean;
}

export interface EmailMonitorConfig {
  accounts: EmailMonitorAccount[];
}

export type EmailMonitorAccountState =
  | "disabled"
  | "idle"
  | "running"
  | "error";

export interface EmailMonitorAccountStatus {
  accountId: string;
  label: string;
  emailAddress: string;
  state: EmailMonitorAccountState;
  captured: number;
  skipped: number;
  errors: number;
  lastRunAt?: number;
  lastError?: string;
  skippedReasons?: Record<string, number>;
}

export interface EmailMonitorStatus {
  running: boolean;
  accounts: EmailMonitorAccountStatus[];
}

export interface EmailMonitorRunResult {
  ok: boolean;
  captured: number;
  skipped: number;
  errors: number;
  accounts: EmailMonitorAccountStatus[];
  error?: string;
}

export interface EmailMonitorCandidate {
  from: string;
  subject: string;
  headers: Record<string, string | undefined>;
  bodyPreview?: string;
}

export interface EmailTriageResult {
  capture: boolean;
  label: EmailTriageLabel;
  reason: string;
  confidence: number;
  // True when this capture only exists because the account's digestBulk
  // toggle rescued bulk mail for the digest lane. Digest verdicts are
  // decisive rule outcomes — never LLM-borderline.
  digest?: boolean;
}

export interface EmailMonitorFeedback {
  accountId: string;
  action: EmailMonitorFeedbackAction;
  sender?: string;
  keyword?: string;
}

const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;
const DEFAULT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const DEFAULT_CAPTURE_THRESHOLD = 0.45;
const DEFAULT_POLL_LIMIT = 25;
const JUNK_FOLDER_RE =
  /(^|[/\\])(spam|junk|junk email|trash|deleted items|bin|promotions)([/\\]|$)/i;
const BULK_PRECEDENCE = new Set(["bulk", "junk", "list"]);
const URGENT_KEYWORDS = new Set([
  "urgent",
  "emergency",
  "incident",
  "code amber",
  "breach",
  "alarm",
]);

export const DEFAULT_EMAIL_MONITOR_ACCOUNT: EmailMonitorAccount = {
  id: "default",
  label: "Email",
  emailAddress: "",
  imapHost: "",
  imapPort: 993,
  secure: true,
  username: "",
  passwordEnvKey: "EMAIL_PASSWORD",
  enabled: false,
  folders: ["INBOX"],
  allowSenders: [],
  allowDomains: [],
  blockSenders: [],
  blockDomains: [],
  importanceKeywords: [
    "incident",
    "roster",
    "attendance",
    "compliance",
    "handover",
    "site",
    "client",
  ],
  ignoredKeywords: [],
  captureThreshold: DEFAULT_CAPTURE_THRESHOLD,
  maxMessageBytes: DEFAULT_MAX_MESSAGE_BYTES,
  maxAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
  pollLimit: DEFAULT_POLL_LIMIT,
  digestBulk: false,
};

export const DEFAULT_EMAIL_MONITOR_CONFIG: EmailMonitorConfig = {
  accounts: [DEFAULT_EMAIL_MONITOR_ACCOUNT],
};

export function shouldMonitorFolder(folder: string): boolean {
  const normalized = folder.trim();
  return !!normalized && !JUNK_FOLDER_RE.test(normalized);
}

// Derive a distinct env var name that holds an account's IMAP password. The
// first account keeps the historical shared "EMAIL_PASSWORD" for backward
// compatibility (single-account env setups); every additional account gets a
// per-account key so account #2+ can't silently read account #1's password.
export function defaultPasswordEnvKey(
  accountId: string,
  index: number,
): string {
  if (index <= 0) return "EMAIL_PASSWORD";
  const suffix = accountId
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return suffix ? `EMAIL_PASSWORD_${suffix}` : `EMAIL_PASSWORD_${index}`;
}

export function normalizeEmailMonitorConfig(
  input: unknown,
): EmailMonitorConfig {
  const raw = isRecord(input) ? input : {};
  const rawAccounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  const accounts = rawAccounts.length
    ? rawAccounts.map(normalizeAccount)
    : DEFAULT_EMAIL_MONITOR_CONFIG.accounts;
  return {
    accounts: accounts.map((account, index) =>
      account.passwordEnvKey
        ? account
        : {
            ...account,
            passwordEnvKey: defaultPasswordEnvKey(account.id, index),
          },
    ),
  };
}

// True when at least one account is switched on AND has the minimum IMAP
// credentials to connect. The scheduler uses this to skip needless polling
// (and connection churn) when nothing is configured to run.
export function emailMonitorHasActiveAccount(
  config: EmailMonitorConfig,
): boolean {
  return config.accounts.some(
    (account) =>
      account.enabled &&
      Boolean(account.imapHost) &&
      Boolean(account.emailAddress),
  );
}

export function classifyEmailCandidate(
  candidate: EmailMonitorCandidate,
  account: EmailMonitorAccount,
): EmailTriageResult {
  const normalized = normalizeAccount(account);
  const sender = normalizeEmailAddress(candidate.from);
  const domain = sender.split("@")[1] ?? "";
  const haystack = `${candidate.subject}\n${candidate.bodyPreview ?? ""}`;
  const lowerHaystack = haystack.toLowerCase();

  if (normalized.blockSenders.includes(sender)) {
    return ignore(`Blocked sender ${sender}.`, 0.98);
  }
  if (domain && normalized.blockDomains.includes(domain)) {
    return ignore(`Blocked sender domain ${domain}.`, 0.98);
  }

  const ignored = normalized.ignoredKeywords.find((keyword) =>
    matchesKeyword(lowerHaystack, keyword),
  );
  if (ignored) return ignore(`Matched ignored keyword "${ignored}".`, 0.9);

  const allowlistedSender = normalized.allowSenders.includes(sender);
  const allowlistedDomain = domain && normalized.allowDomains.includes(domain);
  const important = normalized.importanceKeywords.find((keyword) =>
    matchesKeyword(lowerHaystack, keyword),
  );

  if (allowlistedSender || allowlistedDomain) {
    const label = important ? labelForKeyword(important) : "knowledge";
    return {
      capture: true,
      label,
      confidence: important ? 0.9 : 0.82,
      reason: `${allowlistedSender ? "Matched allowlisted sender" : "Matched allowlisted domain"}${important ? ` and keyword "${important}"` : ""}.`,
    };
  }

  // Importance is checked BEFORE bulk-mail suppression: a genuine incident /
  // alert that also carries bulk headers (e.g. Auto-Submitted from a monitoring
  // system) must still be captured, not silently dropped. Keeping this ahead of
  // isBulkMail also makes the "without an important match" reason below truthful.
  if (important) {
    return {
      capture: true,
      label: labelForKeyword(important),
      confidence: 0.78,
      reason: `Matched important keyword "${important}".`,
    };
  }

  if (isBulkMail(candidate)) {
    if (normalized.digestBulk) {
      return {
        capture: true,
        label: "archive",
        confidence: 0.92,
        reason: "Bulk mail captured for the newsletter digest.",
        digest: true,
      };
    }
    return ignore("Skipped bulk mail without an important match.", 0.92);
  }

  return {
    capture: true,
    label: "archive",
    confidence: DEFAULT_CAPTURE_THRESHOLD,
    reason: "No strong junk or importance signal; capture for review.",
  };
}

export function applyEmailMonitorFeedback(
  config: EmailMonitorConfig,
  feedback: EmailMonitorFeedback,
): EmailMonitorConfig {
  const normalized = normalizeEmailMonitorConfig(config);
  return {
    accounts: normalized.accounts.map((account) => {
      if (account.id !== feedback.accountId) return account;
      const sender = normalizeEmailAddress(feedback.sender ?? "");
      const keyword = feedback.keyword?.trim();
      if (
        (feedback.action === "ignore-sender" ||
          feedback.action === "not-relevant") &&
        sender
      ) {
        return {
          ...account,
          blockSenders: appendUnique(account.blockSenders, sender),
        };
      }
      if (feedback.action === "always-capture-sender" && sender) {
        return {
          ...account,
          allowSenders: appendUnique(account.allowSenders, sender),
          blockSenders: account.blockSenders.filter((s) => s !== sender),
        };
      }
      if (feedback.action === "raise-priority" && keyword) {
        return {
          ...account,
          importanceKeywords: appendUnique(account.importanceKeywords, keyword),
        };
      }
      // NOTE(deferred): per-sender priority tiers don't exist yet, so a
      // sender-scoped "raise priority" (from a capture card) allowlists the
      // sender — future mail is always captured. Upgrade path: a senderPriority
      // map that feeds the triage label directly.
      if (feedback.action === "raise-priority" && sender) {
        return {
          ...account,
          allowSenders: appendUnique(account.allowSenders, sender),
          blockSenders: account.blockSenders.filter((s) => s !== sender),
        };
      }
      return account;
    }),
  };
}

export function normalizeEmailAddress(raw: string): string {
  const match = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return (match?.[0] ?? "").toLowerCase();
}

function normalizeAccount(input: unknown): EmailMonitorAccount {
  const raw = isRecord(input) ? input : {};
  const emailAddress = stringValue(raw.emailAddress);
  const username = stringValue(raw.username) || emailAddress;
  return {
    ...DEFAULT_EMAIL_MONITOR_ACCOUNT,
    id: stringValue(raw.id) || emailAddress || DEFAULT_EMAIL_MONITOR_ACCOUNT.id,
    label:
      stringValue(raw.label) ||
      emailAddress ||
      DEFAULT_EMAIL_MONITOR_ACCOUNT.label,
    emailAddress,
    imapHost: stringValue(raw.imapHost),
    imapPort: numberValue(raw.imapPort, DEFAULT_EMAIL_MONITOR_ACCOUNT.imapPort),
    secure:
      typeof raw.secure === "boolean"
        ? raw.secure
        : DEFAULT_EMAIL_MONITOR_ACCOUNT.secure,
    username,
    passwordEnvKey: envKeyValue(raw.passwordEnvKey),
    enabled: raw.enabled === true,
    folders: normalizeFolders(raw.folders),
    allowSenders: normalizeAddressList(raw.allowSenders),
    allowDomains: normalizeTextList(raw.allowDomains).map(stripAt),
    blockSenders: normalizeAddressList(raw.blockSenders),
    blockDomains: normalizeTextList(raw.blockDomains).map(stripAt),
    importanceKeywords:
      normalizeTextList(raw.importanceKeywords).length > 0
        ? normalizeTextList(raw.importanceKeywords)
        : DEFAULT_EMAIL_MONITOR_ACCOUNT.importanceKeywords,
    ignoredKeywords: normalizeTextList(raw.ignoredKeywords),
    captureThreshold: clamp01(
      numberValue(
        raw.captureThreshold,
        DEFAULT_EMAIL_MONITOR_ACCOUNT.captureThreshold,
      ),
    ),
    maxMessageBytes: positiveNumber(
      raw.maxMessageBytes,
      DEFAULT_EMAIL_MONITOR_ACCOUNT.maxMessageBytes,
    ),
    maxAttachmentBytes: positiveNumber(
      raw.maxAttachmentBytes,
      DEFAULT_EMAIL_MONITOR_ACCOUNT.maxAttachmentBytes,
    ),
    pollLimit: Math.max(
      1,
      Math.floor(
        positiveNumber(raw.pollLimit, DEFAULT_EMAIL_MONITOR_ACCOUNT.pollLimit),
      ),
    ),
    digestBulk: raw.digestBulk === true,
  };
}

function normalizeFolders(value: unknown): string[] {
  const folders = normalizeTextList(value).filter(shouldMonitorFolder);
  return folders.length ? folders : DEFAULT_EMAIL_MONITOR_ACCOUNT.folders;
}

function normalizeAddressList(value: unknown): string[] {
  return normalizeTextList(value).map(normalizeEmailAddress).filter(Boolean);
}

function normalizeTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map(stringValue)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function envKeyValue(value: unknown): string | undefined {
  const key = stringValue(value);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : undefined;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const n = numberValue(value, fallback);
  return n > 0 ? n : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stripAt(value: string): string {
  return value.replace(/^@/, "").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isBulkMail(candidate: EmailMonitorCandidate): boolean {
  const headers = Object.fromEntries(
    Object.entries(candidate.headers).map(([key, value]) => [
      key.toLowerCase(),
      String(value ?? "").toLowerCase(),
    ]),
  );
  const precedence = headers.precedence?.trim();
  if (precedence && BULK_PRECEDENCE.has(precedence)) return true;
  if (headers["list-unsubscribe"]) return true;
  if (headers["auto-submitted"] && headers["auto-submitted"] !== "no") {
    return true;
  }
  const sender = normalizeEmailAddress(candidate.from);
  return sender.startsWith("no-reply@") || sender.startsWith("noreply@");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word match so a keyword like "site" does not fire on "website" and
// "incident" does not fire on "coincidentally". Multi-word keywords (e.g.
// "code amber") are matched verbatim between word boundaries.
function matchesKeyword(lowerHaystack: string, keyword: string): boolean {
  const trimmed = keyword.trim().toLowerCase();
  if (!trimmed) return false;
  const re = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`);
  return re.test(lowerHaystack);
}

function labelForKeyword(keyword: string): EmailTriageLabel {
  return URGENT_KEYWORDS.has(keyword.toLowerCase()) ? "urgent" : "action";
}

function ignore(reason: string, confidence: number): EmailTriageResult {
  return { capture: false, label: "ignore", reason, confidence };
}
