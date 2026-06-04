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
  fix: {
    apply: "Apply fix",
    running: "Applying…",
    success: "Fix applied.",
    failure: "Fix failed.",
  },
};
