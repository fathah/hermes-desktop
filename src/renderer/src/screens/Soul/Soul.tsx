import { useState, useEffect, useRef, useCallback } from "react";
import { Refresh } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import { OrbLoader } from "../../components/OrbLoader";
import { useProfileEditorTarget } from "../../hooks/useProfileEditorTarget";
import type { ProfileEditorTarget } from "../../../../shared/profile-editor-target";

interface SoulProps {
  profile?: string;
  /** False where "reset" cannot work (Remote): it would restore a LOCAL default
   *  template, so the button is not offered. Defaults to true. */
  allowReset?: boolean;
}

function Soul({ profile, allowReset = true }: SoulProps): React.JSX.Element {
  const scope = useProfileEditorTarget(profile);
  if (!scope.target) {
    return scope.error ? (
      <div role="alert">{scope.error}</div>
    ) : (
      <OrbLoader state="searching" size={64} />
    );
  }
  return (
    <SoulEditor
      key={`${scope.target.scopeToken}:${scope.revision}:${allowReset}`}
      target={scope.target}
      isCurrent={scope.isCurrent}
      allowReset={allowReset && scope.target.mode !== "remote"}
    />
  );
}

function SoulEditor({
  target,
  isCurrent,
  allowReset,
}: {
  target: ProfileEditorTarget;
  isCurrent: (target: ProfileEditorTarget) => boolean;
  allowReset: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const mounted = useRef(true);
  const loaded = useRef(false);
  const readGeneration = useRef(0);
  const editGeneration = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const live = useCallback(
    () => mounted.current && isCurrent(target),
    [isCurrent, target],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loaded.current = false;
      readGeneration.current += 1;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const markSaved = useCallback(() => {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => {
      if (live()) setSaved(false);
    }, 2000);
  }, [live]);

  useEffect(() => {
    const read = ++readGeneration.current;
    loaded.current = false;
    void window.hermesAPI
      .readSoul(target.profile, target)
      .then((text) => {
        if (!live() || read !== readGeneration.current) return;
        // Only user changes schedule saves; hydration never writes the loaded text.
        setContent(text);
        loaded.current = true;
        setLoading(false);
      })
      .catch((reason) => {
        if (!live() || read !== readGeneration.current) return;
        setLoadError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });
  }, [target, live]);

  function editSoul(text: string): void {
    if (!live() || !loaded.current) return;
    setContent(text);
    setSaved(false);
    const edit = ++editGeneration.current;
    const read = readGeneration.current;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      // Serialize writes so a slow older save cannot overwrite a newer draft.
      saveQueue.current = saveQueue.current.then(async () => {
        if (
          !live() ||
          !loaded.current ||
          read !== readGeneration.current ||
          edit !== editGeneration.current
        )
          return;
        try {
          const result = await window.hermesAPI.writeSoul(
            text,
            target.profile,
            target,
          );
          if (
            !live() ||
            read !== readGeneration.current ||
            edit !== editGeneration.current
          )
            return;
          if (!result) throw new Error(t("memory.saveFailed"));
          setSaveError("");
          markSaved();
        } catch (reason) {
          if (
            !live() ||
            read !== readGeneration.current ||
            edit !== editGeneration.current
          )
            return;
          setSaveError(
            reason instanceof Error ? reason.message : String(reason),
          );
        }
      });
    }, 500);
  }

  async function handleReset(): Promise<void> {
    if (!live() || !loaded.current || !allowReset) return;
    loaded.current = false;
    const read = ++readGeneration.current;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveError("");
    setLoading(true);
    try {
      // Wait for this target's admitted save before resetting its template.
      await saveQueue.current;
      if (!live() || read !== readGeneration.current) return;
      const text = await window.hermesAPI.resetSoul(target.profile, target);
      if (!live() || read !== readGeneration.current) return;
      setContent(text);
      setShowReset(false);
      markSaved();
    } catch (reason) {
      if (live() && read === readGeneration.current)
        setSaveError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (live() && read === readGeneration.current) {
        loaded.current = true;
        setLoading(false);
      }
    }
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
        onChange={(e) => editSoul(e.target.value)}
        disabled={!loaded.current || !!loadError}
        placeholder={t("soul.placeholder")}
        spellCheck={false}
      />

      <div className="soul-hint">{t("soul.hint")}</div>
    </div>
  );
}

export default Soul;
