import { Signal } from "../assets/icons";
import { useI18n } from "./useI18n";

function RemoteNotice({ feature }: { feature: string }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="remote-notice">
      <Signal size={28} className="remote-notice-icon" />
      <p className="remote-notice-title">{t("common.remoteNoticeTitle")}</p>
      <p className="remote-notice-desc">
        {t("common.remoteNoticeDesc", { feature })}
      </p>
    </div>
  );
}

export default RemoteNotice;
