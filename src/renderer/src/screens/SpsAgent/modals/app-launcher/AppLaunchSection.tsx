import { useMemo, useState } from "react";
import {
  APP_LAUNCH_CADENCES,
  appLaunchCadenceLabel,
  type AppLaunchCadence,
  type AppLaunchSchedule,
  type AppLaunchTarget,
} from "../../../../../../shared/app-launcher";

interface AppLaunchSectionProps {
  targets: AppLaunchTarget[];
  schedules: AppLaunchSchedule[];
  onRefresh: () => Promise<void>;
  flash: (message: string, opts?: { tone?: "warn"; ms?: number }) => void;
}

function lastRunLabel(ms?: number): string {
  if (!ms) return "never run";
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function locatorLabel(target: AppLaunchTarget): string {
  if (target.locator.kind === "macos-app") {
    return target.locator.bundleId || target.locator.appPath;
  }
  return target.locator.url;
}

export function AppLaunchSection({
  targets,
  schedules,
  onRefresh,
  flash,
}: AppLaunchSectionProps) {
  const [urlLabel, setUrlLabel] = useState("");
  const [url, setUrl] = useState("");
  const [scheduleLabel, setScheduleLabel] = useState("");
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [cadence, setCadence] = useState<AppLaunchCadence>("daily");
  const [hour, setHour] = useState(9);
  const [runWhenClosed, setRunWhenClosed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const isMac = window.electron?.process.platform === "darwin";
  const enabledTargets = useMemo(
    () => targets.filter((target) => target.enabled),
    [targets],
  );

  const refreshSelection = () => {
    setSelectedTargetIds((ids) =>
      ids.filter((id) => enabledTargets.some((target) => target.id === id)),
    );
  };

  const runAction = async (
    id: string,
    action: () => Promise<{ ok: boolean; error?: string }>,
    success?: string,
  ) => {
    setBusyId(id);
    setError("");
    try {
      const res = await action();
      if (!res.ok) {
        setError(res.error || "Launch action failed.");
        flash(res.error || "Launch action failed.", { tone: "warn" });
        return;
      }
      await onRefresh();
      refreshSelection();
      if (success) flash(success);
    } finally {
      setBusyId(null);
    }
  };

  const onPickApp = async () => {
    await runAction(
      "pick-app",
      () => window.hermesAPI.appLaunchPickMacApplication(),
      "Application target added",
    );
  };

  const onAddUrl = async () => {
    if (!urlLabel.trim() || !url.trim()) return;
    await runAction(
      "add-url",
      () =>
        window.hermesAPI.appLaunchAddUrlTarget({
          label: urlLabel.trim(),
          url: url.trim(),
        }),
      "URL target added",
    );
    setUrlLabel("");
    setUrl("");
  };

  const onToggleSelected = (id: string, checked: boolean) => {
    setSelectedTargetIds((ids) =>
      checked ? [...new Set([...ids, id])] : ids.filter((item) => item !== id),
    );
  };

  const onCreateSchedule = async () => {
    const label = scheduleLabel.trim();
    if (!label || selectedTargetIds.length === 0) return;
    await runAction(
      "create-launch-schedule",
      () =>
        window.hermesAPI.appLaunchCreateSchedule({
          label,
          targetIds: selectedTargetIds,
          cadence,
          hour,
          runWhenClosed: isMac ? runWhenClosed : false,
        }),
      "Launch schedule created",
    );
    setScheduleLabel("");
    setSelectedTargetIds([]);
    setRunWhenClosed(false);
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div className="c-name" style={{ marginBottom: 6 }}>
        Launches
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(120px, 0.45fr) minmax(180px, 1fr) auto",
          gap: 8,
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <input
          className="cover-btn"
          value={urlLabel}
          onChange={(event) => setUrlLabel(event.target.value)}
          placeholder="URL label"
          style={{ textAlign: "left" }}
        />
        <input
          className="cover-btn"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com"
          style={{ textAlign: "left" }}
        />
        <button
          className="cover-btn"
          disabled={busyId === "add-url" || !urlLabel.trim() || !url.trim()}
          onClick={() => void onAddUrl()}
        >
          Add URL
        </button>
      </div>

      {isMac && (
        <button
          className="cover-btn"
          disabled={busyId === "pick-app"}
          onClick={() => void onPickApp()}
          style={{ marginBottom: 8 }}
        >
          Add macOS app
        </button>
      )}

      {error && (
        <small style={{ color: "var(--rd, #d66)", display: "block" }}>
          {error}
        </small>
      )}

      <div className="scroll" style={{ maxHeight: "24vh" }}>
        {targets.length === 0 && (
          <div className="cmts-empty" style={{ padding: "10px 0" }}>
            No launch targets yet.
          </div>
        )}
        {targets.map((target) => (
          <div
            key={target.id}
            className="lst-row"
            style={{
              alignItems: "flex-start",
              gap: 8,
              height: "auto",
              padding: "8px 6px",
            }}
          >
            <label style={{ paddingTop: 2 }}>
              <input
                type="checkbox"
                checked={selectedTargetIds.includes(target.id)}
                onChange={(event) =>
                  onToggleSelected(target.id, event.target.checked)
                }
              />
            </label>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="c-name">{target.label}</div>
              <small style={{ color: "var(--tx-3)", display: "block" }}>
                {target.locator.kind === "macos-app" ? "macOS app" : "URL"} ·{" "}
                {locatorLabel(target)} · {lastRunLabel(target.lastRunAt)}
                {target.lastStatus && ` · ${target.lastStatus}`}
              </small>
              {target.lastError && (
                <small style={{ color: "var(--rd, #d66)", display: "block" }}>
                  {target.lastError}
                </small>
              )}
            </div>
            <button
              className="cover-btn"
              disabled={busyId === target.id}
              onClick={() =>
                void runAction(
                  target.id,
                  () => window.hermesAPI.appLaunchRunTarget(target.id),
                  `Launched "${target.label}"`,
                )
              }
            >
              Run now
            </button>
            <button
              className="cover-btn"
              disabled={busyId === target.id}
              onClick={() =>
                void runAction(target.id, () =>
                  window.hermesAPI.appLaunchRemoveTarget(target.id),
                )
              }
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {enabledTargets.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(160px, 1fr) auto auto auto",
            gap: 8,
            alignItems: "center",
            marginTop: 8,
          }}
        >
          <input
            className="cover-btn"
            value={scheduleLabel}
            onChange={(event) => setScheduleLabel(event.target.value)}
            placeholder="Launch schedule label"
            style={{ textAlign: "left" }}
          />
          <select
            className="cover-btn"
            value={cadence}
            onChange={(event) =>
              setCadence(event.target.value as AppLaunchCadence)
            }
          >
            {APP_LAUNCH_CADENCES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            className="cover-btn"
            value={hour}
            onChange={(event) => setHour(Number(event.target.value))}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <button
            className="cover-btn"
            disabled={
              busyId === "create-launch-schedule" ||
              !scheduleLabel.trim() ||
              selectedTargetIds.length === 0
            }
            onClick={() => void onCreateSchedule()}
          >
            Create schedule
          </button>
          {isMac && (
            <label
              style={{
                gridColumn: "1 / -1",
                display: "flex",
                gap: 6,
                alignItems: "center",
                color: "var(--tx-3)",
                fontSize: 12,
              }}
            >
              <input
                type="checkbox"
                checked={runWhenClosed}
                onChange={(event) => setRunWhenClosed(event.target.checked)}
              />
              Run while app is closed
            </label>
          )}
        </div>
      )}

      {schedules.length > 0 && (
        <div className="scroll" style={{ maxHeight: "24vh", marginTop: 8 }}>
          {schedules.map((schedule) => (
            <div
              key={schedule.id}
              className="lst-row"
              style={{
                alignItems: "flex-start",
                gap: 8,
                height: "auto",
                padding: "8px 6px",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="c-name">{schedule.label}</div>
                <small style={{ color: "var(--tx-3)", display: "block" }}>
                  {appLaunchCadenceLabel(schedule.cadence, schedule.hour)} ·{" "}
                  {lastRunLabel(schedule.lastRunAt)}
                  {schedule.runWhenClosed ? " · app-closed" : " · app-open"}
                  {!schedule.enabled ? " · paused" : ""}
                  {schedule.lastStatus && ` · ${schedule.lastStatus}`}
                </small>
                {schedule.lastError && (
                  <small style={{ color: "var(--rd, #d66)", display: "block" }}>
                    {schedule.lastError}
                  </small>
                )}
              </div>
              {isMac && (
                <label
                  style={{
                    display: "flex",
                    gap: 4,
                    alignItems: "center",
                    color: "var(--tx-3)",
                    fontSize: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={schedule.runWhenClosed}
                    onChange={(event) =>
                      void runAction(schedule.id, () =>
                        window.hermesAPI.appLaunchUpdateSchedule(schedule.id, {
                          runWhenClosed: event.target.checked,
                        }),
                      )
                    }
                  />
                  closed
                </label>
              )}
              <button
                className="cover-btn"
                disabled={busyId === schedule.id}
                onClick={() =>
                  void runAction(
                    schedule.id,
                    () => window.hermesAPI.appLaunchRunScheduleNow(schedule.id),
                    `Ran "${schedule.label}"`,
                  )
                }
              >
                Run now
              </button>
              <button
                className="cover-btn"
                disabled={busyId === schedule.id}
                onClick={() =>
                  void runAction(schedule.id, () =>
                    window.hermesAPI.appLaunchUpdateSchedule(schedule.id, {
                      enabled: !schedule.enabled,
                    }),
                  )
                }
              >
                {schedule.enabled ? "Pause" : "Resume"}
              </button>
              <button
                className="cover-btn"
                disabled={busyId === schedule.id}
                onClick={() =>
                  void runAction(schedule.id, () =>
                    window.hermesAPI.appLaunchDeleteSchedule(schedule.id),
                  )
                }
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
