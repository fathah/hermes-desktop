export default {
  title: "Settings",
  sections: {
    hermesAgent: "Hermes Agent",
    appearance: "Appearance",
    writingTools: "Writing Tools",
    privacy: "Privacy",
    credentialPool: "Credential Pool",
  },
  writingTools: {
    enabled: "Enable writing tools",
    enabledHint:
      "Global desktop preferences for spellcheck, autocomplete, and translation in the chat composer.",
    saving: "Saving...",
    modelLabel: "Saved model",
    modelHint:
      "Select a saved model from the Models library for LLM-backed writing tools.",
    modelUnset: "Select a saved model",
    mode: {
      off: "Off",
      llm: "LLM",
    },
    spellcheck: {
      label: "Spellcheck",
      native: "Native spellcheck",
      hint:
        "Uses the operating system and Chromium spellcheck support instead of sending text to a model.",
    },
    autocomplete: {
      label: "Autocomplete",
      dictionary: "Dictionary / local",
      hint:
        "Suggestions while typing. Keep this off by default if you want to avoid background draft processing.",
    },
    translation: {
      label: "Translation",
      onDemand: "On demand",
      preSend: "Pre-send",
      hint:
        "Translate selected text or the full draft. Pre-send mode remains opt-in because it changes outgoing text.",
      targetLanguage: "Target language",
      targetPlaceholder: "e.g. German, English, Spanish",
      targetHint:
        "Leave blank until you know the target language you want to use most often.",
      preserveTone: "Preserve tone when translating",
    },
  },
  theme: {
    label: "Theme",
    system: "System",
    light: "Light",
    dark: "Dark",
  },
  language: {
    label: "Language",
    english: "English",
    indonesian: "Bahasa Indonesia",
    japanese: "日本語",
    spanish: "Español",
    chinese: "中文",
    portuguese: "Portuguese",
    turkish: "Türkçe",
    hint: "Choose the interface language",
  },
  analytics: {
    label: "Send anonymous usage analytics",
    hint: "Helps improve Hermes Desktop by sending anonymous, aggregated usage data to the project's PostHog instance. You can turn this off at any time.",
    disclosure: {
      uuid: "A random per-install identifier stored only on this device (no name, email, or account info).",
      platform: "Your operating system, Electron version, and Node.js version.",
      navigation:
        "Which screens you visit inside the app (e.g. Chat, Sessions, Settings). No chat content, prompts, model responses, or file contents are collected.",
      endpoint:
        "Data is sent to us.i.posthog.com (PostHog US cloud). Session recordings and pageview auto-capture are disabled.",
      notCollected:
        "Never collected: chat messages, file paths, API keys, model configuration, account credentials.",
    },
  },
  notDetected: "Not detected",
  updatedSuccessfully: "Updated successfully!",
  updateSuccess: "Hermes updated successfully.",
  updateFailed: "Update failed.",
  version: "v{{version}}",
  proxyPlaceholder: "e.g. socks5://127.0.0.1:1080 or http://proxy:8080",
  modelNamePlaceholder: "e.g. anthropic/claude-opus-4.6",
  modelBaseUrlPlaceholder: "http://localhost:1234/v1",
  networkSection: "Network",
  forceIpv4: "Force IPv4",
  forceIpv4Hint:
    "Disable IPv6 to fix connection timeout issues on some networks",
  httpProxy: "HTTP Proxy",
  httpProxyHint:
    "SOCKS or HTTP proxy for all outgoing connections (leave blank for auto-detect)",
  saved: "Saved",
  providerHint: "Select an inference provider, or auto-detect based on API Key",
  customProviderHint:
    "Use any OpenAI-compatible API (LM Studio, Ollama, vLLM, etc.)",
  modelHint: "Default model name (leave blank to use provider default)",
  refreshModels: "Refresh model list",
  discoveringModels: "Loading available models…",
  discoveredCount: "{{count}} models available — start typing to filter",
  discoveryNoKey:
    "Set this provider's API key in .env to load the available model list",
  discoveryError:
    "Couldn't reach the provider's model list — you can still type a model name",
  customBaseUrlHint: "OpenAI-compatible API endpoint",
  poolHint:
    "Add multiple API Keys for the same provider for automatic rotation and load balancing. Hermes will cycle through them.",
  add: "Add",
  remove: "Remove",
  keyLabel: "Key",
  empty: "(empty)",
  dataSection: "Data",
  dataHint:
    "Export or import your Hermes configuration, sessions, skills, and memory.",
  backingUp: "Backing up...",
  exportBackup: "Export Backup",
  importing: "Importing...",
  importBackup: "Import Backup",
  logsSection: "Logs",
  refresh: "Refresh",
  emptyLog: "(empty)",
  updating: "Updating...",
  updateEngine: "Update Engine",
  latestVersion: "Already up to date",
  runningDiagnosis: "Running diagnosis...",
  runDiagnosis: "Run Diagnosis",
  running: "Running...",
  debugDump: "Debug Dump",
  migrationDetected: "OpenClaw Installation Detected",
  migrationDesc:
    "Found OpenClaw at <code>{{path}}</code>. You can migrate your configuration, API keys, sessions, and skills to Hermes.",
  migrationDismiss: "Don't show again",
  migrating: "Migrating...",
  migrateToHermes: "Migrate to Hermes",
  skip: "Skip",
  appearanceHint: "Choose your preferred interface appearance",
  apiKeyPlaceholder: "API Key",
  labelPlaceholder: "Label ({{optional}})",
  connectionSection: "Connection",
  modeLocal: "Local",
  modeRemote: "Remote",
  modeLocalHint: "Using Hermes installed on this device",
  modeRemoteHint: "Connect to a Hermes API server on your network or cloud",
  remoteUrl: "Remote URL",
  remoteUrlHint:
    "The Hermes API server URL (must expose /health and /v1/chat/completions)",
  remoteApiKey: "API Key",
  remoteApiKeyHint:
    "Matches API_SERVER_KEY on the remote host. Leave empty if the server accepts unauthenticated requests.",
  testingConnection: "Testing...",
  testConnection: "Test Connection",
  save: "Save",
  serverConfigTitle: "Server Configuration",
  serverConfigHint:
    "You&apos;re connected to a remote Hermes server. Model selection, provider API keys, and credentials are managed on the server&apos;s <code>~/.hermes/.env</code> and <code>config.yaml</code>. Edit them on the host (e.g. <code>docker exec -it hermes vi /opt/data/.env</code>) and restart the container.",
  connectionMode: "Mode",
  switchedToLocal: "Switched to local mode",
} as const;
