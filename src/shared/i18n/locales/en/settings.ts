export default {
  title: "Settings",
  sections: {
    hermesAgent: "Hermes Agent",
    appearance: "Appearance",
    credentialPool: "Credential Pool",
  },
  language: {
    label: "Language",
    hint: "Choose your preferred language",
  },
  theme: {
    label: "Theme",
    hint: "Choose your preferred appearance",
    system: "System",
    light: "Light",
    dark: "Dark",
  },
  connection: {
    title: "Connection",
    mode: "Mode",
    local: "Local",
    remote: "Remote",
    localHint: "Using Hermes installed on this device",
    remoteHint: "Connect to a Hermes API server on your network or cloud",
  },
  notDetected: "Not detected",
  updatedSuccessfully: "Updated successfully!",
  updateFailed: "Update failed.",
  migrationComplete:
    "Migration complete! Your config, keys, and data have been imported.",
  migrationFailed: "Migration failed.",
} as const;
