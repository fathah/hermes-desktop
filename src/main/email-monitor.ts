import { existsSync, readFileSync } from "fs";
import { extname, join } from "path";
import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { readEnv } from "./config";
import { profileHome, safeWriteFile } from "./utils";
import { writeAsset as writeVaultAsset } from "./sps-assets";
import { writeSpsCapture } from "./sps-capture";
import { resolveSpsVaultDir } from "./sps-storage";
import { triageEmailCandidate } from "./email-triage";
import {
  DEFAULT_EMAIL_MONITOR_ACCOUNT,
  DEFAULT_EMAIL_MONITOR_CONFIG,
  applyEmailMonitorFeedback,
  normalizeEmailMonitorConfig,
  shouldMonitorFolder,
  type EmailMonitorAccount,
  type EmailMonitorConfig,
  type EmailMonitorFeedback,
  type EmailMonitorRunResult,
  type EmailMonitorStatus,
  type EmailTriageLabel,
} from "../shared/email-monitor";
import type {
  SpsCaptureInput,
  SpsEmailCaptureAttachment,
} from "../shared/sps-types";

export { DEFAULT_EMAIL_MONITOR_ACCOUNT };

interface EmailMonitorStore {
  config?: EmailMonitorConfig;
  status?: EmailMonitorStatus;
  cursors?: Record<string, Record<string, number>>;
  // Per account/folder IMAP UIDVALIDITY. When the server reassigns UIDs
  // (mailbox rebuild/migration) this value changes and the stored cursor is no
  // longer meaningful, so the folder must be re-baselined instead of stalling.
  validities?: Record<string, Record<string, number>>;
}

export interface ParsedEmailAttachment {
  filename?: string;
  contentType: string;
  size?: number;
  content: Buffer;
}

export interface ParsedEmailMessage {
  from: string;
  to?: string;
  cc?: string;
  subject: string;
  messageId?: string;
  date?: Date;
  text?: string;
  html?: string | false;
  headers: Record<string, string | undefined>;
  attachments: ParsedEmailAttachment[];
}

export interface HandleParsedEmailMessageInput {
  account: EmailMonitorAccount;
  folder: string;
  uid: number;
  message: ParsedEmailMessage;
}

export type EmailMonitorMessageResult =
  | { status: "skipped"; reason: string; triageLabel: EmailTriageLabel }
  | { status: "captured"; captureId: string; triageLabel: EmailTriageLabel }
  | { status: "error"; reason: string; triageLabel?: EmailTriageLabel };

interface HandleParsedEmailMessageDeps {
  vaultDir: string;
  /** Profile whose gateway the LLM triage layer calls; undefined = default. */
  profile?: string;
  writeCapture?: typeof writeSpsCapture;
  writeAsset?: typeof writeVaultAsset;
}

const runningProfiles = new Set<string>();

export function getEmailMonitorConfig(profile?: string): EmailMonitorConfig {
  return readEmailMonitorStore(profile).config ?? configFromEnv(profile);
}

export function saveEmailMonitorConfig(
  config: EmailMonitorConfig,
  profile?: string,
): EmailMonitorConfig {
  const store = readEmailMonitorStore(profile);
  const normalized = normalizeEmailMonitorConfig(config);
  writeEmailMonitorStore(profile, {
    ...store,
    config: normalized,
    status: hydrateStatus(normalized, store.status, isProfileRunning(profile)),
  });
  return normalized;
}

export function getEmailMonitorStatus(profile?: string): EmailMonitorStatus {
  const store = readEmailMonitorStore(profile);
  const config = store.config ?? configFromEnv(profile);
  return hydrateStatus(config, store.status, isProfileRunning(profile));
}

export function applyEmailMonitorFeedbackForProfile(
  feedback: EmailMonitorFeedback,
  profile?: string,
): EmailMonitorConfig {
  const store = readEmailMonitorStore(profile);
  const config = applyEmailMonitorFeedback(
    store.config ?? configFromEnv(profile),
    feedback,
  );
  writeEmailMonitorStore(profile, {
    ...store,
    config,
    status: hydrateStatus(config, store.status, isProfileRunning(profile)),
  });
  return config;
}

