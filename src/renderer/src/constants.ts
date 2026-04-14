// ── Shared Types ────────────────────────────────────────

export interface FieldDef {
  key: string;
  label: string;
  type: string;
  hint: string;
}

export interface SectionDef {
  title: string;
  items: FieldDef[];
}

// ── Providers ───────────────────────────────────────────

export const PROVIDERS = {
  options: [
    { value: "auto", label: "Auto-detect" },
    { value: "openrouter", label: "OpenRouter" },
    { value: "anthropic", label: "Anthropic" },
    { value: "openai", label: "OpenAI" },
    { value: "google", label: "Google AI Studio" },
    { value: "xai", label: "xAI (Grok)" },
    { value: "nous", label: "Nous Portal" },
    { value: "qwen", label: "Qwen" },
    { value: "minimax", label: "MiniMax" },
    { value: "custom", label: "Local / Custom" },
  ],

  labels: {
    openrouter: "OpenRouter",
    anthropic: "Anthropic",
    openai: "OpenAI",
    google: "Google AI Studio",
    xai: "xAI (Grok)",
    nous: "Nous Portal",
    qwen: "Qwen",
    minimax: "MiniMax",
    custom: "Custom",
  } as Record<string, string>,

  setup: [
    {
      id: "openrouter",
      name: "OpenRouter",
      desc: "200+ models",
      tag: "Recommended",
      envKey: "OPENROUTER_API_KEY",
      url: "https://openrouter.ai/keys",
      placeholder: "sk-or-v1-...",
      configProvider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      needsKey: true,
    },
    {
      id: "anthropic",
      name: "Anthropic",
      desc: "Claude models",
      tag: "",
      envKey: "ANTHROPIC_API_KEY",
      url: "https://console.anthropic.com/settings/keys",
      placeholder: "sk-ant-...",
      configProvider: "anthropic",
      baseUrl: "",
      needsKey: true,
    },
    {
      id: "openai",
      name: "OpenAI",
      desc: "GPT & Codex models",
      tag: "",
      envKey: "OPENAI_API_KEY",
      url: "https://platform.openai.com/api-keys",
      placeholder: "sk-...",
      configProvider: "openai",
      baseUrl: "",
      needsKey: true,
    },
    {
      id: "google",
      name: "Google AI Studio",
      desc: "Gemini models",
      tag: "",
      envKey: "GOOGLE_API_KEY",
      url: "https://aistudio.google.com/app/apikey",
      placeholder: "AIza...",
      configProvider: "google",
      baseUrl: "",
      needsKey: true,
    },
    {
      id: "xai",
      name: "xAI (Grok)",
      desc: "Grok models",
      tag: "",
      envKey: "XAI_API_KEY",
      url: "https://console.x.ai",
      placeholder: "xai-...",
      configProvider: "xai",
      baseUrl: "",
      needsKey: true,
    },
    {
      id: "nous",
      name: "Nous Portal",
      desc: "Free tier available",
      tag: "Free",
      envKey: "",
      url: "",
      placeholder: "",
      configProvider: "nous",
      baseUrl: "",
      needsKey: false,
    },
    {
      id: "local",
      name: "Local LLM",
      desc: "LM Studio, Ollama, etc.",
      tag: "No API key needed",
      envKey: "",
      url: "",
      placeholder: "",
      configProvider: "custom",
      baseUrl: "http://localhost:1234/v1",
      needsKey: false,
    },
  ],
};

export const LOCAL_PRESETS = [
  { id: "lmstudio", name: "LM Studio", port: "1234" },
  { id: "ollama", name: "Ollama", port: "11434" },
  { id: "vllm", name: "vLLM", port: "8000" },
  { id: "llamacpp", name: "llama.cpp", port: "8080" },
];

// ── Theme ───────────────────────────────────────────────

export const THEME_OPTIONS = [
  { value: "system" as const, label: "System" },
  { value: "light" as const, label: "Light" },
  { value: "dark" as const, label: "Dark" },
];

export const THEME_STORAGE_KEY = "hermes-theme";

// ── Settings API Key Sections ───────────────────────────

