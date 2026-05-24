import { useI18n } from "./useI18n";

interface VerifyWarningBannerProps {
  onReinstall: () => void;
  onDismiss: () => void;
}

/**
 * Soft warning shown when checkInstall() succeeded (files exist) but the
 * deep `verifyInstall` probe failed. Replaces the previous hard-bounce to
 * the Welcome screen, which trapped restricted-network users in a reinstall
 * loop on every launch (#130).
 */
function VerifyWarningBanner({
  onReinstall,
  onDismiss,
}: VerifyWarningBannerProps): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="verify-warning-banner" role="status">
      <span className="verify-warning-text">{t("errors.verifyFailed")}</span>
      <div className="verify-warning-actions">
        <button
          className="btn btn-secondary btn-sm"
          onClick={onReinstall}
          type="button"
        >
          {t("errors.verifyReinstall")}
        </button>
        <button className="btn-ghost btn-sm" onClick={onDismiss} type="button">
          {t("errors.verifyDismiss")}
        </button>
      </div>
    </div>
  );
}

export default VerifyWarningBanner;
