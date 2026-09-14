import { Coffee, ExternalLink, Globe } from "lucide-react";
import { useI18n } from "../useI18n";
import BrandLogo from "../common/BrandLogo";
import xLogo from "../../assets/logos/twitter.svg";
import {
  DISCORD_COMMUNITY_URL,
  HERMES_TELEGRAM_URL,
  HERMES_WEBSITE_URL,
  HERMES_X_URL,
  KOFI_SUPPORT_URL,
} from "./settingsHelpers";

/** Community + support links. */
export default function CommunityPane(): React.JSX.Element {
  const { t } = useI18n();

  const open = (url: string) => () => window.hermesAPI.openExternal(url);

  return (
    <div className="settings-modal-pane">
      <p className="settings-section-intro">
        {t("settings.communityLinksHint")}
      </p>

      <div className="settings-link-grid">
        <button
          type="button"
          className="settings-link is-primary"
          onClick={open(DISCORD_COMMUNITY_URL)}
          title={DISCORD_COMMUNITY_URL}
        >
          <span className="settings-link-icon">
            <BrandLogo provider="discord" size={18} />
          </span>
          <span className="settings-link-label">
            {t("settings.linkDiscord")}
          </span>
          <ExternalLink size={14} className="settings-link-arrow" />
        </button>

        <button
          type="button"
          className="settings-link"
          onClick={open(HERMES_WEBSITE_URL)}
          title={HERMES_WEBSITE_URL}
        >
          <span className="settings-link-icon">
            <Globe size={18} />
          </span>
          <span className="settings-link-label">
            {t("settings.linkWebsite")}
          </span>
          <ExternalLink size={14} className="settings-link-arrow" />
        </button>

        <button
          type="button"
          className="settings-link"
          onClick={open(HERMES_X_URL)}
          title={HERMES_X_URL}
        >
          <span className="settings-link-icon">
            <img
              src={xLogo}
              width={16}
              height={16}
              className="brand-logo brand-logo--match-theme"
              alt="X"
            />
          </span>
          <span className="settings-link-label">{t("settings.linkX")}</span>
          <ExternalLink size={14} className="settings-link-arrow" />
        </button>

        <button
          type="button"
          className="settings-link"
          onClick={open(HERMES_TELEGRAM_URL)}
          title={HERMES_TELEGRAM_URL}
        >
          <span className="settings-link-icon">
            <BrandLogo provider="telegram" size={18} />
          </span>
          <span className="settings-link-label">
            {t("settings.linkTelegram")}
          </span>
          <ExternalLink size={14} className="settings-link-arrow" />
        </button>
      </div>

      <section className="settings-card">
        <header className="settings-card-head">
          <span className="settings-card-icon">
            <Coffee size={18} />
          </span>
          <div className="settings-card-headtext">
            <div className="settings-card-title">
              {t("settings.supportTitle")}
            </div>
            <div className="settings-card-sub">{t("settings.supportHint")}</div>
          </div>
        </header>
        <div className="settings-card-body">
          <div className="settings-card-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={open(KOFI_SUPPORT_URL)}
              title={KOFI_SUPPORT_URL}
            >
              <Coffee size={14} />
              {t("settings.supportKofi")}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
