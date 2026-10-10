import { useState, useEffect, useRef, useCallback } from "react";
import { Refresh } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import { OrbLoader } from "../../components/OrbLoader";

interface SoulProps {
  profile?: string;
  /** False where "reset" cannot work (Remote): it would restore a LOCAL default
   *  template, so the button is not offered. Defaults to true. */
  allowReset?: boolean;
}

function Soul({ profile, allowReset = true }: SoulProps): React.JSX.Element {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSoul = useCallback(async (): Promise<void> => {
    loaded.current = false;
    setLoading(true);
    setLoadError("");
    setSaveError("");
    try {
      const text = await window.hermesAPI.readSoul(profile);
      setContent(text);
      setTimeout(() => {
        loaded.current = true;
      }, 300);
    } catch (err) {
      // Stay "not loaded" so the autosave below can never write an empty editor
      // over a SOUL.md that simply failed to load.
      setContent("");
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    loadSoul();
  }, [loadSoul]);

  const saveSoul = useCallback(
    async (text: string) => {
      if (!loaded.current) return;
      try {
        await window.hermesAPI.writeSoul(text, profile);
        setSaveError("");
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (err) {
        setSaved(false);
        setSaveError(err instanceof Error ? err.message : String(err));
      }
    },
    [profile],
  );

  useEffect(() => {
    if (!loaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveSoul(content);
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [content, saveSoul]);

  async function handleReset(): Promise<void> {
    const newContent = await window.hermesAPI.resetSoul(profile);
    loaded.current = false;
    setContent(newContent);
    setShowReset(false);
    setSaved(true);
    setTimeout(() => {
      loaded.current = true;
      setSaved(false);
    }, 2000);
  }

  if (loading) {
    return (
      <div className="soul-container">
        <div className="soul-loading">
          <OrbLoader state="searching" size={64} />
        </div>
      </div>
    );
  }

  return (
    <div className="soul-container">
      <div className="soul-header">
        <div>
          <h2 className="soul-title">
            {t("soul.title")}
            {saved && <span className="soul-saved">{t("common.saved")}</span>}
          </h2>
          <p className="soul-subtitle">{t("soul.subtitle")}</p>
        </div>
        {allowReset && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowReset(true)}
            title={t("soul.resetTitle")}
          >
            <Refresh size={14} />
            {t("soul.reset")}
          </button>
        )}
      </div>

      {loadError && (
        <div className="memory-error" role="alert">
          {loadError}
        </div>
      )}
      {saveError && (
        <div className="memory-error" role="alert">
          {saveError}
        </div>
      )}

      {showReset && (
        <div className="soul-reset-confirm">
          <span>{t("soul.resetConfirm")}</span>
          <div className="soul-reset-actions">
            <button className="btn btn-primary btn-sm" onClick={handleReset}>
              {t("soul.reset")}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowReset(false)}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      <textarea
        className="soul-editor"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t("soul.placeholder")}
        spellCheck={false}
      />

      <div className="soul-hint">{t("soul.hint")}</div>
    </div>
  );
}

export default Soul;
