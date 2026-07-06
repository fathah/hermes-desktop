export default {
  title: "Configuration health",
  description:
    "Audit of the desktop's configuration (env vars, config.yaml, models). Surfaces inconsistencies that commonly cause chat to fail, with one-click fixes where it's safe to apply them automatically.",
  rerun: "Re-run audit",
  allGood: "No issues detected. Your configuration looks consistent.",
  banner: {
    lead: "Configuration issues detected:",
    errors: "{{count}} error(s)",
    warnings: "{{count}} warning(s)",
    infos: "{{count}} note(s)",
    showDetails: "Show details",
  },
  apiKeyBanner: {
    lead: "API Server Key not set — chat will fail.",
    setNow: "SET NOW",
  },
  apiKeyModal: {
    title: "Set API Server Key",
    description:
      "API_SERVER_KEY is required for the Hermes gateway to authenticate requests. Set it now to enable chat. If you keep secrets in a vault (KeePassXC, Bitwarden, etc.) and your Hermes `secrets.provider` is already pointing at it, this warning can be ignored — the provider serves the key directly.",
    label: "API Server Key",
    placeholder: "sk-… or any secret",
    autoGenerate: "Auto-generate",
    hint: "You can paste your own key or generate a random UUID.",
  },
  fix: {
    apply: "Apply fix",
    running: "Applying…",
    success: "Fix applied.",
    failure: "Fix failed.",
  },
};
