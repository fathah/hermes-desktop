import { useCallback, useEffect, useMemo, useState } from "react";
import {
  WHATSAPP_CLOUD_FIELD_KEYS,
  normalizeWhatsAppCloudWebhookPath,
  parseWhatsAppCloudWebhookPort,
  type WhatsAppCloudStatus,
} from "../../../../../shared/whatsappCloud";

const HERMES_WHATSAPP_CLOUD_DOCS =
  "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/whatsapp-cloud";

type ShapeCheck = {
  key: string;
  ok: boolean;
  message: string;
};

type WhatsAppCloudSetupProps = {
  profile?: string;
  env: Record<string, string>;
  savedKey: string | null;
  gatewayRunning: boolean;
};

function shapeChecks(env: Record<string, string>): ShapeCheck[] {
  const checks: ShapeCheck[] = [];
  const phoneNumberId = env.WHATSAPP_CLOUD_PHONE_NUMBER_ID?.trim() || "";
  const accessToken = env.WHATSAPP_CLOUD_ACCESS_TOKEN?.trim() || "";
  const appSecret = env.WHATSAPP_CLOUD_APP_SECRET?.trim() || "";
  const verifyToken = env.WHATSAPP_CLOUD_VERIFY_TOKEN?.trim() || "";
  const allowFrom = env.WHATSAPP_CLOUD_ALLOW_FROM?.trim() || "";
  const dmPolicy = env.WHATSAPP_CLOUD_DM_POLICY?.trim().toLowerCase() || "";

  if (phoneNumberId) {
    checks.push({
      key: "phone-number-id",
      ok: /^\d{15,17}$/.test(phoneNumberId),
      message:
        "Phone Number ID should be 15-17 digits from Meta, not the phone number.",
    });
  }
  if (accessToken) {
    checks.push({
      key: "access-token",
      ok: accessToken.startsWith("EAA") && accessToken.length >= 80,
      message:
        "Access token usually starts with EAA and is much longer than a password.",
    });
  }
  if (appSecret) {
    checks.push({
      key: "app-secret",
      ok: /^[a-f0-9]{32}$/.test(appSecret),
      message: "App Secret should be 32 lowercase hex characters.",
    });
  }
  if (verifyToken) {
    checks.push({
      key: "verify-token",
      ok: verifyToken.length >= 24 && !/\s/.test(verifyToken),
      message: "Verify Token should be a long single token with no spaces.",
    });
  }
  if (allowFrom) {
    checks.push({
      key: "allow-from",
      ok: allowFrom
        .split(",")
        .every((value) => /^\d{8,20}$/.test(value.trim())),
      message:
        "Allowed Senders should be comma-separated wa_ids with digits only.",
    });
  }
  if (dmPolicy) {
    checks.push({
      key: "dm-policy",
      ok: dmPolicy === "open" || dmPolicy === "allowlist",
      message: "DM Policy should be open or allowlist.",
    });
  }

  return checks;
}

function statusText(status: WhatsAppCloudStatus | null): string {
  if (!status) return "Not checked";
  if (status.readyForInbound) return "Ready for inbound messages";
  if (status.configuredForGateway) return "Gateway credentials saved";
  return "Missing required gateway credentials";
}

function statusClass(status: WhatsAppCloudStatus | null): string {
  if (!status) return "stopped";
  return status.readyForInbound || status.configuredForGateway
    ? "running"
    : "stopped";
}

