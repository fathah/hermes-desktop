export interface MessagingEnvVarInfo {
  advanced: boolean;
  description: string;
  is_password: boolean;
  is_set: boolean;
  key: string;
  prompt: string;
  redacted_value: string | null;
  required: boolean;
  url: string | null;
}

export interface MessagingHomeChannel {
  chat_id: string;
  name: string;
  platform: string;
  thread_id?: string;
}

export interface MessagingPlatformInfo {
  configured: boolean;
  description: string;
  docs_url: string;
  enabled: boolean;
  env_vars: MessagingEnvVarInfo[];
  error_code?: string | null;
  error_message?: string | null;
  gateway_running: boolean;
  home_channel?: MessagingHomeChannel | null;
  id: string;
  name: string;
  state?: string | null;
  toolsets: MessagingToolsetInfo[];
  updated_at?: string | null;
}

export interface MessagingPlatformsResponse {
  editable: boolean;
  message?: string;
  platforms: MessagingPlatformInfo[];
  source: "desktop" | "remote-api";
}

export interface MessagingPlatformRuntimeState {
  error_code?: string | null;
  error_message?: string | null;
  state?: string | null;
  updated_at?: string | null;
}

export interface MessagingPlatformUpdate {
  clear_env?: string[];
  enabled?: boolean;
  env?: Record<string, string>;
  toolsets?: Record<string, boolean>;
}

export interface MessagingPlatformTestResponse {
  message: string;
  ok: boolean;
  state?: string | null;
}

export type MessagingToolsetRisk = "normal" | "high";

export interface MessagingToolsetInfo {
  description: string;
  enabled: boolean;
  key: string;
  label: string;
  risk: MessagingToolsetRisk;
}

interface MessagingEnvDefinition {
  advanced?: boolean;
  description: string;
  is_password?: boolean;
  key: string;
  prompt: string;
  url?: string;
}

interface MessagingPlatformDefinition {
  description: string;
  docs_url: string;
  env_vars: string[];
  id: string;
  name: string;
  required_env: string[];
}

interface MessagingToolsetDefinition {
  description: string;
  key: string;
  label: string;
  risk?: MessagingToolsetRisk;
}

export const DEFAULT_MESSAGING_PLATFORM_TOOLSETS = [
  "clarify",
  "cronjob",
  "kanban",
  "memory",
  "messaging",
  "session_search",
  "skills",
  "todo",
  "tts",
  "vision",
  "web",
];

export const MESSAGING_TOOLSET_DEFINITIONS: MessagingToolsetDefinition[] = [
  {
    key: "web",
    label: "Web search",
    description:
      "Use the configured Hermes web/search backend. This still requires a working web backend in config.",
  },
  {
    key: "browser",
    label: "Browser",
    description:
      "Use a local browser session for live web pages without a separate search provider.",
  },
  {
    key: "terminal",
    label: "Terminal",
    description:
      "Run shell commands on this machine from the messaging platform.",
    risk: "high",
  },
  {
    key: "file",
    label: "Files",
    description:
      "Read and write files reachable by Hermes from the messaging platform.",
    risk: "high",
  },
  {
    key: "code_execution",
    label: "Code execution",
    description: "Run local code execution tools from the messaging platform.",
    risk: "high",
  },
  {
    key: "vision",
    label: "Vision",
    description: "Analyze images sent through the messaging platform.",
  },
  {
    key: "image_gen",
    label: "Image generation",
    description: "Generate images from the messaging platform.",
  },
  {
    key: "tts",
    label: "Text to speech",
    description: "Create speech/audio responses from messages.",
  },
  {
    key: "skills",
    label: "Skills",
    description: "List, inspect, and manage Hermes skills.",
  },
  {
    key: "memory",
    label: "Memory",
    description: "Read and update Hermes memory.",
  },
  {
    key: "session_search",
    label: "Session search",
    description: "Search previous Hermes sessions.",
  },
  {
    key: "clarify",
    label: "Clarify",
    description: "Ask clarification questions before acting.",
  },
  {
    key: "cronjob",
    label: "Schedules",
    description: "Create and manage scheduled jobs.",
  },
  {
    key: "todo",
    label: "Todos",
    description: "Manage task lists and temporary todos.",
  },
  {
    key: "messaging",
    label: "Messaging",
    description: "Send messages through configured messaging platforms.",
  },
  {
    key: "kanban",
    label: "Kanban",
    description: "Read and manage Hermes kanban tasks.",
  },
  {
    key: "delegation",
    label: "Delegation",
    description: "Delegate work to other agents.",
  },
  {
    key: "moa",
    label: "Mixture of agents",
    description: "Use multiple agents for comparison or consensus.",
  },
];