export const SETTINGS_SECTIONS: SectionDef[] = [
  {
    title: "LLM Providers",
    items: [
      {
        key: "OPENROUTER_API_KEY",
        label: "OpenRouter API Key",
        type: "password",
        hint: "200+ models via OpenRouter (recommended)",
      },
      {
        key: "OPENAI_API_KEY",
        label: "OpenAI API Key",
        type: "password",
        hint: "Direct access to GPT models",
      },
      {
        key: "ANTHROPIC_API_KEY",
        label: "Anthropic API Key",
        type: "password",
        hint: "Direct access to Claude models",
      },
      {
        key: "GROQ_API_KEY",
        label: "Groq API Key",
        type: "password",
        hint: "Used for voice tools and STT",
      },
      {
        key: "GLM_API_KEY",
        label: "z.ai / GLM API Key",
        type: "password",
        hint: "ZhipuAI GLM models",
      },
      {
        key: "KIMI_API_KEY",
        label: "Kimi / Moonshot API Key",
        type: "password",
        hint: "Moonshot AI coding models",
      },
      {
        key: "MINIMAX_API_KEY",
        label: "MiniMax API Key",
        type: "password",
        hint: "MiniMax models (global)",
      },
      {
        key: "MINIMAX_CN_API_KEY",
        label: "MiniMax China API Key",
        type: "password",
        hint: "MiniMax models (China endpoint)",
      },
      {
        key: "OPENCODE_ZEN_API_KEY",
        label: "OpenCode Zen API Key",
        type: "password",
        hint: "Curated GPT, Claude, Gemini models",
      },
      {
        key: "OPENCODE_GO_API_KEY",
        label: "OpenCode Go API Key",
        type: "password",
        hint: "Open models (GLM, Kimi, MiniMax)",
      },
      {
        key: "HF_TOKEN",
        label: "Hugging Face Token",
        type: "password",
        hint: "20+ open models via HF Inference",
      },
      {
        key: "GOOGLE_API_KEY",
        label: "Google AI Studio Key",
        type: "password",
        hint: "Direct access to Gemini models",
      },
      {
        key: "XAI_API_KEY",
        label: "xAI (Grok) API Key",
        type: "password",
        hint: "Direct access to Grok models",
      },
    ],
  },
  {
    title: "Tool API Keys",
    items: [
      {
        key: "EXA_API_KEY",
        label: "Exa Search API Key",
        type: "password",
        hint: "AI-native web search",
      },
      {
        key: "PARALLEL_API_KEY",
        label: "Parallel API Key",
        type: "password",
        hint: "AI-native web search and extract",
      },
      {
        key: "TAVILY_API_KEY",
        label: "Tavily API Key",
        type: "password",
        hint: "Web search for AI agents",
      },
      {
        key: "FIRECRAWL_API_KEY",
        label: "Firecrawl API Key",
        type: "password",
        hint: "Web search, extract, and crawl",
      },
      {
        key: "FAL_KEY",
        label: "FAL.ai Key",
        type: "password",
        hint: "Image generation with FAL.ai",
      },
      {
        key: "HONCHO_API_KEY",
        label: "Honcho API Key",
        type: "password",
        hint: "Cross-session AI user modeling",
      },
    ],
  },
  {
    title: "Browser & Automation",
    items: [
      {
        key: "BROWSERBASE_API_KEY",
        label: "Browserbase API Key",
        type: "password",
        hint: "Cloud browser automation",
      },
      {
        key: "BROWSERBASE_PROJECT_ID",
        label: "Browserbase Project ID",
        type: "text",
        hint: "Project ID for Browserbase",
      },
    ],
  },
  {
    title: "Voice & STT",
    items: [
      {
        key: "VOICE_TOOLS_OPENAI_KEY",
        label: "OpenAI Voice Key",
        type: "password",
        hint: "For Whisper STT and TTS",
      },
    ],
  },
  {
    title: "Research & Training",
    items: [
      {
        key: "TINKER_API_KEY",
        label: "Tinker API Key",
        type: "password",
        hint: "RL training service",
      },
      {
        key: "WANDB_API_KEY",
        label: "Weights & Biases Key",
        type: "password",
        hint: "Experiment tracking and metrics",
      },
    ],
  },
];

// ── Gateway Sections ────────────────────────────────────

