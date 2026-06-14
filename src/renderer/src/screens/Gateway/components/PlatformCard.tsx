import type { ReactNode } from "react";
import type { FieldDef, PlatformDef } from "../../../constants";
import BrandLogo from "../../../components/common/BrandLogo";

type PlatformCardProps = {
  platform: PlatformDef;
  enabled: boolean;
  fields: Map<string, FieldDef>;
  env: Record<string, string>;
  savedKey: string | null;
  visibleKeys: Set<string>;
  keychainKeys: Set<string>;
  t: (key: string) => string;
  onToggle: (platform: string) => void;
  onChange: (key: string, value: string) => void;
  onBlur: (key: string) => void;
  onToggleVisibility: (key: string) => void;
  children?: ReactNode;
};

function PlatformCard({
  platform,
  enabled,
  fields,
  env,
  savedKey,
  visibleKeys,
  keychainKeys,
  t,
  onToggle,
  onChange,
  onBlur,
  onToggleVisibility,
  children,
}: PlatformCardProps): React.JSX.Element {
  return (
    <div className="settings-platform-card">
      <div className="settings-platform-header">
        <div className="settings-platform-left">
          <BrandLogo provider={platform.key} size={28} />
          <div className="settings-platform-info">
            <span className="settings-platform-label">{t(platform.label)}</span>
            <span className="settings-platform-desc">
              {t(platform.description)}
            </span>
          </div>
        </div>
        <label className="tools-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={() => onToggle(platform.key)}
            title={t(platform.label)}
          />
          <span className="tools-toggle-track" />
        </label>
      </div>

      {enabled && (
        <div className="settings-platform-fields">
          {platform.fields.map((fieldKey) => {
            const field = fields.get(fieldKey);
            if (!field) return null;
            return (
              <div key={field.key} className="settings-field">
                <label className="settings-field-label">
                  {t(field.label)}
                  {savedKey === field.key && (
                    <span className="settings-saved">{t("common.saved")}</span>
                  )}
                  {field.type === "password" &&
                    env[field.key] &&
                    (keychainKeys.has(field.key) ? (
                      <span
                        className="settings-secured-badge"
                        title="Stored securely in your operating system's native keychain (macOS Keychain, Windows Credential Manager, or GNOME Keyring)"
                      >
                        🔒 Secured in OS Keychain
                      </span>
                    ) : (
                      <span
                        className="settings-warning-badge"
                        title="Saved as plain text in your profile's .env file. Enter your system password if prompted to store it in the Keychain."
                      >
                        ⚠️ Saved as plain text (.env)
                      </span>
                    ))}
                </label>
                <div className="settings-input-row">
                  <input
                    className="input"
                    type={
                      field.type === "password" && !visibleKeys.has(field.key)
                        ? "password"
                        : "text"
                    }
                    value={env[field.key] || ""}
                    onChange={(e) => onChange(field.key, e.target.value)}
                    onBlur={() => onBlur(field.key)}
                    placeholder={t(field.label)}
                  />
                  {field.type === "password" && (
                    <button
                      className="btn-ghost settings-toggle-btn"
                      type="button"
                      onClick={() => onToggleVisibility(field.key)}
                    >
                      {visibleKeys.has(field.key)
                        ? t("common.hide")
                        : t("common.show")}
                    </button>
                  )}
                </div>
                <div className="settings-field-hint">{t(field.hint)}</div>
              </div>
            );
          })}
          {children}
        </div>
      )}
    </div>
  );
}

export default PlatformCard;
