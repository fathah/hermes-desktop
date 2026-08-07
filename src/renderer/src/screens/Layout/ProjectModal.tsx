import { useState } from "react";
import { AppModal, AppModalTitle } from "../../components/modal/AppModal";
import { FolderInput, Plus, X } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import type { DesktopProject } from "../../../../shared/projects";

export function ProjectModal({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (project: DesktopProject) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const close = (): void => {
    if (busy) return;
    setName("");
    setError("");
    onOpenChange(false);
  };

  const finish = (project: DesktopProject | null): void => {
    if (!project) return;
    onAdded(project);
    setName("");
    setError("");
    onOpenChange(false);
  };

  const create = async (): Promise<void> => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      finish(await window.hermesAPI.createProject(name.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const addExisting = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      finish(await window.hermesAPI.addExistingProject());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppModal
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      className="project-modal"
      labelledBy="project-modal-title"
    >
      <div className="project-modal-header">
        <AppModalTitle id="project-modal-title" className="project-modal-title">
          {t("navigation.projectModal.title")}
        </AppModalTitle>
        <button
          type="button"
          className="profile-modal-close"
          onClick={close}
          aria-label={t("common.close")}
          disabled={busy}
        >
          <X size={18} />
        </button>
      </div>
      <div className="project-modal-body">
        <label className="project-modal-field">
          <span>{t("navigation.projectModal.name")}</span>
          <input
            className="input"
            value={name}
            placeholder={t("navigation.projectModal.namePlaceholder")}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void create();
            }}
            autoFocus
          />
        </label>
        <button
          type="button"
          className="btn btn-primary project-modal-action"
          onClick={() => void create()}
          disabled={busy || !name.trim()}
        >
          <Plus size={15} />
          {t("navigation.projectModal.create")}
        </button>
        <div className="project-modal-divider">
          <span>{t("navigation.projectModal.or")}</span>
        </div>
        <button
          type="button"
          className="btn btn-secondary project-modal-action"
          onClick={() => void addExisting()}
          disabled={busy}
        >
          <FolderInput size={15} />
          {t("navigation.projectModal.addExisting")}
        </button>
        {error && <div className="project-modal-error">{error}</div>}
      </div>
    </AppModal>
  );
}