const HERMES_MESSAGING_DOCS =
  "https://hermes-agent.nousresearch.com/docs/user-guide/messaging";

function messagingDocs(slug: string): string {
  return `${HERMES_MESSAGING_DOCS}/${slug}/`;
}

const ENV_DEFINITIONS: Record<string, MessagingEnvDefinition> = {
  TELEGRAM_BOT_TOKEN: {
    key: "TELEGRAM_BOT_TOKEN",
    prompt: "Bot token",
    description: "Telegram bot token from BotFather",
    is_password: true,
    url: "https://core.telegram.org/bots/features#botfather",
  },
  TELEGRAM_ALLOWED_USERS: {
    key: "TELEGRAM_ALLOWED_USERS",
    prompt: "Allowed Telegram users",
    description: "Comma-separated Telegram user IDs allowed to use the bot",
  },
  TELEGRAM_PROXY: {
    key: "TELEGRAM_PROXY",
    prompt: "Telegram proxy",
    description: "Optional proxy URL used by the Telegram adapter",
    advanced: true,
  },
  DISCORD_BOT_TOKEN: {
    key: "DISCORD_BOT_TOKEN",
    prompt: "Bot token",
    description: "Discord bot token from the Developer Portal",
    is_password: true,
    url: "https://discord.com/developers/applications",
  },
  DISCORD_ALLOWED_USERS: {
    key: "DISCORD_ALLOWED_USERS",
    prompt: "Allowed Discord users",
    description: "Comma-separated Discord user IDs allowed to use the bot",
  },
  DISCORD_ALLOWED_CHANNELS: {
    key: "DISCORD_ALLOWED_CHANNELS",
    prompt: "Allowed Discord channels",
    description: "Legacy allow-list for Discord channels",
    advanced: true,
  },
  DISCORD_REPLY_TO_MODE: {
    key: "DISCORD_REPLY_TO_MODE",
    prompt: "Reply mode",
    description: "Discord reply behavior used by the gateway",
    advanced: true,
  },
  SLACK_BOT_TOKEN: {
    key: "SLACK_BOT_TOKEN",
    prompt: "Bot token",
    description: "Slack bot token (xoxb-...)",
    is_password: true,
    url: "https://api.slack.com/apps",
  },
  SLACK_APP_TOKEN: {
    key: "SLACK_APP_TOKEN",
    prompt: "App token",
    description: "Slack Socket Mode app token (xapp-...)",
    is_password: true,
  },
  MATTERMOST_URL: {
    key: "MATTERMOST_URL",
    prompt: "Mattermost URL",
    description: "Mattermost server base URL",
  },
  MATTERMOST_TOKEN: {
    key: "MATTERMOST_TOKEN",
    prompt: "Mattermost token",
    description: "Mattermost personal access token",
    is_password: true,
  },
  MATTERMOST_ALLOWED_USERS: {
    key: "MATTERMOST_ALLOWED_USERS",
    prompt: "Allowed Mattermost users",
    description: "Comma-separated Mattermost users allowed to use the bot",
  },
  MATRIX_HOMESERVER: {
    key: "MATRIX_HOMESERVER",
    prompt: "Homeserver",
    description: "Matrix homeserver URL",
  },
  MATRIX_ACCESS_TOKEN: {
    key: "MATRIX_ACCESS_TOKEN",
    prompt: "Access token",
    description: "Matrix account access token",
    is_password: true,
  },
  MATRIX_USER_ID: {
    key: "MATRIX_USER_ID",
    prompt: "User ID",
    description: "Matrix user ID, e.g. @hermes:example.org",
  },
  MATRIX_ALLOWED_USERS: {
    key: "MATRIX_ALLOWED_USERS",
    prompt: "Allowed Matrix users",
    description: "Comma-separated Matrix users allowed to use the bot",
  },
  SIGNAL_HTTP_URL: {
    key: "SIGNAL_HTTP_URL",
    prompt: "Signal bridge URL",
    description: "signal-cli REST API base URL, e.g. http://127.0.0.1:8080",
    url: "https://github.com/bbernhard/signal-cli-rest-api",
  },
  SIGNAL_ACCOUNT: {
    key: "SIGNAL_ACCOUNT",
    prompt: "Signal account",
    description: "Signal account phone number registered with the bridge",
  },
  SIGNAL_ALLOWED_USERS: {
    key: "SIGNAL_ALLOWED_USERS",
    prompt: "Allowed Signal users",
    description: "Comma-separated Signal users allowed to use the bot",
  },
  SIGNAL_PHONE_NUMBER: {
    key: "SIGNAL_PHONE_NUMBER",
    prompt: "Signal phone number",
    description: "Legacy Desktop Signal phone number setting",
    advanced: true,
  },
  WHATSAPP_ENABLED: {
    key: "WHATSAPP_ENABLED",
    prompt: "Enable WhatsApp",
    description: "Enable the WhatsApp gateway adapter",
    advanced: true,
  },
  WHATSAPP_MODE: {
    key: "WHATSAPP_MODE",
    prompt: "WhatsApp mode",
    description: "WhatsApp bridge mode",
    advanced: true,
  },
  WHATSAPP_ALLOWED_USERS: {
    key: "WHATSAPP_ALLOWED_USERS",
    prompt: "Allowed WhatsApp users",
    description: "Comma-separated WhatsApp users allowed to use the bot",
  },
  WHATSAPP_API_URL: {
    key: "WHATSAPP_API_URL",
    prompt: "WhatsApp API URL",
    description: "Legacy Desktop WhatsApp bridge URL",
    advanced: true,
  },
  WHATSAPP_API_TOKEN: {
    key: "WHATSAPP_API_TOKEN",
    prompt: "WhatsApp API token",
    description: "Legacy Desktop WhatsApp bridge token",
    is_password: true,
    advanced: true,
  },
  BLUEBUBBLES_SERVER_URL: {
    key: "BLUEBUBBLES_SERVER_URL",
    prompt: "Server URL",
    description: "BlueBubbles server URL",
    url: "https://bluebubbles.app/",
  },
  BLUEBUBBLES_PASSWORD: {
    key: "BLUEBUBBLES_PASSWORD",
    prompt: "Password",
    description: "BlueBubbles server password",
    is_password: true,
  },
  BLUEBUBBLES_ALLOWED_USERS: {
    key: "BLUEBUBBLES_ALLOWED_USERS",
    prompt: "Allowed iMessage users",
    description: "Comma-separated iMessage senders allowed to use the bot",
  },
  BLUEBUBBLES_URL: {
    key: "BLUEBUBBLES_URL",
    prompt: "BlueBubbles URL",
    description: "Legacy Desktop BlueBubbles server URL",
    advanced: true,
  },
  HASS_URL: {
    key: "HASS_URL",
    prompt: "Home Assistant URL",
    description:
      "Home Assistant base URL, e.g. https://homeassistant.local:8123",
    url: "https://www.home-assistant.io/docs/authentication/",
  },
  HASS_TOKEN: {
    key: "HASS_TOKEN",
    prompt: "Home Assistant access token",
    description: "Long-lived access token from Home Assistant",
    is_password: true,
  },
  EMAIL_ADDRESS: {
    key: "EMAIL_ADDRESS",
    prompt: "Email address",
    description: "Email address to send and receive from",
  },
  EMAIL_PASSWORD: {
    key: "EMAIL_PASSWORD",
    prompt: "Email password",
    description: "Email account password or app password",
    is_password: true,
  },
  EMAIL_IMAP_HOST: {
    key: "EMAIL_IMAP_HOST",
    prompt: "IMAP host",
    description: "IMAP server host, e.g. imap.gmail.com",
  },
  EMAIL_SMTP_HOST: {
    key: "EMAIL_SMTP_HOST",
    prompt: "SMTP host",
    description: "SMTP server host, e.g. smtp.gmail.com",
  },
  EMAIL_IMAP_SERVER: {
    key: "EMAIL_IMAP_SERVER",
    prompt: "IMAP server",
    description: "Legacy Desktop IMAP server setting",
    advanced: true,
  },
  EMAIL_SMTP_SERVER: {
    key: "EMAIL_SMTP_SERVER",
    prompt: "SMTP server",
    description: "Legacy Desktop SMTP server setting",
    advanced: true,
  },
  TWILIO_ACCOUNT_SID: {
    key: "TWILIO_ACCOUNT_SID",
    prompt: "Twilio Account SID",
    description: "Twilio Account SID",
    url: "https://www.twilio.com/console",
  },
  TWILIO_AUTH_TOKEN: {
    key: "TWILIO_AUTH_TOKEN",
    prompt: "Twilio Auth Token",
    description: "Twilio Auth Token",
    is_password: true,
  },
  TWILIO_PHONE_NUMBER: {
    key: "TWILIO_PHONE_NUMBER",
    prompt: "Twilio phone number",
    description: "Legacy Desktop Twilio sender number",
    advanced: true,
  },
  SMS_PROVIDER: {
    key: "SMS_PROVIDER",
    prompt: "SMS provider",
    description: "Legacy Desktop SMS provider setting",
    advanced: true,
  },
  DINGTALK_CLIENT_ID: {
    key: "DINGTALK_CLIENT_ID",
    prompt: "Client ID",
    description: "DingTalk client ID (App key)",
  },
  DINGTALK_CLIENT_SECRET: {
    key: "DINGTALK_CLIENT_SECRET",
    prompt: "Client secret",
    description: "DingTalk client secret (App secret)",
    is_password: true,
  },
  DINGTALK_APP_KEY: {
    key: "DINGTALK_APP_KEY",
    prompt: "App key",
    description: "Legacy Desktop DingTalk app key",
    advanced: true,
  },
  DINGTALK_APP_SECRET: {
    key: "DINGTALK_APP_SECRET",
    prompt: "App secret",
    description: "Legacy Desktop DingTalk app secret",
    is_password: true,
    advanced: true,
  },
  FEISHU_APP_ID: {
    key: "FEISHU_APP_ID",
    prompt: "App ID",
    description: "Feishu / Lark app ID",
  },
  FEISHU_APP_SECRET: {
    key: "FEISHU_APP_SECRET",
    prompt: "App secret",
    description: "Feishu / Lark app secret",
    is_password: true,
  },
  FEISHU_ENCRYPT_KEY: {
    key: "FEISHU_ENCRYPT_KEY",
    prompt: "Encrypt key",
    description: "Feishu / Lark encrypt key",
    is_password: true,
  },
  FEISHU_VERIFICATION_TOKEN: {
    key: "FEISHU_VERIFICATION_TOKEN",
    prompt: "Verification token",
    description: "Feishu / Lark verification token",
    is_password: true,
  },
  WECOM_BOT_ID: {
    key: "WECOM_BOT_ID",
    prompt: "WeCom Bot ID",
    description: "WeCom group bot ID",
  },
  WECOM_SECRET: {
    key: "WECOM_SECRET",
    prompt: "WeCom Secret",
    description: "WeCom group bot secret",
    is_password: true,
  },
  WECOM_CALLBACK_CORP_ID: {
    key: "WECOM_CALLBACK_CORP_ID",
    prompt: "WeCom Corp ID",
    description: "WeCom corp ID",
  },
  WECOM_CALLBACK_CORP_SECRET: {
    key: "WECOM_CALLBACK_CORP_SECRET",
    prompt: "WeCom Corp Secret",
    description: "WeCom app corp secret",
    is_password: true,
  },
  WECOM_CALLBACK_AGENT_ID: {
    key: "WECOM_CALLBACK_AGENT_ID",
    prompt: "WeCom Agent ID",
    description: "WeCom app agent ID",
  },
  WECOM_CALLBACK_TOKEN: {
    key: "WECOM_CALLBACK_TOKEN",
    prompt: "WeCom Token",
    description: "WeCom callback verification token",
  },
  WECOM_CALLBACK_ENCODING_AES_KEY: {
    key: "WECOM_CALLBACK_ENCODING_AES_KEY",
    prompt: "WeCom AES Key",
    description: "WeCom callback AES encoding key",
    is_password: true,
  },
  WECOM_CORP_ID: {
    key: "WECOM_CORP_ID",
    prompt: "WeCom Corp ID",
    description: "Legacy Desktop WeCom corp ID",
    advanced: true,
  },
  WECOM_AGENT_ID: {
    key: "WECOM_AGENT_ID",
    prompt: "WeCom Agent ID",
    description: "Legacy Desktop WeCom agent ID",
    advanced: true,
  },
  WEIXIN_ACCOUNT_ID: {
    key: "WEIXIN_ACCOUNT_ID",
    prompt: "Account ID",
    description: "WeChat Official Account ID",
  },
  WEIXIN_TOKEN: {
    key: "WEIXIN_TOKEN",
    prompt: "Token",
    description: "WeChat callback token",
    is_password: true,
  },
  WEIXIN_BASE_URL: {
    key: "WEIXIN_BASE_URL",
    prompt: "Base URL",
    description: "WeChat platform base URL",
  },
  WEIXIN_BOT_TOKEN: {
    key: "WEIXIN_BOT_TOKEN",
    prompt: "Bot token",
    description: "Legacy Desktop WeChat bot token",
    is_password: true,
    advanced: true,
  },
  QQ_APP_ID: {
    key: "QQ_APP_ID",
    prompt: "QQ App ID",
    description: "QQ bot app ID",
  },
  QQ_CLIENT_SECRET: {
    key: "QQ_CLIENT_SECRET",
    prompt: "QQ client secret",
    description: "QQ bot client secret",
    is_password: true,
  },
  QQ_ALLOWED_USERS: {
    key: "QQ_ALLOWED_USERS",
    prompt: "Allowed QQ users",
    description: "Comma-separated QQ users allowed to use the bot",
  },
  WEBHOOK_ENABLED: {
    key: "WEBHOOK_ENABLED",
    prompt: "Enable webhooks",
    description: "Enable webhook ingestion",
    advanced: true,
  },
  WEBHOOK_PORT: {
    key: "WEBHOOK_PORT",
    prompt: "Webhook port",
    description: "HTTP port for webhook delivery",
    advanced: true,
  },
  WEBHOOK_SECRET: {
    key: "WEBHOOK_SECRET",
    prompt: "Webhook secret",
    description: "Shared secret used to verify webhook senders",
    is_password: true,
  },
  API_SERVER_ENABLED: {
    key: "API_SERVER_ENABLED",
    prompt: "Enable API server",
    description: "Expose Hermes through its OpenAI-compatible HTTP API",
    advanced: true,
  },
  API_SERVER_KEY: {
    key: "API_SERVER_KEY",
    prompt: "API server key",
    description: "Bearer token required by the local API server",
    is_password: true,
  },
  API_SERVER_PORT: {
    key: "API_SERVER_PORT",
    prompt: "API server port",
    description: "Port used by the API server",
    advanced: true,
  },
  API_SERVER_HOST: {
    key: "API_SERVER_HOST",
    prompt: "API server host",
    description: "Host interface for the API server",
    advanced: true,
  },
  API_SERVER_MODEL_NAME: {
    key: "API_SERVER_MODEL_NAME",
    prompt: "API model name",
    description: "Model name exposed by the API server",
    advanced: true,
  },
};

