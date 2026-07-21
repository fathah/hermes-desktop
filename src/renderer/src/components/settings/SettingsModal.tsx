import { useEffect, useState } from "react";
import {
  Database,
  FileText,
  Info,
  Languages,
  Palette,
  Plug,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useI18n } from "../useI18n";
import { AppModal, AppModalTitle } from "../modal/AppModal";
import { useSettingsData } from "./useSettingsData";
import { SettingsDataContext } from "./SettingsDataContext";
import AppearancePane from "./AppearancePane";
import LanguagePane from "./LanguagePane";
import PrivacyPane from "./PrivacyPane";
import ConnectionPane from "./ConnectionPane";
import DataPane from "./DataPane";
import AboutPane from "./AboutPane";
import CommunityPane from "./CommunityPane";
import LogsPane from "./LogsPane";

export type SettingsSection =
  | "appearance"
  | "language"
  | "privacy"
  | "connection"
  | "data"
  | "about"
  | "community"
  | "logs";

type NavGroup = "general" | "hermes";

/** Left-nav sections, grouped. Each renders into the right-hand content pane. */
const SETTINGS_NAV: ReadonlyArray<{
  group: NavGroup;
  id: SettingsSection;
  labelKey: string;
  Icon: React.ComponentType<{ size?: number }>;
}> = [
  {
    group: "general",
    id: "appearance",
    labelKey: "settings.nav.appearance",
    Icon: Palette,
  },
  {
    group: "general",
    id: "language",
    labelKey: "settings.nav.language",
    Icon: Languages,
  },
  {
    group: "general",
    id: "privacy",
    labelKey: "settings.nav.privacy",
    Icon: ShieldCheck,
  },
  {
    group: "general",
    id: "connection",
    labelKey: "settings.nav.connection",
    Icon: Plug,
  },
  {
    group: "general",
    id: "data",
    labelKey: "settings.nav.data",
    Icon: Database,
  },
  { group: "hermes", id: "about", labelKey: "settings.nav.about", Icon: Info },
  {
    group: "hermes",
    id: "community",
    labelKey: "settings.nav.community",
    Icon: Users,
  },
  {
    group: "hermes",
    id: "logs",
    labelKey: "settings.nav.logs",
    Icon: FileText,
  },
];

const NAV_GROUP_ORDER: { id: NavGroup; labelKey: string }[] = [
  { id: "general", labelKey: "settings.nav.groups.general" },
  { id: "hermes", labelKey: "settings.nav.groups.hermes" },
];

/** Map a `/settings <name>` argument (and legacy anchor names) to a nav id. */
function resolveSection(name?: string): SettingsSection {
  const key = (name || "").trim().toLowerCase();
  if (key === "hermesagent") return "about";
  // Network merged into Connection — keep the old `/settings network` working.
  if (key === "network") return "connection";
  const match = SETTINGS_NAV.find((s) => s.id === key);
  return match ? match.id : "appearance";
}

interface SettingsModalProps {
  open: boolean;
  profile?: string;
  initialSection?: string;
  onClose: () => void;
  onExited?: () => void;
}

/**
 * Global settings modal (mirrors the profile detail modal): a grouped left
 * nav + a single active pane on the right, on the shared AppModal shell.
 * Opened from anywhere via `SettingsModalProvider`'s `openSettings`.
 */
export default function SettingsModal({
  open,
  profile,
  initialSection,
  onClose,
  onExited,
}: SettingsModalProps): React.JSX.Element {
  const { t } = useI18n();
  const data = useSettingsData(profile);
  const [section, setSection] = useState<SettingsSection>(() =>
    resolveSection(initialSection),
  );

  // Re-seed the active pane each time the modal is (re)opened or targeted at a
  // different section via the slash command.
  useEffect(() => {
    if (open) setSection(resolveSection(initialSection));
  }, [open, initialSection]);

  return (
    <AppModal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      onExitComplete={onExited}
      className="settings-modal"
      overlayClassName="settings-modal-overlay"
      labelledBy="settings-modal-title"
    >
      <aside className="settings-modal-sidebar">
        <div className="settings-modal-sidebar-head">
          <AppModalTitle
            id="settings-modal-title"
            className="settings-modal-title"
          >
            {t("settings.title")}
          </AppModalTitle>
        </div>
        <nav className="settings-modal-nav" aria-label={t("settings.title")}>
          {NAV_GROUP_ORDER.map((g) => (
            <div key={g.id} className="settings-modal-nav-group">
              <div className="settings-modal-nav-group-label">
                {t(g.labelKey)}
              </div>
              {SETTINGS_NAV.filter((s) => s.group === g.id).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`settings-modal-nav-item ${
                    section === s.id ? "active" : ""
                  }`}
                  onClick={() => setSection(s.id)}
                >
                  <s.Icon size={16} />
                  {t(s.labelKey)}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="settings-modal-main">
        <div className="settings-modal-topbar">
          <button
            type="button"
            className="settings-modal-close"
            onClick={onClose}
            aria-label={t("common.cancel")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="settings-modal-content">
          <SettingsDataContext.Provider value={data}>
            {section === "appearance" && <AppearancePane />}
            {section === "language" && <LanguagePane />}
            {section === "privacy" && <PrivacyPane />}
            {section === "connection" && <ConnectionPane />}
            {section === "data" && <DataPane />}
            {section === "about" && <AboutPane />}
            {section === "community" && <CommunityPane />}
            {section === "logs" && <LogsPane />}
          </SettingsDataContext.Provider>
        </div>
      </div>
    </AppModal>
  );
}
