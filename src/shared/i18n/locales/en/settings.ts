export default {
  title: "Settings",
  sections: {
    hermesAgent: "Hermes Agent",
    appearance: "Appearance",
    privacy: "Privacy",
    credentialPool: "Credential Pool",
  },
  theme: {
    label: "Theme",
    system: "System",
    light: "Light",
    dark: "Dark",
  },
  roundedCorners: {
    label: "Rounded corners",
    hint: "Turn off for squared-off corners throughout the app",
  },
  font: {
    label: "Font",
    manrope: "Manrope",
    system: "System",
    hint: "Choose the interface font",
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
    hint: "Helps improve Hermes One by sending anonymous, aggregated usage data to the project's PostHog instance. You can turn this off at any time.",
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

  // Community
  communityTitle: "Community",
  communityHint:
    "Join our Discord channel to ask questions, report issues, and chat with other Hermes users.",
  joinDiscord: "Join Discord Channel",

  // SSH & Server Config
  modeSsh: "SSH Tunnel",
  modeSshHint:
    "Tunnel to a remote Hermes over SSH — no exposed ports or API keys needed.",
  sessionDisabledTitle: "Session history disabled — API_SERVER_KEY not set",
  sessionDisabledDesc:
    "Without an API server key the gateway cannot authenticate session continuation requests. Messages will still send, but conversation history won't be preserved across restarts.",
  generateKey: "Generate & save a key for me",
  generating: "Generating…",
  remoteEnvTitle: "Set API_SERVER_KEY on the remote server",
  remoteEnvSshDesc:
    "SSH mode: add API_SERVER_KEY=<your-key> to ~/.hermes/profiles/<profile>/.env on the remote host, then restart the gateway there.",
  remoteEnvDesc:
    "Remote mode: add API_SERVER_KEY=<your-key> to the .env on your remote Hermes server, then restart the gateway.",
  sshHost: "SSH Host",
  sshPort: "SSH Port",
  sshUsername: "Username",
  sshKeyPath: "Private Key Path",
  sshKeyPathOptional: "(optional, defaults to ~/.ssh/id_rsa)",
  sshRemotePort: "Remote Hermes Port",
  sshRemotePortDefault: "(default 8642)",
  sshHint:
    "Make sure you can run ssh {{cmd}} without a password prompt. The first connection trusts the host key and stores it in ~/.ssh/known_hosts; SSH will fail closed if that key changes later.",
  sshHintWelcome:
    "Uses your system SSH. Make sure you can already run ssh {{cmd}} without a password prompt.",
  testingSsh: "Testing SSH…",
  testSsh: "Test SSH Connection",
  connectSsh: "Connect via SSH",
  sshTitle: "Connect via SSH",
  sshSubtitle:
    "Tunnel to a remote Hermes over SSH — no exposed ports or API keys needed.",
  sshHostPlaceholder: "192.168.1.100 or myserver.local",
  sshUsernamePlaceholder: "hermes",
  sshErrorRequired: "Host and username are required.",
  sshErrorConnection:
    "Could not connect via SSH or reach Hermes on the remote. Make sure:\n• SSH key is correct (or default ~/.ssh/id_rsa works)\n• Hermes gateway is running on the remote\n• The remote port is correct (default 8642)",
  sshErrorFailed: "SSH connection test failed: {{msg}}",
  sshErrorFailedSimple: "SSH connection test failed.",
  remoteErrorUrl: "Please enter a URL.",
  remoteErrorConnection:
    "Could not reach Hermes at this URL. Check the URL and API key.\n\nLeave the key empty if the server accepts unauthenticated requests (e.g. via SSH tunnel to localhost).",
  remoteErrorFailed: "Connection test failed.",
  sshSuccess: "SSH tunnel connected!",
  sshErrorRequiredSimple: "Host and username are required",
  remoteSuccess: "Connected successfully!",
  remoteErrorRequiredSimple: "Please enter a URL",
  remoteErrorFailedSimple: "Could not reach server",
  apiGenerated: "API key generated — gateway restarting…",
  refreshFromVault: "Refresh from vault",
  refreshingFromVault: "Refreshing…",

  // Security Providers section (secrets.provider: env / command / bitwarden)
  secrets_sectionTitle: "Security Providers",
  secrets_sectionHint:
    "Choose where Hermes resolves API keys from. Process env and .env always win over a provider — a provider only fills keys that aren't already set.",
  secrets_active: "Active",
  secrets_useProvider: "Use this",
  secrets_activating: "Switching…",
  secrets_envActiveNote:
    "Reads keys from .env and the shell — no setup needed.",
  secrets_providerEnvTitle: "Environment (.env)",
  secrets_providerEnvDesc:
    "The default. Keys come from ~/.hermes/.env and the shell environment.",
  secrets_providerCommandTitle: "Command helper",
  secrets_providerCommandDesc:
    "Run a helper that prints the secret(s) — keepassxc-cli, pass, secret-tool, or a script that dumps a tmpfs env file. POSIX only.",
  secrets_providerBitwardenTitle: "Bitwarden",
  secrets_providerBitwardenDesc:
    "Pull secrets from Bitwarden Secrets Manager (cloud). Configured from the CLI.",
  secrets_helperCommandLabel: "Helper command",
  secrets_helperCommandHint:
    "The requested key is passed in $HERMES_SECRET_KEY (never interpolated into the command). Print the bare secret, or a KEY=VALUE dotenv blob.",
  secrets_bitwardenCliHint:
    "Set up Bitwarden from the terminal: hermes secrets bitwarden setup",
  secrets_testButton: "Test",
  secrets_testing: "Testing…",
  secrets_testResolved: "Resolved {{count}} key(s):",
  secrets_testValuesHidden: "Values are never displayed — only key names.",
  secrets_testEmpty:
    "No keys resolved. If this is a bare-value helper it still resolves single keys on demand; otherwise check the command.",
  secrets_testFailed:
    "The provider could not be tested. Check the helper command.",
} as const;