export const MESSAGING_PLATFORM_CATALOG: MessagingPlatformDefinition[] = [
  {
    id: "telegram",
    name: "Telegram",
    description: "Run Hermes from Telegram DMs, groups, and topics.",
    docs_url: messagingDocs("telegram"),
    env_vars: [
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_ALLOWED_USERS",
      "TELEGRAM_PROXY",
    ],
    required_env: ["TELEGRAM_BOT_TOKEN"],
  },
  {
    id: "discord",
    name: "Discord",
    description: "Connect Hermes to Discord DMs, channels, and threads.",
    docs_url: messagingDocs("discord"),
    env_vars: [
      "DISCORD_BOT_TOKEN",
      "DISCORD_ALLOWED_USERS",
      "DISCORD_ALLOWED_CHANNELS",
      "DISCORD_REPLY_TO_MODE",
    ],
    required_env: ["DISCORD_BOT_TOKEN"],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Use Hermes from Slack via Socket Mode.",
    docs_url: messagingDocs("slack"),
    env_vars: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"],
    required_env: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"],
  },
  {
    id: "mattermost",
    name: "Mattermost",
    description: "Connect Hermes to Mattermost channels and direct messages.",
    docs_url: messagingDocs("mattermost"),
    env_vars: [
      "MATTERMOST_URL",
      "MATTERMOST_TOKEN",
      "MATTERMOST_ALLOWED_USERS",
    ],
    required_env: ["MATTERMOST_URL", "MATTERMOST_TOKEN"],
  },
  {
    id: "matrix",
    name: "Matrix",
    description: "Use Hermes in Matrix rooms and direct messages.",
    docs_url: messagingDocs("matrix"),
    env_vars: [
      "MATRIX_HOMESERVER",
      "MATRIX_ACCESS_TOKEN",
      "MATRIX_USER_ID",
      "MATRIX_ALLOWED_USERS",
    ],
    required_env: [
      "MATRIX_HOMESERVER",
      "MATRIX_ACCESS_TOKEN",
      "MATRIX_USER_ID",
    ],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description:
      "Use Hermes through the bundled WhatsApp bridge with QR-based auth.",
    docs_url: messagingDocs("whatsapp"),
    env_vars: [
      "WHATSAPP_ENABLED",
      "WHATSAPP_MODE",
      "WHATSAPP_ALLOWED_USERS",
      "WHATSAPP_API_URL",
      "WHATSAPP_API_TOKEN",
    ],
    required_env: [],
  },
  {
    id: "signal",
    name: "Signal",
    description: "Connect through a signal-cli REST bridge.",
    docs_url: messagingDocs("signal"),
    env_vars: [
      "SIGNAL_HTTP_URL",
      "SIGNAL_ACCOUNT",
      "SIGNAL_ALLOWED_USERS",
      "SIGNAL_PHONE_NUMBER",
    ],
    required_env: ["SIGNAL_HTTP_URL", "SIGNAL_ACCOUNT"],
  },
  {
    id: "bluebubbles",
    name: "BlueBubbles (iMessage)",
    description: "Use Hermes through iMessage via a BlueBubbles server.",
    docs_url: messagingDocs("bluebubbles"),
    env_vars: [
      "BLUEBUBBLES_SERVER_URL",
      "BLUEBUBBLES_PASSWORD",
      "BLUEBUBBLES_ALLOWED_USERS",
      "BLUEBUBBLES_URL",
    ],
    required_env: ["BLUEBUBBLES_SERVER_URL", "BLUEBUBBLES_PASSWORD"],
  },
  {
    id: "homeassistant",
    name: "Home Assistant",
    description: "Control your smart home from Hermes via Home Assistant.",
    docs_url: messagingDocs("homeassistant"),
    env_vars: ["HASS_URL", "HASS_TOKEN"],
    required_env: ["HASS_URL", "HASS_TOKEN"],
  },
  {
    id: "email",
    name: "Email",
    description: "Talk to Hermes through an IMAP/SMTP mailbox.",
    docs_url: messagingDocs("email"),
    env_vars: [
      "EMAIL_ADDRESS",
      "EMAIL_PASSWORD",
      "EMAIL_IMAP_HOST",
      "EMAIL_SMTP_HOST",
      "EMAIL_IMAP_SERVER",
      "EMAIL_SMTP_SERVER",
    ],
    required_env: [
      "EMAIL_ADDRESS",
      "EMAIL_PASSWORD",
      "EMAIL_IMAP_HOST",
      "EMAIL_SMTP_HOST",
    ],
  },
  {
    id: "sms",
    name: "SMS (Twilio)",
    description: "Send and receive text messages via Twilio.",
    docs_url: messagingDocs("sms"),
    env_vars: [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_PHONE_NUMBER",
      "SMS_PROVIDER",
    ],
    required_env: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
  },
  {
    id: "dingtalk",
    name: "DingTalk",
    description: "Connect Hermes to DingTalk groups.",
    docs_url: messagingDocs("dingtalk"),
    env_vars: [
      "DINGTALK_CLIENT_ID",
      "DINGTALK_CLIENT_SECRET",
      "DINGTALK_APP_KEY",
      "DINGTALK_APP_SECRET",
    ],
    required_env: ["DINGTALK_CLIENT_ID", "DINGTALK_CLIENT_SECRET"],
  },
  {
    id: "feishu",
    name: "Feishu / Lark",
    description: "Use Hermes inside Feishu / Lark.",
    docs_url: messagingDocs("feishu"),
    env_vars: [
      "FEISHU_APP_ID",
      "FEISHU_APP_SECRET",
      "FEISHU_ENCRYPT_KEY",
      "FEISHU_VERIFICATION_TOKEN",
    ],
    required_env: ["FEISHU_APP_ID", "FEISHU_APP_SECRET"],
  },
  {
    id: "wecom",
    name: "WeCom (group bot)",
    description: "Send-only WeCom group bot via webhook.",
    docs_url: messagingDocs("wecom"),
    env_vars: [
      "WECOM_BOT_ID",
      "WECOM_SECRET",
      "WECOM_CORP_ID",
      "WECOM_AGENT_ID",
    ],
    required_env: ["WECOM_BOT_ID"],
  },
  {
    id: "wecom_callback",
    name: "WeCom (app)",
    description: "Two-way WeCom integration via callback app.",
    docs_url: messagingDocs("wecom-callback"),
    env_vars: [
      "WECOM_CALLBACK_CORP_ID",
      "WECOM_CALLBACK_CORP_SECRET",
      "WECOM_CALLBACK_AGENT_ID",
      "WECOM_CALLBACK_TOKEN",
      "WECOM_CALLBACK_ENCODING_AES_KEY",
    ],
    required_env: [
      "WECOM_CALLBACK_CORP_ID",
      "WECOM_CALLBACK_CORP_SECRET",
      "WECOM_CALLBACK_AGENT_ID",
    ],
  },
  {
    id: "weixin",
    name: "WeChat (Official Account)",
    description: "Connect a WeChat Official Account.",
    docs_url: messagingDocs("weixin"),
    env_vars: [
      "WEIXIN_ACCOUNT_ID",
      "WEIXIN_TOKEN",
      "WEIXIN_BASE_URL",
      "WEIXIN_BOT_TOKEN",
    ],
    required_env: ["WEIXIN_ACCOUNT_ID", "WEIXIN_TOKEN"],
  },
  {
    id: "qqbot",
    name: "QQ Bot",
    description: "Connect Hermes to a QQ Bot from the QQ Open Platform.",
    docs_url: messagingDocs("qqbot"),
    env_vars: ["QQ_APP_ID", "QQ_CLIENT_SECRET", "QQ_ALLOWED_USERS"],
    required_env: ["QQ_APP_ID", "QQ_CLIENT_SECRET"],
  },
  {
    id: "yuanbao",
    name: "Yuanbao",
    description: "Connect Hermes to Tencent Yuanbao.",
    docs_url: messagingDocs("yuanbao"),
    env_vars: [],
    required_env: [],
  },
  {
    id: "api_server",
    name: "API server",
    description:
      "Expose Hermes as an OpenAI-compatible HTTP API for tools like Open WebUI.",
    docs_url: messagingDocs("open-webui"),
    env_vars: [
      "API_SERVER_ENABLED",
      "API_SERVER_KEY",
      "API_SERVER_PORT",
      "API_SERVER_HOST",
      "API_SERVER_MODEL_NAME",
    ],
    required_env: [],
  },
  {
    id: "webhook",
    name: "Webhooks",
    description:
      "Receive events from GitHub, GitLab, and other webhook sources.",
    docs_url: messagingDocs("webhooks"),
    env_vars: ["WEBHOOK_ENABLED", "WEBHOOK_PORT", "WEBHOOK_SECRET"],
    required_env: [],
  },
];

