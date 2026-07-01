import { readEnv } from "./config";
import { providerFetch } from "./security/network-policy";
import {
  buildWhatsAppCloudStatus,
  parseWhatsAppCloudWebhookPort,
  type WhatsAppCloudHealth,
  type WhatsAppCloudStatus,
} from "../shared/whatsappCloud";

function boolFromHealth(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function sanitizeHealthPayload(payload: unknown): WhatsAppCloudHealth {
  const raw =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  return {
    phone_number_id: boolFromHealth(raw.phone_number_id),
    verify_token_configured: boolFromHealth(raw.verify_token_configured),
    app_secret_configured: boolFromHealth(raw.app_secret_configured),
    ffmpeg_present: boolFromHealth(raw.ffmpeg_present),
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.name === "AbortError") {
    return "WhatsApp Cloud webhook health timed out.";
  }
  if (err instanceof Error && err.message) return err.message;
  return "WhatsApp Cloud webhook health unavailable.";
}

export async function getWhatsAppCloudStatus(
  profile?: string,
): Promise<WhatsAppCloudStatus> {
  const env = readEnv(profile);
  const port = parseWhatsAppCloudWebhookPort(env.WHATSAPP_CLOUD_WEBHOOK_PORT);
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 1500);

  try {
    const res = await providerFetch(`http://127.0.0.1:${port}/health`, {
      headers: { accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return buildWhatsAppCloudStatus(
        env,
        false,
        undefined,
        `WhatsApp Cloud webhook health returned HTTP ${res.status}.`,
      );
    }

    const health = sanitizeHealthPayload(await res.json());
    return buildWhatsAppCloudStatus(env, true, health);
  } catch (err) {
    return buildWhatsAppCloudStatus(env, false, undefined, errorMessage(err));
  } finally {
    clearTimeout(timeout);
  }
}
