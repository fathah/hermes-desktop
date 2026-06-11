// telegram-status.ts — a single, honest "is the Telegram bot actually usable?"
// state. The desktop only writes config and spawns the (detached) Python
// gateway that runs the bot, so "connected" is not directly observable. We
// derive it from three signals: is a token configured, does a Telegram getMe
// probe accept that token, and is the gateway process running. This module is
// the PURE mapping (no I/O) so it is unit-testable; the IPC handler performs the
// env read, gateway-running check, and network probe and feeds them in.

/** Outcome of a Telegram Bot API `getMe` probe, or null when none was made. */
export type GetMeResult =
  | { ok: true; username: string }
  | { ok: false; kind: "invalid-token" | "unreachable"; message: string };

/** A user-facing Telegram connection state. Each variant maps to a distinct
 *  situation with a distinct fix, so the UI can say something actionable. */
export type TelegramStatus =
  | { state: "not-configured" }
  | { state: "invalid-token"; message: string }
  | { state: "unreachable"; message: string }
  | { state: "gateway-stopped"; botUsername: string }
  | { state: "active"; botUsername: string };

export interface TelegramStatusInput {
  /** A non-empty TELEGRAM_BOT_TOKEN is present in the profile env store. */
  tokenPresent: boolean;
  /** The (detached) gateway process for this profile is running. */
  gatewayRunning: boolean;
  /** Result of the getMe probe, or null if it was not attempted. */
  getMe: GetMeResult | null;
}

export function deriveTelegramStatus(
  input: TelegramStatusInput,
): TelegramStatus {
  if (!input.tokenPresent) {
    return { state: "not-configured" };
  }

  const probe = input.getMe;

  // A token exists but we never confirmed it — never claim "active" on faith.
  if (!probe) {
    return {
      state: "unreachable",
      message: "Bot status could not be verified.",
    };
  }

  if (!probe.ok) {
    if (probe.kind === "invalid-token") {
      return { state: "invalid-token", message: probe.message };
    }
    return { state: "unreachable", message: probe.message };
  }

  // The token is valid (Telegram returned the bot identity). Whether the bot
  // actually acts on messages depends on the detached gateway being up.
  if (!input.gatewayRunning) {
    return { state: "gateway-stopped", botUsername: probe.username };
  }

  return { state: "active", botUsername: probe.username };
}