export function getMessagingPlatformIds(): string[] {
  return MESSAGING_PLATFORM_CATALOG.map((platform) => platform.id);
}

export function getMessagingPlatformDefinition(
  platformId: string,
): MessagingPlatformDefinition | undefined {
  return MESSAGING_PLATFORM_CATALOG.find(
    (platform) => platform.id === platformId,
  );
}

export function getMessagingPlatformEnvKeys(platformId: string): Set<string> {
  return new Set(getMessagingPlatformDefinition(platformId)?.env_vars ?? []);
}

export function getMessagingToolsetKeys(): Set<string> {
  return new Set(MESSAGING_TOOLSET_DEFINITIONS.map((toolset) => toolset.key));
}

export function buildMessagingPlatforms(
  env: Record<string, string>,
  enabled: Record<string, boolean>,
  gatewayRunning: boolean,
  platformToolsets: Record<string, string[]> = {},
  platformStates: Record<string, MessagingPlatformRuntimeState> = {},
): MessagingPlatformsResponse {
  return {
    editable: true,
    source: "desktop",
    platforms: MESSAGING_PLATFORM_CATALOG.map((platform) =>
      buildMessagingPlatform(
        platform,
        env,
        enabled,
        gatewayRunning,
        platformToolsets[platform.id],
        platformStates[platform.id],
      ),
    ),
  };
}

