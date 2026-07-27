import { useCallback, useState } from "react";
import { Container } from "lucide-react";
import { useI18n } from "../useI18n";
import type {
  SshHermesTargetInspection,
  SshDockerProvisionResult,
} from "../../../../shared/ssh-docker";

export interface SshDockerDraft {
  host: string;
  port: number;
  username: string;
  keyPath: string;
  remotePort: number;
}

interface Props {
  draft: SshDockerDraft;
  /** Selected container name (persisted with the SSH config by the parent). */
  value: string;
  onChange: (containerName: string) => void;
  /** Called after a successful remote setup so the parent can persist. */
  onProvisioned?: (result: SshDockerProvisionResult) => void;
}

/**
 * SSH target inspection + Docker setup (issue #432). Detects Hermes running
 * inside a Docker container on the SSH host, lets the user pick a container
 * when several run, and provisions the remote launcher hook + ~/.hermes
 * symlink that the rest of SSH mode already understands. Shared by Settings
 * and the first-run Welcome flow.
 */
export default function SshDockerTargetSection({
  draft,
  value,
  onChange,
  onProvisioned,
}: Props): React.JSX.Element {
  const { t } = useI18n();
  const [inspection, setInspection] =
    useState<SshHermesTargetInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionResult, setProvisionResult] =
    useState<SshDockerProvisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const draftReady = draft.host.trim().length > 0;

  const inspect = useCallback(async (): Promise<void> => {
    setInspecting(true);
    setError(null);
    setProvisionResult(null);
    try {
      const result = await window.hermesAPI.inspectSshHermesTarget(
        draft.host.trim(),
        draft.port,
        draft.username.trim(),
        draft.keyPath.trim(),
        draft.remotePort,
        value.trim(),
      );
      setInspection(result);
      if (result.error) setError(result.error);
      // Exactly one container and nothing selected yet — preselect it so the
      // common single-container host is one click away from setup.
      if (
        !value.trim() &&
        result.dockerContainers.length === 1 &&
        !result.hostInstallFound
      ) {
        onChange(result.dockerContainers[0].name);
      }
    } catch (err) {
      setInspection(null);
      setError(
        t("settings.sshDockerInspectFailed", {
          msg: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setInspecting(false);
    }
  }, [draft, value, onChange, t]);

  const provision = useCallback(async (): Promise<void> => {
    const container = value.trim();
    if (!container) return;
    setProvisioning(true);
    setError(null);
    setProvisionResult(null);
    try {
      const result = await window.hermesAPI.provisionSshDockerTarget(
        draft.host.trim(),
        draft.port,
        draft.username.trim(),
        draft.keyPath.trim(),
        draft.remotePort,
        container,
      );
      setProvisionResult(result);
      if (result.ok) {
        onProvisioned?.(result);
        // Refresh the status line so "configured" reflects the new remote state.
        void inspect();
      } else if (result.error) {
        setError(t("settings.sshDockerSetupFailed", { msg: result.error }));
      }
    } catch (err) {
      setError(
        t("settings.sshDockerSetupFailed", {
          msg: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setProvisioning(false);
    }
  }, [draft, value, onProvisioned, inspect, t]);

  const containers = inspection?.dockerContainers ?? [];
  const selected = value.trim();
  const selectedContainer = containers.find((c) => c.name === selected);
  const configuredForSelected =
    inspection?.launcherState === "docker" &&
    inspection.launcherContainerName === selected &&
    inspection.hermesHomeState === "symlink";
  // An EMPTY ~/.hermes directory is not a conflict — setup replaces it with
  // the data-volume symlink.
  const homeDirConflict =
    inspection !== null &&
    inspection.hermesHomeState === "directory" &&
    !inspection.hermesHomeEmpty &&
    !inspection.hostInstallFound &&
    containers.length > 0;

  return (
    <div className="settings-subsection">
      <div className="settings-subsection-head">
        <Container size={14} />
        <span>{t("settings.sshDockerTitle")}</span>
      </div>

      <div className="settings-field">
        <button
          className="btn btn-secondary"
          onClick={() => void inspect()}
          disabled={inspecting || provisioning || !draftReady}
        >
          {inspecting
            ? t("settings.sshDockerDetecting")
            : t("settings.sshDockerDetect")}
        </button>
        <div className="settings-field-hint">
          {t("settings.sshDockerDetectHint")}
        </div>
      </div>

      {inspection && (
        <>
          {inspection.hostInstallFound && (
            <div className="settings-transport-status settings-transport-status--ok">
              <span>{t("settings.sshDockerHostInstall")}</span>
            </div>
          )}

          {!inspection.hostInstallFound &&
            containers.length === 0 &&
            !error && (
              <div className="settings-transport-status settings-transport-status--warn">
                <span>
                  {inspection.dockerAvailable
                    ? t("settings.sshDockerNoContainers")
                    : t("settings.sshDockerNoDocker")}
                </span>
              </div>
            )}

          {containers.length > 0 && (
            <div className="settings-field">
              <label className="settings-field-label">
                {t("settings.sshDockerContainersFound")}
              </label>
              {containers.length > 1 && !selected && (
                <div className="settings-field-hint">
                  {t("settings.sshDockerSelectPrompt")}
                </div>
              )}
              <div className="ssh-docker-container-list">
                {containers.map((c) => (
                  <label key={c.name} className="ssh-docker-container-option">
                    <input
                      type="radio"
                      name="ssh-docker-container"
                      checked={selected === c.name}
                      onChange={() => {
                        setProvisionResult(null);
                        onChange(c.name);
                      }}
                    />
                    <span className="ssh-docker-container-info">
                      <span className="ssh-docker-container-name">
                        {c.name}
                      </span>
                      <span className="ssh-docker-container-meta">
                        {c.image}
                        {" · "}
                        {c.dataHome || t("settings.sshDockerNoDataMount")}
                        {c.matchesRemotePort &&
                          ` · ${t("settings.sshDockerPortMatch", {
                            port: String(draft.remotePort),
                          })}`}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {inspection.launcherState === "custom" && (
            <div className="settings-transport-status settings-transport-status--muted">
              <span>{t("settings.sshDockerCustomLauncher")}</span>
            </div>
          )}

          {configuredForSelected && (
            <div className="settings-transport-status settings-transport-status--ok">
              <span>
                {t("settings.sshDockerConfigured", { name: selected })}
              </span>
            </div>
          )}

          {inspection.launcherState === "docker" &&
            inspection.launcherContainerName !== null &&
            selected.length > 0 &&
            inspection.launcherContainerName !== selected && (
              <div className="settings-transport-status settings-transport-status--warn">
                <span>
                  {t("settings.sshDockerConfiguredOther", {
                    name: inspection.launcherContainerName,
                  })}
                </span>
              </div>
            )}

          {homeDirConflict && (
            <div className="settings-transport-status settings-transport-status--warn">
              <span>{t("settings.sshDockerHomeDirConflict")}</span>
            </div>
          )}

          {selectedContainer &&
            inspection.launcherState !== "custom" &&
            !configuredForSelected && (
              <div className="settings-field">
                <button
                  className="btn btn-primary"
                  onClick={() => void provision()}
                  disabled={
                    provisioning ||
                    inspecting ||
                    !selectedContainer.dataHome ||
                    homeDirConflict
                  }
                >
                  {provisioning
                    ? t("settings.sshDockerSettingUp")
                    : t("settings.sshDockerSetup")}
                </button>
                <div className="settings-field-hint">
                  {t("settings.sshDockerSetupHint", {
                    user: draft.username.trim() || "the SSH user",
                  })}
                </div>
              </div>
            )}
        </>
      )}

      {provisionResult?.ok && (
        <div className="settings-transport-status settings-transport-status--ok">
          <span>
            {t("settings.sshDockerSetupDone", {
              version: provisionResult.version.split("\n")[0],
            })}
          </span>
          {provisionResult.warnings.length > 0 && (
            <code>{provisionResult.warnings.join(" ")}</code>
          )}
        </div>
      )}

      {error && (
        <div className="settings-transport-status settings-transport-status--warn">
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
