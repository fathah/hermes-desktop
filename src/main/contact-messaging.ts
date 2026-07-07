// contact-messaging.ts — per-channel hand-off from a contact's stored channels.
//
// We do NOT send messages ourselves for OS channels: we build a URL scheme from
// the contact's structured channel data and let macOS open the native app
// (Mail / Messages / WhatsApp) with the recipient pre-filled — the user hits
// send. Because the URL is constructed from validated channel data (not
// user-typed), this bypasses the renderer link allowlist (which guards clicked
// links); shell.openExternal here runs in main on data we built.
//
// Telegram has no by-chat-id deep link, so it is an auto-send channel (gateway)
// rather than an OS hand-off — see the nag engine for that path.
import { shell } from "electron";
import { gatewayChat } from "./gateway-chat";
import { resolveSpsVaultDir } from "./sps-storage";
import { exportRowMarkdownTo, readRowMarkdownFrom } from "./sps-vault";
import { setNagRecord } from "./tasks-dump";
import {
  PERSON_FOLDER,
  SELF_PERSON_ID,
  type ContactChannel,
  type ContactChannelContext,
  type ContactFragment,
} from "../shared/contacts";
import {
  frontmatterJsonLine,
  parseJsonScalarFrontmatter,
  splitSpsFrontmatter,
  wrapFrontmatterLines,
} from "../shared/sps-frontmatter";
import { formatLogError, log } from "./log";

export interface HandoffDraft {
  subject?: string;
  body?: string;
}

function phoneDigits(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

function appendMailtoDraft(url: string, draft?: HandoffDraft): string {
  if (!draft) return url;
  const params = new URLSearchParams();
  const subject = draft.subject?.trim();
  const body = draft.body?.trim();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  const query = params.toString();
  return query ? `${url}?${query}` : url;
}

function rowToMarkdown(props: Record<string, unknown>, body = ""): string {
  const lines = Object.keys(props)
    .filter((key) => props[key] !== undefined && props[key] !== "")
    .map((key) => frontmatterJsonLine(key, props[key]));
  return wrapFrontmatterLines(lines, body, body ? "\n\n" : "\n");
}

function rowFromMarkdown(markdown: string): {
  props: Record<string, unknown>;
  body: string;
} {
  const { frontmatter, body } = splitSpsFrontmatter(markdown);
  if (frontmatter === null) return { props: {}, body: markdown };
  return { props: parseJsonScalarFrontmatter(frontmatter), body };
}

function parseFollowUpMs(value: string | undefined): number | null {
  const raw = value?.trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59` : raw;
  const ms = new Date(normalized).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function outreachText(
  channel: ContactChannel,
  context: ContactChannelContext,
): string {
  const name = context.personName?.trim() || context.personId || "contact";
  const note = context.note?.trim();
  const base = `Opened ${channel.kind} handoff to ${name}.`;
  return note ? `${base} ${note}` : base;
}

async function writeFollowUpTask(
  vaultDir: string,
  channel: ContactChannel,
  context: ContactChannelContext,
  nowIso: string,
  profile?: string,
): Promise<void> {
  const dueMs = parseFollowUpMs(context.followUpAt);
  if (dueMs == null || !context.personId) return;
  const rowId = `contact-follow-up-${context.personId}`;
  const personName = context.personName?.trim() || context.personId;
  const markdown = rowToMarkdown(
    {
      title: `Follow up with ${personName}`,
      status: "todo",
      prio: "med",
      who: SELF_PERSON_ID,
      due: context.followUpAt?.trim(),
      route: "human",
      source: "contact",
      personId: context.personId,
      channel: channel.kind,
    },
    [`Outreach handoff opened via ${channel.kind} on ${nowIso}.`, context.note]
      .filter(Boolean)
      .join("\n\n"),
  );
  const ok = await exportRowMarkdownTo(vaultDir, "tasks", rowId, markdown);
  if (!ok) return;
  await setNagRecord(
    {
      rowId,
      nagCount: 0,
      nextNagAt: dueMs,
      cadence: "daily",
    },
    profile,
  );
}

export async function recordContactOutreach(
  channel: ContactChannel,
  context: ContactChannelContext | undefined,
  profile?: string,
): Promise<boolean> {
  const personId = context?.personId?.trim();
  if (!context || !personId) return false;
  const vaultDir = resolveSpsVaultDir(profile);
  const current = await readRowMarkdownFrom(vaultDir, PERSON_FOLDER, personId);
  if (!current) return false;

  const nowIso = new Date().toISOString();
  const { props, body } = rowFromMarkdown(current);
  const fragments = Array.isArray(props.fragments)
    ? ([...props.fragments] as ContactFragment[])
    : [];
  fragments.push({
    text: outreachText(channel, context),
    when: nowIso,
    source: `outreach:${channel.kind}`,
  });
  const followUpAt = context.followUpAt?.trim();
  const nextProps = {
    ...props,
    fragments,
    ...(followUpAt && parseFollowUpMs(followUpAt) != null
      ? { followUpAt }
      : {}),
  };
  const ok = await exportRowMarkdownTo(
    vaultDir,
    PERSON_FOLDER,
    personId,
    rowToMarkdown(nextProps, body),
  );
  if (!ok) return false;
  await writeFollowUpTask(vaultDir, channel, context, nowIso, profile);
  return true;
}

/** Build the OS URL-scheme for a hand-off, or null if the channel can't hand off. */
export function buildHandoffUrl(
  channel: ContactChannel,
  draft?: HandoffDraft,
): string | null {
  const value = channel.value.trim();
  if (!value) return null;
  switch (channel.kind) {
    case "email":
      return appendMailtoDraft(`mailto:${value}`, draft);
    case "sms":
      return `sms:${phoneDigits(value)}`;
    case "imessage":
      return `imessage:${phoneDigits(value)}`;
    case "whatsapp": {
      const intl = phoneDigits(value).replace(/^\+/, "");
      return intl ? `https://wa.me/${intl}` : null;
    }
    case "telegram":
      // Numeric chat ids have no deep link; Telegram is an auto-send channel.
      return null;
    default:
      return null;
  }
}