function buildMessagingPlatform(
  platform: MessagingPlatformDefinition,
  env: Record<string, string>,
  enabled: Record<string, boolean>,
  gatewayRunning: boolean,
  enabledToolsets?: string[],
  runtimeState?: MessagingPlatformRuntimeState,
): MessagingPlatformInfo {
  const env_vars = platform.env_vars.map((key) =>
    buildEnvVar(key, env[key] ?? "", platform.required_env.includes(key)),
  );
  const configured = isPlatformConfigured(platform, env);
  const isEnabled = enabled[platform.id] ?? configured;
  let state = "disabled";
  if (isEnabled && !configured) state = "not_configured";
  else if (isEnabled && gatewayRunning)
    state = runtimeState?.state || "configured";
  else if (isEnabled) state = "gateway_stopped";

  return {
    configured,
    description: platform.description,
    docs_url: platform.docs_url,
    enabled: isEnabled,
    error_code: gatewayRunning ? (runtimeState?.error_code ?? null) : null,
    error_message: gatewayRunning
      ? (runtimeState?.error_message ?? null)
      : null,
    env_vars,
    gateway_running: gatewayRunning,
    id: platform.id,
    name: platform.name,
    state,
    toolsets: buildMessagingToolsets(enabledToolsets),
    updated_at: gatewayRunning ? (runtimeState?.updated_at ?? null) : null,
  };
}