export async function runEmailMonitorNow(
  profile?: string,
): Promise<EmailMonitorRunResult> {
  const key = profileKey(profile);
  if (runningProfiles.has(key)) {
    const status = getEmailMonitorStatus(profile);
    return {
      ok: false,
      captured: 0,
      skipped: 0,
      errors: 1,
      accounts: status.accounts,
      error: "Email monitor is already running.",
    };
  }

  const store = readEmailMonitorStore(profile);
  const config = store.config ?? configFromEnv(profile);
  const cursors = store.cursors ?? {};
  const validities = store.validities ?? {};
  const status = hydrateStatus(config, store.status, true);
  runningProfiles.add(key);
  writeEmailMonitorStore(profile, { config, cursors, validities, status });

  let captured = 0;
  let skipped = 0;
  let errors = 0;

  try {
    for (const account of config.accounts) {
      const accountStatus = status.accounts.find(
        (item) => item.accountId === account.id,
      );
      if (!accountStatus) continue;

      accountStatus.lastRunAt = Date.now();
      accountStatus.skippedReasons ??= {};

      if (!account.enabled) {
        accountStatus.state = "disabled";
        continue;
      }

      accountStatus.state = "running";
      const result = await pollAccount(account, profile, cursors, validities);
      captured += result.captured;
      skipped += result.skipped;
      errors += result.errors;
      accountStatus.captured += result.captured;
      accountStatus.skipped += result.skipped;
      accountStatus.errors += result.errors;
      mergeReasons(accountStatus.skippedReasons, result.skippedReasons);
      accountStatus.lastError = result.lastError;
      accountStatus.state = result.errors > 0 ? "error" : "idle";
    }
  } finally {
    runningProfiles.delete(key);
    const settled = hydrateStatus(config, status, false);
    writeEmailMonitorStore(profile, {
      config,
      cursors,
      validities,
      status: settled,
    });
  }

  const finalStatus = getEmailMonitorStatus(profile);
  return {
    ok: errors === 0,
    captured,
    skipped,
    errors,
    accounts: finalStatus.accounts,
    ...(errors > 0 ? { error: "One or more email accounts failed." } : {}),
  };
}

export async function handleParsedEmailMessage(
  input: HandleParsedEmailMessageInput,
  deps: HandleParsedEmailMessageDeps,
): Promise<EmailMonitorMessageResult> {
  const triage = await triageEmailCandidate(
    {
      from: input.message.from,
      subject: input.message.subject,
      headers: input.message.headers,
      bodyPreview: input.message.text,
    },
    input.account,
    { profile: deps.profile },
  );

  if (!triage.capture) {
    return {
      status: "skipped",
      reason: triage.reason,
      triageLabel: triage.label,
    };
  }

  const writeAsset = deps.writeAsset ?? writeVaultAsset;
  const attachments: SpsEmailCaptureAttachment[] = [];
  for (const attachment of input.message.attachments) {
    const size = attachment.size ?? attachment.content.byteLength;
    if (size > input.account.maxAttachmentBytes) continue;
    const assetPath = await writeAsset(
      deps.vaultDir,
      attachment.content,
      attachmentExt(attachment),
    );
    attachments.push({
      assetPath,
      originalName: attachment.filename?.trim() || assetPath,
      mime: attachment.contentType || "application/octet-stream",
      size,
    });
  }

  const writeCapture = deps.writeCapture ?? writeSpsCapture;
  const capture = await writeCapture(deps.vaultDir, {
    source: "email",
    title: input.message.subject || "Email capture",
    body: buildEmailCaptureBody(input.message, attachments),
    capturedAt: input.message.date?.getTime() ?? Date.now(),
    via: "email-monitor",
    captureKind: "source",
    schema: "source",
    provenance: `Email monitor: ${input.account.label}`,
    triageLabel: triage.label,
    triageReason: triage.reason,
    triageConfidence: triage.confidence,
    emailAccount: input.account.label,
    messageId: input.message.messageId,
    folder: input.folder,
    uid: input.uid,
    attachments,
  } satisfies SpsCaptureInput);

  if (!capture.success || !capture.id) {
    return {
      status: "error",
      reason: capture.error || "Could not write email capture.",
      triageLabel: triage.label,
    };
  }

  return {
    status: "captured",
    captureId: capture.id,
    triageLabel: triage.label,
  };
}

