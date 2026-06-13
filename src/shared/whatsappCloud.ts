export const WHATSAPP_CLOUD_DEFAULT_WEBHOOK_PORT = 8090;
export const WHATSAPP_CLOUD_DEFAULT_WEBHOOK_PATH = "/whatsapp/webhook";

export const WHATSAPP_CLOUD_REQUIRED_ENV = [
  "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
  "WHATSAPP_CLOUD_ACCESS_TOKEN",
] as const;

export const WHATSAPP_CLOUD_INBOUND_ENV = [
  "WHATSAPP_CLOUD_APP_SECRET",
  "WHATSAPP_CLOUD_VERIFY_TOKEN",
] as const;

export const WHATSAPP_CLOUD_FIELD_KEYS = [
  ...WHATSAPP_CLOUD_REQUIRED_ENV,
  ...WHATSAPP_CLOUD_INBOUND_ENV,
  "WHATSAPP_CLOUD_ALLOW_FROM",
  "WHATSAPP_CLOUD_DM_POLICY",
  "WHATSAPP_CLOUD_APP_ID",
  "WHATSAPP_CLOUD_WABA_ID",
  "WHATSAPP_CLOUD_WEBHOOK_PORT",
  "WHATSAPP_CLOUD_WEBHOOK_PATH",
  "WHATSAPP_CLOUD_API_VERSION",
  "WHATSAPP_CLOUD_HOME_CHANNEL",
] as const;

export type WhatsAppCloudHealth = {
  phone_number_id?: boolean;
  verify_token_configured?: boolean;
  app_secret_configured?: boolean;
  ffmpeg_present?: boolean;
};

export type WhatsAppCloudStatus = {
  configuredForGateway: boolean;
  readyForInbound: boolean;
  requiredMissing: string[];
  inboundMissing: string[];
  healthReachable: boolean;
  health?: WhatsAppCloudHealth;
  webhookPort: number;
  webhookPath: string;
  error?: string;
};

export function getWhatsAppCloudMissingEnv(
  env: Record<string, string>,
  keys: readonly string[],
): string[] {
  return keys.filter((key) => !env[key]?.trim());
}

export function parseWhatsAppCloudWebhookPort(value?: string): number {
  const raw = value?.trim();
  if (!raw) return WHATSAPP_CLOUD_DEFAULT_WEBHOOK_PORT;
  if (!/^\d+$/.test(raw)) return WHATSAPP_CLOUD_DEFAULT_WEBHOOK_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (parsed < 1 || parsed > 65535) return WHATSAPP_CLOUD_DEFAULT_WEBHOOK_PORT;
  return parsed;
}

export function normalizeWhatsAppCloudWebhookPath(value?: string): string {
  const raw = value?.trim();
  if (!raw) return WHATSAPP_CLOUD_DEFAULT_WEBHOOK_PATH;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

export function buildWhatsAppCloudStatus(
  env: Record<string, string>,
  healthReachable: boolean,
  health?: WhatsAppCloudHealth,
  error?: string,
): WhatsAppCloudStatus {
  const requiredMissing = getWhatsAppCloudMissingEnv(
    env,
    WHATSAPP_CLOUD_REQUIRED_ENV,
  );
  const inboundMissing = getWhatsAppCloudMissingEnv(
    env,
    WHATSAPP_CLOUD_INBOUND_ENV,
  );
  const configuredForGateway = requiredMissing.length === 0;
  const inboundHealthReady =
    healthReachable &&
    health?.verify_token_configured === true &&
    health?.app_secret_configured === true;

  return {
    configuredForGateway,
    readyForInbound:
      configuredForGateway && inboundMissing.length === 0 && inboundHealthReady,
    requiredMissing,
    inboundMissing,
    healthReachable,
    health,
    webhookPort: parseWhatsAppCloudWebhookPort(
      env.WHATSAPP_CLOUD_WEBHOOK_PORT,
    ),
    webhookPath: normalizeWhatsAppCloudWebhookPath(
      env.WHATSAPP_CLOUD_WEBHOOK_PATH,
    ),
    error,
  };
}