function normalizedTunnelBase(value: string): string {
  const trimmed = value.trim();
  if (!/^https:\/\//i.test(trimmed)) return "";
  return trimmed.replace(/\/+$/, "");
}

function WhatsAppCloudSetup({
  profile,
  env,
  savedKey,
  gatewayRunning,
}: WhatsAppCloudSetupProps): React.JSX.Element {
  const [status, setStatus] = useState<WhatsAppCloudStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [publicTunnelUrl, setPublicTunnelUrl] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const webhookPort = status?.webhookPort
    ? status.webhookPort
    : parseWhatsAppCloudWebhookPort(env.WHATSAPP_CLOUD_WEBHOOK_PORT);
  const webhookPath = status?.webhookPath
    ? status.webhookPath
    : normalizeWhatsAppCloudWebhookPath(env.WHATSAPP_CLOUD_WEBHOOK_PATH);
  const tunnelBase = normalizedTunnelBase(publicTunnelUrl);
  const callbackUrl = tunnelBase ? `${tunnelBase}${webhookPath}` : "";
  const checks = useMemo(() => shapeChecks(env), [env]);
  const failedChecks = checks.filter((check) => !check.ok);

  const refreshStatus = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setStatus(await window.hermesAPI.getWhatsAppCloudStatus(profile));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus, gatewayRunning]);

  useEffect(() => {
    if (
      savedKey &&
      WHATSAPP_CLOUD_FIELD_KEYS.includes(
        savedKey as (typeof WHATSAPP_CLOUD_FIELD_KEYS)[number],
      )
    ) {
      void refreshStatus();
    }
  }, [refreshStatus, savedKey]);

  async function copyText(id: string, text: string): Promise<void> {
    await window.hermesAPI.copyToClipboard(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1600);
  }

  const cloudflaredCommand = `cloudflared tunnel --url http://localhost:${webhookPort}`;
  const ngrokCommand = `ngrok http ${webhookPort}`;

  return (
    <div className="whatsapp-cloud-setup">
      <div className="whatsapp-cloud-header">
        <div>
          <div className="whatsapp-cloud-title">WhatsApp Cloud setup</div>
          <div className="settings-field-hint">
            Official Meta Business API. The local gateway listens on port{" "}
            {webhookPort}; your tunnel provides the public HTTPS URL.
          </div>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={refreshStatus}
          disabled={loading}
        >
          {loading ? "Checking..." : "Check status"}
        </button>
      </div>

      <div className="whatsapp-cloud-status-row">
        <span className={`settings-gateway-status ${statusClass(status)}`}>
          {statusText(status)}
        </span>
        <span className="settings-field-hint">
          Health: {status?.healthReachable ? "reachable" : "unavailable"}
        </span>
      </div>
      {status?.error && (
        <div className="whatsapp-cloud-warning">{status.error}</div>
      )}

      {status &&
        (status.requiredMissing.length > 0 ||
          status.inboundMissing.length > 0) && (
          <div className="whatsapp-cloud-grid">
            <div>
              <div className="whatsapp-cloud-mini-title">Gateway required</div>
              <div className="settings-field-hint">
                {status.requiredMissing.length
                  ? status.requiredMissing.join(", ")
                  : "Phone Number ID and Access Token are saved."}
              </div>
            </div>
            <div>
              <div className="whatsapp-cloud-mini-title">Inbound required</div>
              <div className="settings-field-hint">
                {status.inboundMissing.length
                  ? status.inboundMissing.join(", ")
                  : "App Secret and Verify Token are saved."}
              </div>
            </div>
          </div>
        )}

      {failedChecks.length > 0 && (
        <div className="whatsapp-cloud-warning-list">
          {failedChecks.map((check) => (
            <div key={check.key}>{check.message}</div>
          ))}
        </div>
      )}

      <div className="whatsapp-cloud-command-grid">
        <div className="whatsapp-cloud-command-card">
          <div className="whatsapp-cloud-mini-title">
            Cloudflare quick tunnel
          </div>
          <code>{cloudflaredCommand}</code>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => copyText("cloudflared", cloudflaredCommand)}
          >
            {copied === "cloudflared" ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="whatsapp-cloud-command-card">
          <div className="whatsapp-cloud-mini-title">ngrok tunnel</div>
          <code>{ngrokCommand}</code>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => copyText("ngrok", ngrokCommand)}
          >
            {copied === "ngrok" ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-field-label">Public tunnel URL</label>
        <div className="settings-input-row">
          <input
            className="input"
            type="text"
            value={publicTunnelUrl}
            onChange={(event) => setPublicTunnelUrl(event.target.value)}
            placeholder="https://example.trycloudflare.com"
          />
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            disabled={!callbackUrl}
            onClick={() => copyText("callback", callbackUrl)}
          >
            {copied === "callback" ? "Copied" : "Copy callback"}
          </button>
        </div>
        <div className="settings-field-hint">
          Callback URL: {callbackUrl || `https://...${webhookPath}`}
        </div>
      </div>

      <div className="whatsapp-cloud-checklist">
        <div>Meta webhook callback URL ends with {webhookPath}</div>
        <div>Verify Token in Meta matches WHATSAPP_CLOUD_VERIFY_TOKEN</div>
        <div>Webhook fields include the messages subscription</div>
        <div>Direct-message support only in this Hermes adapter version</div>
        <div>Messages outside Meta's 24-hour window require templates</div>
      </div>

      <div className="whatsapp-cloud-actions">
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={() => copyText("wizard", "hermes whatsapp-cloud")}
        >
          {copied === "wizard" ? "Copied" : "Copy Hermes wizard command"}
        </button>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={() =>
            window.hermesAPI.openExternal(HERMES_WHATSAPP_CLOUD_DOCS)
          }
        >
          Open guide
        </button>
      </div>
    </div>
  );
}

export default WhatsAppCloudSetup;
