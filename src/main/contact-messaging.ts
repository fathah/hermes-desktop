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
import type { ContactChannel } from "../shared/contacts";

function phoneDigits(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

/** Build the OS URL-scheme for a hand-off, or null if the channel can't hand off. */
export function buildHandoffUrl(channel: ContactChannel): string | null {
  const value = channel.value.trim();
  if (!value) return null;
  switch (channel.kind) {
    case "email":
      return `mailto:${value}`;
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
): Promise<boolean> {
  const url = buildHandoffUrl(channel);
  if (!url) return false;
  try {
    await shell.openExternal(url);
    return true;
  } catch (err) {
    console.error("[contact-messaging] openExternal failed:", err);
    return false;
  }
}