export const GATEWAY_SECTIONS: SectionDef[] = [
  {
    title: "Messaging Platforms",
    items: [
      {
        key: "TELEGRAM_BOT_TOKEN",
        label: "Telegram Bot Token",
        type: "password",
        hint: "Get from @BotFather on Telegram",
      },
      {
        key: "TELEGRAM_ALLOWED_USERS",
        label: "Telegram Allowed Users",
        type: "text",
        hint: "Comma-separated Telegram user IDs",
      },
      {
        key: "DISCORD_BOT_TOKEN",
        label: "Discord Bot Token",
        type: "password",
        hint: "From the Discord Developer Portal",
      },
      {
        key: "DISCORD_ALLOWED_CHANNELS",
        label: "Discord Allowed Channels",
        type: "text",
        hint: "Comma-separated channel IDs (optional)",
      },
      {
        key: "SLACK_BOT_TOKEN",
        label: "Slack Bot Token",
        type: "password",
        hint: "xoxb-... token from Slack app settings",
      },
      {
        key: "SLACK_APP_TOKEN",
        label: "Slack App Token",
        type: "password",
        hint: "xapp-... token for Socket Mode",
      },
      {
        key: "WHATSAPP_API_URL",
        label: "WhatsApp API URL",
        type: "text",
        hint: "WhatsApp Business API or whatsapp-web.js URL",
      },
      {
        key: "WHATSAPP_API_TOKEN",
        label: "WhatsApp API Token",
        type: "password",
        hint: "Auth token for WhatsApp API",
      },
      {
        key: "SIGNAL_PHONE_NUMBER",
        label: "Signal Phone Number",
        type: "text",
        hint: "Phone number registered with signal-cli",
      },
      {
        key: "MATRIX_HOMESERVER",
        label: "Matrix Homeserver",
        type: "text",
        hint: "e.g. https://matrix.org",
      },
      {
        key: "MATRIX_USER_ID",
        label: "Matrix User ID",
        type: "text",
        hint: "e.g. @hermes:matrix.org",
      },
      {
        key: "MATRIX_ACCESS_TOKEN",
        label: "Matrix Access Token",
        type: "password",
        hint: "Access token for Matrix login",
      },
      {
        key: "MATTERMOST_URL",
        label: "Mattermost URL",
        type: "text",
        hint: "Your Mattermost server URL",
      },
      {
        key: "MATTERMOST_TOKEN",
        label: "Mattermost Token",
        type: "password",
        hint: "Personal access token",
      },
      {
        key: "EMAIL_IMAP_SERVER",
        label: "Email IMAP Server",
        type: "text",
        hint: "e.g. imap.gmail.com",
      },
      {
        key: "EMAIL_SMTP_SERVER",
        label: "Email SMTP Server",
        type: "text",
        hint: "e.g. smtp.gmail.com",
      },
      {
        key: "EMAIL_ADDRESS",
        label: "Email Address",
        type: "text",
        hint: "Your email address",
      },
      {
        key: "EMAIL_PASSWORD",
        label: "Email Password",
        type: "password",
        hint: "App password (not your main password)",
      },
      {
        key: "SMS_PROVIDER",
        label: "SMS Provider",
        type: "text",
        hint: "twilio or vonage",
      },
      {
        key: "TWILIO_ACCOUNT_SID",
        label: "Twilio Account SID",
        type: "text",
        hint: "From Twilio dashboard",
      },
      {
        key: "TWILIO_AUTH_TOKEN",
        label: "Twilio Auth Token",
        type: "password",
        hint: "Twilio authentication token",
      },
      {
        key: "TWILIO_PHONE_NUMBER",
        label: "Twilio Phone Number",
        type: "text",
        hint: "Your Twilio phone number",
      },
      {
        key: "BLUEBUBBLES_URL",
        label: "BlueBubbles Server URL",
        type: "text",
        hint: "e.g. http://localhost:1234",
      },
      {
        key: "BLUEBUBBLES_PASSWORD",
        label: "BlueBubbles Password",
        type: "password",
        hint: "Server password",
      },
      {
        key: "DINGTALK_APP_KEY",
        label: "DingTalk App Key",
        type: "password",
        hint: "From DingTalk developer console",
      },
      {
        key: "DINGTALK_APP_SECRET",
        label: "DingTalk App Secret",
        type: "password",
        hint: "DingTalk app secret",
      },
      {
        key: "FEISHU_APP_ID",
        label: "Feishu App ID",
        type: "text",
        hint: "From Feishu developer console",
      },
      {
        key: "FEISHU_APP_SECRET",
        label: "Feishu App Secret",
        type: "password",
        hint: "Feishu app secret",
      },
      {
        key: "WECOM_CORP_ID",
        label: "WeCom Corp ID",
        type: "text",
        hint: "Your WeCom corporation ID",
      },
      {
        key: "WECOM_AGENT_ID",
        label: "WeCom Agent ID",
        type: "text",
        hint: "WeCom agent ID",
      },
      {
        key: "WECOM_SECRET",
        label: "WeCom Secret",
        type: "password",
        hint: "WeCom agent secret",
      },
      {
        key: "WEIXIN_BOT_TOKEN",
        label: "WeChat (Weixin) Bot Token",
        type: "password",
        hint: "iLink Bot API token",
      },
      {
        key: "WEBHOOK_SECRET",
        label: "Webhook Secret",
        type: "password",
        hint: "Shared secret for webhook auth",
      },
      {
        key: "HA_URL",
        label: "Home Assistant URL",
        type: "text",
        hint: "e.g. http://homeassistant.local:8123",
      },
      {
        key: "HA_TOKEN",
        label: "Home Assistant Token",
        type: "password",
        hint: "Long-lived access token",
      },
    ],
  },
];