async function pollAccount(
  account: EmailMonitorAccount,
  profile: string | undefined,
  cursors: NonNullable<EmailMonitorStore["cursors"]>,
  validities: NonNullable<EmailMonitorStore["validities"]>,
): Promise<{
  captured: number;
  skipped: number;
  errors: number;
  skippedReasons: Record<string, number>;
  lastError?: string;
}> {
  const result = {
    captured: 0,
    skipped: 0,
    errors: 0,
    skippedReasons: {} as Record<string, number>,
    lastError: undefined as string | undefined,
  };
  const password = accountPassword(account, profile);
  const user = account.username || account.emailAddress;
  if (!account.imapHost || !user || !password) {
    return {
      ...result,
      errors: 1,
      lastError: "Missing IMAP host, username, or password env key.",
    };
  }

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.secure,
    auth: { user, pass: password },
    disableAutoIdle: true,
    logger: false,
    connectionTimeout: 30_000,
    greetingTimeout: 16_000,
    socketTimeout: 60_000,
    maxLiteralSize: account.maxMessageBytes,
  });

  const accountCursors = (cursors[account.id] ??= {});
  const accountValidities = (validities[account.id] ??= {});
  try {
    await client.connect();
    for (const folder of account.folders) {
      // Isolate each folder: a renamed/deleted folder throws on mailboxOpen, and
      // without this guard it would abort the loop and starve every folder listed
      // after it for the whole run.
      try {
        await pollFolder(
          client,
          account,
          folder,
          accountCursors,
          accountValidities,
          result,
          profile,
        );
      } catch (e) {
        result.errors += 1;
        result.lastError = e instanceof Error ? e.message : String(e);
      }
    }
  } catch (e) {
    result.errors += 1;
    result.lastError = e instanceof Error ? e.message : String(e);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
  return result;
}

async function pollFolder(
  client: ImapFlow,
  account: EmailMonitorAccount,
  folder: string,
  accountCursors: Record<string, number>,
  accountValidities: Record<string, number>,
  result: {
    captured: number;
    skipped: number;
    errors: number;
    skippedReasons: Record<string, number>;
    lastError?: string;
  },
  profile?: string,
): Promise<void> {
  if (!shouldMonitorFolder(folder)) {
    countSkip(result, `Excluded folder ${folder}.`);
    return;
  }

  const mailbox = await client.mailboxOpen(folder, { readOnly: true });

  // UIDVALIDITY guard: if the server reassigned UIDs since we last polled, the
  // stored cursor points into a defunct UID epoch. Left alone this silently
  // stalls the folder forever (search from a stale-high cursor returns nothing
  // and never resets). Detect the change and re-baseline the folder.
  const currentValidity =
    mailbox.uidValidity != null ? Number(mailbox.uidValidity) : 0;
  const storedValidity = accountValidities[folder];
  let previousUid = accountCursors[folder] ?? 0;
  if (
    currentValidity > 0 &&
    storedValidity != null &&
    storedValidity !== currentValidity
  ) {
    previousUid = 0;
    accountCursors[folder] = 0;
  }
  if (currentValidity > 0) accountValidities[folder] = currentValidity;

  const uidNext = mailbox.uidNext || 1;
  const startUid =
    previousUid > 0
      ? previousUid + 1
      : Math.max(1, uidNext - account.pollLimit);
  const found = await client.search({ uid: `${startUid}:*` }, { uid: true });
  // Process the OLDEST unseen messages first, capped at pollLimit. The cursor
  // then advances only as far as the messages we actually fetched, so any
  // backlog beyond pollLimit is drained on subsequent runs instead of being
  // silently skipped (which the previous `.slice(-pollLimit)` did).
  const uids = (Array.isArray(found) ? found : [])
    .filter((uid) => uid > previousUid)
    .sort((a, b) => a - b)
    .slice(0, account.pollLimit);

  if (!uids.length) {
    if (previousUid === 0 && uidNext > 1) accountCursors[folder] = uidNext - 1;
    return;
  }

  const vaultDir = resolveSpsVaultDir(profile);
  for await (const message of client.fetch(
    uids,
    {
      uid: true,
      size: true,
      source: { maxLength: account.maxMessageBytes },
    },
    { uid: true },
  )) {
    await handleFetchedMessage(
      account,
      folder,
      message,
      vaultDir,
      accountCursors,
      result,
      profile,
    );
  }
}