function buildMessagingToolsets(
  enabledToolsets?: string[],
): MessagingToolsetInfo[] {
  const enabled = new Set(
    enabledToolsets ?? DEFAULT_MESSAGING_PLATFORM_TOOLSETS,
  );
  return MESSAGING_TOOLSET_DEFINITIONS.map((toolset) => ({
    description: toolset.description,
    enabled: enabled.has(toolset.key),
    key: toolset.key,
    label: toolset.label,
    risk: toolset.risk ?? "normal",
  }));
}

function isPlatformConfigured(
  platform: MessagingPlatformDefinition,
  env: Record<string, string>,
): boolean {
  const has = (key: string): boolean => !!(env[key] ?? "").trim();
  switch (platform.id) {
    case "bluebubbles":
      return (
        (has("BLUEBUBBLES_SERVER_URL") || has("BLUEBUBBLES_URL")) &&
        has("BLUEBUBBLES_PASSWORD")
      );
    case "dingtalk":
      return (
        (has("DINGTALK_CLIENT_ID") && has("DINGTALK_CLIENT_SECRET")) ||
        (has("DINGTALK_APP_KEY") && has("DINGTALK_APP_SECRET"))
      );
    case "email":
      return (
        has("EMAIL_ADDRESS") &&
        has("EMAIL_PASSWORD") &&
        (has("EMAIL_IMAP_HOST") || has("EMAIL_IMAP_SERVER")) &&
        (has("EMAIL_SMTP_HOST") || has("EMAIL_SMTP_SERVER"))
      );
    case "signal":
      return (
        (has("SIGNAL_HTTP_URL") && has("SIGNAL_ACCOUNT")) ||
        has("SIGNAL_PHONE_NUMBER")
      );
    case "wecom":
      return (
        has("WECOM_BOT_ID") ||
        (has("WECOM_CORP_ID") && has("WECOM_AGENT_ID") && has("WECOM_SECRET"))
      );
    case "weixin":
      return (
        (has("WEIXIN_ACCOUNT_ID") && has("WEIXIN_TOKEN")) ||
        has("WEIXIN_BOT_TOKEN")
      );
    default:
      return (
        platform.required_env.length === 0 ||
        platform.required_env.every((key) => has(key))
      );
  }
}

