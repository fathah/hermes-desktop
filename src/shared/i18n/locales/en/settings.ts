export default {
  title: "Settings",
  sections: {
    hermesAgent: "Hermes Agent",
    appearance: "Appearance",
    credentialPool: "Credential Pool",
  },
  theme: {
    label: "Theme",
    system: "System",
    light: "Light",
    dark: "Dark",
  },
  notDetected: "Not detected",
  updatedSuccessfully: "Updated successfully!",
  updateFailed: "Update failed.",
  migrationComplete:
    "Migration complete! Your config, keys, and data have been imported.",
  migrationFailed: "Migration failed.",
} as const;