async function handleFetchedMessage(
  account: EmailMonitorAccount,
  folder: string,
  message: FetchMessageObject,
  vaultDir: string,
  accountCursors: Record<string, number>,
  result: {
    captured: number;
    skipped: number;
    errors: number;
    skippedReasons: Record<string, number>;
    lastError?: string;
  },
  profile?: string,
): Promise<void> {
  if (
    typeof message.size === "number" &&
    message.size > account.maxMessageBytes
  ) {
    countSkip(result, `Skipped message over ${account.maxMessageBytes} bytes.`);
    accountCursors[folder] = Math.max(accountCursors[folder] ?? 0, message.uid);
    return;
  }

  if (!message.source) {
    countSkip(result, "Skipped message without fetchable source.");
    accountCursors[folder] = Math.max(accountCursors[folder] ?? 0, message.uid);
    return;
  }

  let parsed: ParsedMail;
  try {
    parsed = await simpleParser(message.source, {
      skipHtmlToText: true,
      skipTextLinks: true,
    });
  } catch (e) {
    result.errors += 1;
    result.lastError = e instanceof Error ? e.message : String(e);
    accountCursors[folder] = Math.max(accountCursors[folder] ?? 0, message.uid);
    return;
  }

  const handled = await handleParsedEmailMessage(
    {
      account,
      folder,
      uid: message.uid,
      message: parsedToMessage(parsed),
    },
    { vaultDir, profile },
  );

  if (handled.status === "captured") {
    result.captured += 1;
    accountCursors[folder] = Math.max(accountCursors[folder] ?? 0, message.uid);
    return;
  }
  if (handled.status === "skipped") {
    countSkip(result, handled.reason);
    accountCursors[folder] = Math.max(accountCursors[folder] ?? 0, message.uid);
    return;
  }

  result.errors += 1;
  result.lastError = handled.reason;
}

function parsedToMessage(parsed: ParsedMail): ParsedEmailMessage {
  return {
    from: parsed.from?.text ?? "",
    to: addressText(parsed.to),
    cc: addressText(parsed.cc),
    subject: parsed.subject ?? "Email capture",
    messageId: parsed.messageId,
    date: parsed.date,
    text: parsed.text,
    html: parsed.html,
    headers: headersToRecord(parsed.headers),
    attachments: parsed.attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      content: attachment.content,
    })),
  };
}

function addressText(
  value: AddressObject | AddressObject[] | undefined,
): string | undefined {
  if (!value) return undefined;
  const items = Array.isArray(value) ? value : [value];
  const text = items
    .map((item) => item.text)
    .filter(Boolean)
    .join(", ");
  return text || undefined;
}

function headersToRecord(
  headers: ParsedMail["headers"],
): Record<string, string | undefined> {
  const record: Record<string, string | undefined> = {};
  for (const [key, value] of headers) {
    record[key.toLowerCase()] = headerValueText(value);
  }
  return record;
}

function headerValueText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map(headerValueText).filter(Boolean).join(", ");
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("value" in value && typeof value.value === "string") return value.value;
  }
  return value == null ? undefined : String(value);
}

function countSkip(
  result: { skipped: number; skippedReasons: Record<string, number> },
  reason: string,
): void {
  result.skipped += 1;
  result.skippedReasons[reason] = (result.skippedReasons[reason] ?? 0) + 1;
}

function accountPassword(
  account: EmailMonitorAccount,
  profile?: string,
): string {
  const key = account.passwordEnvKey || "EMAIL_PASSWORD";
  const env = readEnv(profile);
  return env[key] || process.env[key] || "";
}

function readEmailMonitorStore(profile?: string): EmailMonitorStore {
  const path = emailMonitorStorePath(profile);
  const fallback = {
    config: configFromEnv(profile),
    cursors: {},
    validities: {},
    status: undefined,
  };
  if (!existsSync(path)) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as EmailMonitorStore;
    const config = normalizeEmailMonitorConfig(parsed.config);
    return {
      config,
      cursors: normalizeCursors(parsed.cursors),
      validities: normalizeCursors(parsed.validities),
      status: hydrateStatus(config, parsed.status, isProfileRunning(profile)),
    };
  } catch {
    return fallback;
  }
}

function writeEmailMonitorStore(
  profile: string | undefined,
  store: EmailMonitorStore,
): void {
  safeWriteFile(
    emailMonitorStorePath(profile),
    `${JSON.stringify(
      {
        config: normalizeEmailMonitorConfig(store.config),
        status: store.status,
        cursors: normalizeCursors(store.cursors),
        validities: normalizeCursors(store.validities),
      },
      null,
      2,
    )}\n`,
  );
}

function emailMonitorStorePath(profile?: string): string {
  return join(profileHome(profile), "sps-agent", "email-monitor.json");
}

