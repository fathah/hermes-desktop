import icon from "../../assets/icon.png";
import { ArrowRight, Refresh, Copy } from "../../assets/icons";
import { INSTALL_CMD } from "../../constants";
import { useI18n } from "../../components/useI18n";

interface WelcomeProps {
  error: string | null;
  onStart: () => void;
  onRecheck: () => void;
}

function Welcome({
  error,
  onStart,
  onRecheck,
}: WelcomeProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="screen welcome-screen">
      <img src={icon} height={40} width={40} alt="" />

      {error ? (
        <>
          <h1 className="welcome-title">{t("welcome.installIssueTitle")}</h1>
          <p className="welcome-subtitle">{error}</p>

          <div className="welcome-actions">
            <button
              className="btn btn-primary welcome-button"
              onClick={onStart}
            >
              {t("welcome.retryInstall")}
              <Refresh size={16} />
            </button>

            <div className="welcome-divider">
              <span>{t("welcome.dividerOr")}</span>
            </div>

            <div className="welcome-terminal-option">
              <p className="welcome-terminal-label">
                {t("welcome.terminalInstallHint")}
              </p>
              <div className="welcome-terminal-box">
                <code>{INSTALL_CMD}</code>
                <button
                  className="btn-ghost welcome-copy-btn"
                  onClick={() => navigator.clipboard.writeText(INSTALL_CMD)}
                  title={t("welcome.copyInstallCommand")}
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>

            <button
              className="btn btn-secondary welcome-recheck-btn"
              onClick={onRecheck}
            >
              {t("welcome.recheck")}
            </button>
          </div>
        </>
      ) : (
        <>
          <h1 className="welcome-title">{t("welcome.title")}</h1>
          <p className="welcome-subtitle">{t("welcome.subtitle")}</p>
          <button className="btn btn-primary welcome-button" onClick={onStart}>
            {t("welcome.getStarted")}
            <ArrowRight size={16} />
          </button>
          <p className="welcome-note">{t("welcome.installSizeHint")}</p>
        </>
      )}
    </div>
  );
}

export default Welcome;