export interface PlatformDef {
  key: string;
  label: string;
  description: string;
  fields: string[]; // env keys that belong to this platform
}

export const GATEWAY_PLATFORMS: PlatformDef[] = [
  {
    key: "telegram",
    label: "Telegram",
    description: "Connect to Telegram via Bot API",
    fields: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USERS"],
  },
  {
    key: "discord",
    label: "Discord",
    description: "Connect to Discord via bot token",
    fields: ["DISCORD_BOT_TOKEN", "DISCORD_ALLOWED_CHANNELS"],
  },
  {
    key: "slack",
    label: "Slack",
    description: "Connect to Slack workspace",
    fields: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"],
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    description: "Connect via WhatsApp Business API",
    fields: ["WHATSAPP_API_URL", "WHATSAPP_API_TOKEN"],
  },
  {
    key: "signal",
    label: "Signal",
    description: "Connect via signal-cli",
    fields: ["SIGNAL_PHONE_NUMBER"],
  },
  {
    key: "matrix",
    label: "Matrix",
    description: "Connect to Matrix/Element rooms",
    fields: ["MATRIX_HOMESERVER", "MATRIX_USER_ID", "MATRIX_ACCESS_TOKEN"],
  },
  {
    key: "mattermost",
    label: "Mattermost",
    description: "Connect to Mattermost server",
    fields: ["MATTERMOST_URL", "MATTERMOST_TOKEN"],
  },
  {
    key: "email",
    label: "Email",
    description: "Send and receive via IMAP/SMTP",
    fields: [
      "EMAIL_IMAP_SERVER",
      "EMAIL_SMTP_SERVER",
      "EMAIL_ADDRESS",
      "EMAIL_PASSWORD",
    ],
  },
  {
    key: "sms",
    label: "SMS",
    description: "Send and receive SMS via Twilio",
    fields: [
      "SMS_PROVIDER",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_PHONE_NUMBER",
    ],
  },
  {
    key: "bluebubbles",
    label: "iMessage",
    description: "Connect via BlueBubbles server",
    fields: ["BLUEBUBBLES_URL", "BLUEBUBBLES_PASSWORD"],
  },
  {
    key: "dingtalk",
    label: "DingTalk",
    description: "Connect to DingTalk workspace",
    fields: ["DINGTALK_APP_KEY", "DINGTALK_APP_SECRET"],
  },
  {
    key: "feishu",
    label: "Feishu / Lark",
    description: "Connect to Feishu workspace",
    fields: ["FEISHU_APP_ID", "FEISHU_APP_SECRET"],
  },
  {
    key: "wecom",
    label: "WeCom",
    description: "Connect to WeCom enterprise messaging",
    fields: ["WECOM_CORP_ID", "WECOM_AGENT_ID", "WECOM_SECRET"],
  },
  {
    key: "weixin",
    label: "WeChat",
    description: "Connect via iLink Bot API",
    fields: ["WEIXIN_BOT_TOKEN"],
  },
  {
    key: "webhooks",
    label: "Webhooks",
    description: "Receive messages via HTTP webhooks",
    fields: ["WEBHOOK_SECRET"],
  },
  {
    key: "home_assistant",
    label: "Home Assistant",
    description: "Connect to Home Assistant",
    fields: ["HA_URL", "HA_TOKEN"],
  },
];

// ── Install ─────────────────────────────────────────────

export const INSTALL_CMD =
  "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash";