function configFromEnv(profile?: string): EmailMonitorConfig {
  const env = readEnv(profile);
  const server = parseImapServer(env.EMAIL_IMAP_SERVER);
  if (!env.EMAIL_ADDRESS && !server.host) return DEFAULT_EMAIL_MONITOR_CONFIG;
  return normalizeEmailMonitorConfig({
    accounts: [
      {
        ...DEFAULT_EMAIL_MONITOR_ACCOUNT,
        id: env.EMAIL_ADDRESS || "default",
        label: env.EMAIL_ADDRESS || "Email",
        emailAddress: env.EMAIL_ADDRESS || "",
        username: env.EMAIL_ADDRESS || "",
        imapHost: server.host,
        imapPort: server.port ?? DEFAULT_EMAIL_MONITOR_ACCOUNT.imapPort,
        secure: server.secure,
        passwordEnvKey: "EMAIL_PASSWORD",
        // Opt-in: the env-derived account only polls when the operator sets
        // EMAIL_MONITOR_ENABLED=true. The GUI account manager (Slice 2) flips
        // this per account; here it stays an explicit, documented switch.
        enabled: env.EMAIL_MONITOR_ENABLED === "true",
      },
    ],
  });
}

function parseImapServer(raw: string | undefined): {
  host: string;
  port?: number;
  secure: boolean;
} {
  const value = raw?.trim() ?? "";
  if (!value) return { host: "", secure: true };
  const match = value.match(/^(.+):(\d+)$/);
  if (!match) return { host: value, secure: true };
  const port = Number(match[2]);
  return {
    host: match[1],
    port: Number.isFinite(port) ? port : undefined,
    secure: port !== 143,
  };
}

function hydrateStatus(
  config: EmailMonitorConfig,
  existing: EmailMonitorStatus | undefined,
  running: boolean,
): EmailMonitorStatus {
  const byId = new Map(
    (existing?.accounts ?? []).map((account) => [account.accountId, account]),
  );
  return {
    running,
    accounts: config.accounts.map((account) => {
      const prior = byId.get(account.id);
      return {
        accountId: account.id,
        label: account.label,
        emailAddress: account.emailAddress,
        state: !account.enabled
          ? "disabled"
          : running
            ? "running"
            : prior?.state === "error"
              ? "error"
              : "idle",
        captured: prior?.captured ?? 0,
        skipped: prior?.skipped ?? 0,
        errors: prior?.errors ?? 0,
        ...(prior?.lastRunAt ? { lastRunAt: prior.lastRunAt } : {}),
        ...(prior?.lastError ? { lastError: prior.lastError } : {}),
        ...(prior?.skippedReasons
          ? { skippedReasons: prior.skippedReasons }
          : {}),
      };
    }),
  };
}

function normalizeCursors(
  input: EmailMonitorStore["cursors"],
): NonNullable<EmailMonitorStore["cursors"]> {
  const output: NonNullable<EmailMonitorStore["cursors"]> = {};
  if (!input || typeof input !== "object") return output;
  for (const [accountId, folders] of Object.entries(input)) {
    if (!folders || typeof folders !== "object") continue;
    output[accountId] = {};
    for (const [folder, uid] of Object.entries(folders)) {
      if (typeof uid === "number" && Number.isFinite(uid) && uid >= 0) {
        output[accountId][folder] = uid;
      }
    }
  }
  return output;
}

function mergeReasons(
  target: Record<string, number> | undefined,
  incoming: Record<string, number>,
): void {
  if (!target) return;
  for (const [reason, count] of Object.entries(incoming)) {
    target[reason] = (target[reason] ?? 0) + count;
  }
}

function profileKey(profile?: string): string {
  return profile || "default";
}

function isProfileRunning(profile?: string): boolean {
  return runningProfiles.has(profileKey(profile));
}

function buildEmailCaptureBody(
  message: ParsedEmailMessage,
  attachments: SpsEmailCaptureAttachment[],
): string {
  const metadata = [
    `From: ${message.from}`,
    message.to ? `To: ${message.to}` : "",
    message.cc ? `Cc: ${message.cc}` : "",
    message.date ? `Date: ${message.date.toISOString()}` : "",
    message.messageId ? `Message-ID: ${message.messageId}` : "",
  ].filter(Boolean);
  const body = message.text?.trim() || htmlFallback(message.html) || "";
  const attachmentLines = attachments.map(
    (attachment) =>
      `- [${attachment.originalName}](../_assets/${attachment.assetPath}) (${attachment.mime}, ${attachment.size} bytes)`,
  );

  return [
    metadata.join("\n"),
    "## Message",
    body || "(No plain text body.)",
    attachmentLines.length ? "## Attachments" : "",
    attachmentLines.join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function htmlFallback(html: string | false | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attachmentExt(attachment: ParsedEmailAttachment): string {
  const fromName = extname(attachment.filename ?? "").replace(/^\./, "");
  if (fromName) return fromName;
  const subtype = attachment.contentType.split("/")[1]?.trim();
  return subtype || "bin";
}
