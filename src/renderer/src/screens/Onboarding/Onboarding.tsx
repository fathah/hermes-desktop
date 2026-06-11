import { useEffect, useState } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  KeyRound,
  Settings,
  Sparkles,
} from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import type { AdminView } from "../../lib/openSettings";

interface OnboardingProps {
  /** Connection mode — config checklist is local-only (remote/ssh config lives
   *  on the remote server, so the local API-key/model status is meaningless). */
  connectionMode: "local" | "remote" | "ssh";
  /** Finish onboarding and enter the workspace. */
  onFinish: () => void;
  /** Finish onboarding and deep-link into a specific admin tab to fix config. */
  onConfigure: (view: AdminView) => void;
}

const isMac = window.electron?.process?.platform === "darwin";
const MOD = isMac ? "⌘" : "Ctrl+";

function Onboarding({
  connectionMode,
  onFinish,
  onConfigure,
}: OnboardingProps): React.JSX.Element {
  const { t } = useI18n();
  const isLocal = connectionMode === "local";

  // Config status is read once on mount: deep-linking to fix it leaves this
  // screen (and marks onboarding done), so there's nothing to re-poll.
  const [loading, setLoading] = useState(isLocal);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [hasModel, setHasModel] = useState(false);

  useEffect(() => {
    if (!isLocal) return;
    let alive = true;
    void (async () => {
      try {
        const status = await window.hermesAPI.checkInstall();
        const model = await window.hermesAPI.getModelConfig();
        if (!alive) return;
        setHasApiKey(status.hasApiKey);
        setHasModel(Boolean(model.model.trim()));
      } catch {
        /* leave both false — the action buttons still guide the user */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isLocal]);

  const orientCards = [
    {
      icon: <Bot size={20} />,
      title: t("onboarding.orientChatTitle"),
      desc: t("onboarding.orientChatDesc"),
      hint: `${MOD}O`,
    },
    {
      icon: <Sparkles size={20} />,
      title: t("onboarding.orientDocTitle"),
      desc: t("onboarding.orientDocDesc"),
      hint: "/",
    },
    {
      icon: <Settings size={20} />,
      title: t("onboarding.orientSettingsTitle"),
      desc: t("onboarding.orientSettingsDesc"),
      hint: `${MOD},`,
    },
  ];

  const allReady = hasApiKey && hasModel;

  return (
    <div className="screen onboarding-screen">
      <h1 className="onboarding-title">{t("onboarding.title")}</h1>
      <p className="onboarding-subtitle">{t("onboarding.subtitle")}</p>

      <div className="onboarding-orient-grid">
        {orientCards.map((card) => (
          <div key={card.title} className="onboarding-orient-card">
            <span className="onboarding-orient-icon">{card.icon}</span>
            <div className="onboarding-orient-title">{card.title}</div>
            <div className="onboarding-orient-desc">{card.desc}</div>
            <kbd className="onboarding-kbd">{card.hint}</kbd>
          </div>
        ))}
      </div>

      {isLocal && !loading && (
        <div className="onboarding-checklist">
          <div className="onboarding-checklist-head">
            <h2 className="onboarding-checklist-title">
              {t("onboarding.checklistTitle")}
            </h2>
            <p className="onboarding-checklist-subtitle">
              {allReady
                ? t("onboarding.ready")
                : t("onboarding.checklistSubtitle")}
            </p>
          </div>

          <CheckItem
            done={hasApiKey}
            idleIcon={<KeyRound size={16} />}
            label={
              hasApiKey
                ? t("onboarding.apiKeyDone")
                : t("onboarding.apiKeyLabel")
            }
            action={t("onboarding.apiKeyAction")}
            onAction={() => onConfigure("providers")}
          />
          <CheckItem
            done={hasModel}
            idleIcon={<Sparkles size={16} />}
            label={
              hasModel ? t("onboarding.modelDone") : t("onboarding.modelLabel")
            }
            action={t("onboarding.modelAction")}
            onAction={() => onConfigure("models")}
          />
        </div>
      )}

      <div style={{ marginTop: 10, textAlign: "center" }}>
        <button className="btn btn-primary onboarding-cta" onClick={onFinish}>
          {t("onboarding.enterWorkspace")}
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

interface CheckItemProps {
  done: boolean;
  idleIcon: React.ReactNode;
  label: string;
  action: string;
  onAction: () => void;
}

function CheckItem({
  done,
  idleIcon,
  label,
  action,
  onAction,
}: CheckItemProps): React.JSX.Element {
  const statusIcon = done ? <Check size={16} /> : idleIcon;
  const itemClass = done
    ? "onboarding-check-item done"
    : "onboarding-check-item";
  return (
    <div className={itemClass}>
      <span className="onboarding-check-status" aria-hidden="true">
        {statusIcon}
      </span>
      <span className="onboarding-check-label">{label}</span>
      {!done && (
        <button
          className="btn btn-secondary onboarding-check-action"
          onClick={onAction}
        >
          {action}
        </button>
      )}
    </div>
  );
}

export default Onboarding;
