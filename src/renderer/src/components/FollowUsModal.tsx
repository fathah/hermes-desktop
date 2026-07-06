import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "./useI18n";

const STORAGE_KEY = "hermes-follow-x-dismissed";
const X_URL = "https://x.com/HermesOneApp";

/** Inline X (Twitter) logo — lucide-react removed the Twitter icon. */
function XLogo({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function FollowUsModal(): React.JSX.Element | null {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show if user hasn't previously dismissed
    if (localStorage.getItem(STORAGE_KEY) !== "true") {
      setVisible(true);
    }
  }, []);

  const handleFollow = (): void => {
    void window.hermesAPI.openExternal(X_URL);
    handleDismiss();
  };

  const handleDismiss = (): void => {
    localStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="models-modal-overlay" onClick={handleDismiss}>
      <div className="follow-us-modal" onClick={(e) => e.stopPropagation()}>
        <div className="models-modal-header">
          <h2 className="models-modal-title">{t("chat.followUs.title")}</h2>
          <button
            className="btn-ghost"
            onClick={handleDismiss}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="follow-us-body">
          <div className="follow-us-icon-row">
            <XLogo size={28} className="follow-us-x-icon" />
          </div>
          <p className="follow-us-description">
            {t("chat.followUs.description")}
          </p>
        </div>
        <div className="models-modal-footer follow-us-footer">
          <button className="btn btn-ghost btn-sm" onClick={handleDismiss}>
            {t("chat.followUs.notNow")}
          </button>
          <button
            className="btn btn-primary btn-sm follow-us-btn"
            onClick={handleFollow}
          >
            <XLogo size={14} />
            {t("chat.followUs.follow")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default FollowUsModal;