function buildEnvVar(
  key: string,
  value: string,
  required: boolean,
): MessagingEnvVarInfo {
  const def = ENV_DEFINITIONS[key] ?? {
    key,
    prompt: key,
    description: "",
  };
  const trimmed = value.trim();
  return {
    advanced: !!def.advanced,
    description: def.description,
    is_password: !!def.is_password,
    is_set: !!trimmed,
    key,
    prompt: def.prompt,
    redacted_value: trimmed ? redactValue(trimmed) : null,
    required,
    url: def.url ?? null,
  };
}

export function redactValue(value: string): string {
  if (value.length <= 6) return "••••";
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

export function validateMessagingPlatformUpdate(
  platformId: string,
  update: MessagingPlatformUpdate,
): void {
  const platform = getMessagingPlatformDefinition(platformId);
  if (!platform) {
    throw new Error(`Unknown messaging platform: ${platformId}`);
  }
  const allowed = getMessagingPlatformEnvKeys(platformId);
  for (const key of Object.keys(update.env ?? {})) {
    if (!allowed.has(key)) {
      throw new Error(`${key} is not configurable for ${platform.name}`);
    }
  }
  for (const key of update.clear_env ?? []) {
    if (!allowed.has(key)) {
      throw new Error(`${key} is not configurable for ${platform.name}`);
    }
  }
  const allowedToolsets = getMessagingToolsetKeys();
  for (const key of Object.keys(update.toolsets ?? {})) {
    if (!allowedToolsets.has(key)) {
      throw new Error(`${key} is not a supported messaging toolset`);
    }
  }
}

export function testMessagingPlatformStatus(
  platform: MessagingPlatformInfo,
): MessagingPlatformTestResponse {
  if (!platform.enabled) {
    return {
      ok: false,
      state: platform.state,
      message: `${platform.name} is disabled. Enable it, then restart the gateway.`,
    };
  }
  if (!platform.configured) {
    const missing = platform.env_vars
      .filter((field) => field.required && !field.is_set)
      .map((field) => field.key);
    return {
      ok: false,
      state: platform.state,
      message: missing.length
        ? `Missing required setup: ${missing.join(", ")}`
        : "Platform setup is incomplete.",
    };
  }
  if (!platform.gateway_running) {
    return {
      ok: false,
      state: platform.state,
      message:
        "Gateway is not running. Start the gateway to load this platform.",
    };
  }
  if (platform.state === "connected") {
    return {
      ok: true,
      state: platform.state,
      message: `${platform.name} is connected.`,
    };
  }
  if (platform.error_message) {
    return {
      ok: false,
      state: platform.state,
      message: platform.error_message,
    };
  }
  return {
    ok: false,
    state: platform.state,
    message:
      "Setup looks complete. Desktop can verify the config, but local gateway connection reporting is not available yet.",
  };
}
