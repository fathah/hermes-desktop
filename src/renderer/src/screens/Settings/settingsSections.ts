import type { NormalizedAdminView } from "../../lib/openSettings";

export type SettingsSection = Extract<
  NormalizedAdminView,
  "preferences" | "dataPrivacy" | "troubleshooting" | "advanced"
>;

export const SETTINGS_SECTION_COPY: Record<
  SettingsSection,
  { title: string; subtitle: string }
> = {
  preferences: {
    title: "Preferences",
    subtitle: "Language, appearance, and daily assistant behavior.",
  },
  dataPrivacy: {
    title: "Data & Privacy",
    subtitle: "Analytics, backups, vault health, and local workspace data.",
  },
  troubleshooting: {
    title: "Troubleshooting",
    subtitle: "Health checks, versions, logs, and diagnostic reports.",
  },
  advanced: {
    title: "Advanced",
    subtitle: "Remote access, SSH, network proxy, and developer controls.",
  },
};
