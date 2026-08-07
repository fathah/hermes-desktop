import { Check, ImagePlus, Trash2 } from "lucide-react";
import { SOFT_BACKGROUNDS, useSoftBackground } from "../SoftBackgroundProvider";
import { useI18n } from "../useI18n";

/** Per-agent soft-background gallery shown in the Profile settings pane. */
export default function SoftBackgroundPicker({
  profile,
}: {
  profile: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const {
    backgroundForProfile,
    customBackgrounds,
    addCustomBackgrounds,
    removeCustomBackground,
    customBackgroundBusy,
    customBackgroundError,
    setBackgroundForProfile,
  } = useSoftBackground();
  const background = backgroundForProfile(profile);

  const handleAdd = async (): Promise<void> => {
    const added = await addCustomBackgrounds();
    if (added[0]) setBackgroundForProfile(profile, added[0].id);
  };

  return (
    <div className="profile-modal-section profile-modal-background-section">
      <span className="profile-modal-label">
        {t("settings.softBackground.label")}
      </span>
      <span className="settings-field-hint settings-background-hint">
        {t("settings.softBackground.hint")}
      </span>
      <div className="settings-background-grid">
        <button
          type="button"
          className={`settings-background-card ${
            background === "none" ? "active" : ""
          }`}
          aria-pressed={background === "none"}
          onClick={() => setBackgroundForProfile(profile, "none")}
        >
          <span className="settings-background-preview settings-background-none" />
          <span className="settings-background-name">
            {t("settings.softBackground.none")}
          </span>
          {background === "none" && (
            <span className="settings-background-check">
              <Check size={14} />
            </span>
          )}
        </button>
        {SOFT_BACKGROUNDS.map((option) => {
          const active = background === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={`settings-background-card ${active ? "active" : ""}`}
              aria-pressed={active}
              onClick={() => setBackgroundForProfile(profile, option.id)}
            >
              <img
                className="settings-background-preview"
                src={option.image}
                alt=""
              />
              <span className="settings-background-name">{option.name}</span>
              {active && (
                <span className="settings-background-check">
                  <Check size={14} />
                </span>
              )}
            </button>
          );
        })}
        {customBackgrounds.map((option) => {
          const active = background === option.id;
          return (
            <div className="settings-background-card-shell" key={option.id}>
              <button
                type="button"
                className={`settings-background-card ${active ? "active" : ""}`}
                aria-pressed={active}
                onClick={() => setBackgroundForProfile(profile, option.id)}
              >
                <img
                  className="settings-background-preview"
                  src={option.image}
                  alt=""
                />
                <span className="settings-background-name">{option.name}</span>
                {active && (
                  <span className="settings-background-check">
                    <Check size={14} />
                  </span>
                )}
              </button>
              <button
                type="button"
                className="settings-background-remove"
                aria-label={t("settings.softBackground.remove", {
                  name: option.name,
                })}
                disabled={customBackgroundBusy}
                onClick={() => void removeCustomBackground(option.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="settings-background-card settings-background-add"
          disabled={customBackgroundBusy}
          onClick={() => void handleAdd()}
        >
          <span className="settings-background-preview settings-background-add-preview">
            <ImagePlus size={22} />
          </span>
          <span className="settings-background-name">
            {customBackgroundBusy
              ? t("settings.softBackground.adding")
              : t("settings.softBackground.add")}
          </span>
        </button>
      </div>
      {customBackgroundError && (
        <div className="settings-field-hint settings-background-error">
          {t("settings.softBackground.error")}
        </div>
      )}
    </div>
  );
}