/** Open the contact's native app for this channel with the recipient filled. */
export async function openContactChannel(
  channel: ContactChannel,
  draft?: HandoffDraft,
  context?: ContactChannelContext,
  profile?: string,
): Promise<boolean> {
  const url = buildHandoffUrl(channel, draft);
  if (!url) return false;
  try {
    await shell.openExternal(url);
    await recordContactOutreach(channel, context, profile).catch((err) => {
      log.error("contact-messaging", {
        msg: "contact outreach log failed",
        error: formatLogError(err),
      });
    });
    return true;
  } catch (err) {
    log.error("contact-messaging", {
      msg: "openExternal failed",
      url,
      error: formatLogError(err),
    });
    return false;
  }
}

/**
 * Auto-send a Telegram message to a contact via the gateway's messaging tool
 * (the only channel that can send without the user's native app). Best-effort:
 * returns false if Telegram is unconfigured or the send fails. Used by the nag
 * engine for opt-in escalation to an assignee.
 */
export async function sendTelegramViaGateway(
  chatId: string,
  message: string,
  profile?: string,
): Promise<boolean> {
  try {
    const reply = await gatewayChat(
      [
        {
          role: "user",
          content: [
            `Send exactly one Telegram message to chat id ${chatId} using the Hermes messaging tool.`,
            `Message: ${message}`,
            "If Telegram is not configured or the send fails, reply with UNAVAILABLE and the reason.",
          ].join("\n"),
        },
      ],
      256,
      profile,
    );
    return !/unavailable|fail/i.test(reply);
  } catch {
    return false;
  }
}

export async function sendEmailViaGateway(
  to: string,
  subject: string,
  body: string,
  profile?: string,
): Promise<boolean> {
  const recipient = to.trim();
  if (!recipient) return false;
  try {
    const reply = await gatewayChat(
      [
        {
          role: "user",
          content: [
            `Send exactly one email to ${recipient} using the Hermes messaging tool.`,
            `Subject: ${subject}`,
            `Body: ${body}`,
            "If email is not configured or the send fails, reply with UNAVAILABLE and the reason.",
          ].join("\n"),
        },
      ],
      256,
      profile,
    );
    return !/unavailable|fail/i.test(reply);
  } catch {
    return false;
  }
}
