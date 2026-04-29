import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash,
  Refresh,
  X,
  Play,
  Pause,
  Zap,
  Alert,
} from "../../assets/icons";
import { useI18n } from "../../components/useI18n";

const DELIVER_TARGETS = [
  { value: "local", label: "Local" },
  { value: "origin", label: "Origin" },
  { value: "telegram", label: "Telegram" },
  { value: "discord", label: "Discord" },
  { value: "slack", label: "Slack" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "signal", label: "Signal" },
  { value: "matrix", label: "Matrix" },
  { value: "mattermost", label: "Mattermost" },
  { value: "email", label: "Email" },
  { value: "webhook", label: "Webhook" },
  { value: "sms", label: "SMS" },
  { value: "homeassistant", label: "Home Assistant" },
  { value: "dingtalk", label: "DingTalk" },
  { value: "feishu", label: "Feishu" },
  { value: "wecom", label: "WeCom" },
];

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  state: "active" | "paused" | "completed";
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  repeat: { times: number | null; completed: number } | null;
  deliver: string[];
  skills: string[];
  script: string | null;
}

type FrequencyType = "minutes" | "hourly" | "daily" | "weekly" | "custom";

interface SchedulesProps {
  profile?: string;
}

function Schedules({ profile }: SchedulesProps): React.JSX.Element {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Create form state
  const [newName, setNewName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newDeliver, setNewDeliver] = useState("local");

  // Schedule builder state
  const [frequency, setFrequency] = useState<FrequencyType>("daily");
  const [minutesInterval, setMinutesInterval] = useState("30");
  const [hourlyInterval, setHourlyInterval] = useState("1");
  const [dailyTime, setDailyTime] = useState("09:00");
  const [weeklyDay, setWeeklyDay] = useState("1");
  const [weeklyTime, setWeeklyTime] = useState("09:00");
  const [customCron, setCustomCron] = useState("");

  const loadJobs = useCallback(async (): Promise<void> => {
    try {
      const list = await window.hermesAPI.listCronJobs(true, profile);
      setJobs(list);
    } catch {
      setError(t("schedules.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // Escape key to close modals
  useEffect(() => {
    if (!showCreate && !confirmDelete) return;
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        if (confirmDelete) setConfirmDelete(null);
        else if (showCreate) setShowCreate(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showCreate, confirmDelete]);

  function resetForm(): void {
    setNewName("");
    setNewPrompt("");
    setNewDeliver("local");
    setFrequency("daily");
    setMinutesInterval("30");
    setHourlyInterval("1");
    setDailyTime("09:00");
    setWeeklyDay("1");
    setWeeklyTime("09:00");
    setCustomCron("");
  }

  function closeCreateModal(): void {
    setShowCreate(false);
    resetForm();
  }

  function buildSchedule(): string {
    switch (frequency) {
      case "minutes":
        return `${minutesInterval}m`;
      case "hourly":
        return `${hourlyInterval}h`;
      case "daily": {
        const [h, m] = dailyTime.split(":");
        return `${m} ${h} * * *`;
      }
      case "weekly": {
        const [h, m] = weeklyTime.split(":");
        return `${m} ${h} * * ${weeklyDay}`;
      }
      case "custom":
        return customCron.trim();
    }
  }

  function isScheduleValid(): boolean {
    if (frequency === "custom") return customCron.trim().length > 0;
    if (frequency === "minutes") return parseInt(minutesInterval) > 0;
    if (frequency === "hourly") return parseInt(hourlyInterval) > 0;
    return true;
  }

  async function handleCreate(): Promise<void> {
    if (!isScheduleValid()) return;
    setActionInProgress("creating");
    setError("");
    try {
      const result = await window.hermesAPI.createCronJob(
        buildSchedule(),
        newPrompt.trim() || undefined,
        newName.trim() || undefined,
        newDeliver !== "local" ? newDeliver : undefined,
        profile,
      );
      if (result.success) {
        closeCreateModal();
        await loadJobs();
      } else {
        setError(result.error || "Failed to create job");
      }
    } catch {
      setError("Failed to create job");
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleRemove(jobId: string): Promise<void> {
    setActionInProgress(jobId);
    setError("");
    try {
      const result = await window.hermesAPI.removeCronJob(jobId, profile);
      setConfirmDelete(null);
      if (result.success) {
        await loadJobs();
      } else {
        setError(result.error || "Failed to remove job");
      }
    } catch {
      setError("Failed to remove job");
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleToggle(job: CronJob): Promise<void> {
    setActionInProgress(job.id);
    setError("");
    try {
      const result =
        job.state === "paused"
          ? await window.hermesAPI.resumeCronJob(job.id, profile)
          : await window.hermesAPI.pauseCronJob(job.id, profile);
      if (result.success) {
        await loadJobs();
      } else {
        setError(result.error || "Failed to update job");
      }
    } catch {
      setError("Failed to update job");
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleTrigger(jobId: string): Promise<void> {
    setActionInProgress(jobId);
    setError("");
    try {
      const result = await window.hermesAPI.triggerCronJob(jobId, profile);
      if (result.success) {
        await loadJobs();
      } else {
        setError(result.error || "Failed to trigger job");
      }
    } catch {
      setError("Failed to trigger job");
    } finally {
      setActionInProgress(null);
    }
  }

  function formatTime(iso: string | null): string {
    if (!iso) return "--";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  if (loading) {
    return (
      <div className="schedules-container">
        <div className="schedules-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="schedules-container">
      {/* Create Modal */}
      {showCreate && (
        <div className="skills-detail-overlay" onClick={closeCreateModal}>
          <div className="schedules-modal" onClick={(e) => e.stopPropagation()}>
            <div className="schedules-modal-header">
              <h3>{t("schedules.newTask")}</h3>
              <button className="btn-ghost" onClick={closeCreateModal}>
                <X size={18} />
              </button>
            </div>
            <div className="schedules-modal-body">
              <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("schedules.name")}
                </label>
                <input
                  className="input"
                  type="text"
                  placeholder={t("schedules.namePlaceholder")}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("schedules.frequency")}{" "}
                  <span className="schedules-required">*</span>
                </label>
                <div className="schedules-freq-pills">
                  {(
                    [
                      ["minutes", t("schedules.frequencyMinutes")],
                      ["hourly", t("schedules.frequencyHourly")],
                      ["daily", t("schedules.frequencyDaily")],
                      ["weekly", t("schedules.frequencyWeekly")],
                      ["custom", t("schedules.frequencyCustom")],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      className={`schedules-freq-pill ${frequency === val ? "active" : ""}`}
                      onClick={() => setFrequency(val)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {frequency === "minutes" && (
                <div className="schedules-field">
                  <label className="schedules-field-label">
                    {t("schedules.minutesInterval")}
                  </label>
                  <select
                    className="input"
                    value={minutesInterval}
                    onChange={(e) => setMinutesInterval(e.target.value)}
                  >
                    {["5", "10", "15", "30", "45"].map((v) => (
                      <option key={v} value={v}>
                        {t("schedules.everyNMinutes", { n: v })}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {frequency === "hourly" && (
                <div className="schedules-field">
                  <label className="schedules-field-label">
                    {t("schedules.hoursInterval")}
                  </label>
                  <select
                    className="input"
                    value={hourlyInterval}
                    onChange={(e) => setHourlyInterval(e.target.value)}
                  >
                    {["1", "2", "3", "4", "6", "8", "12"].map((v) => (
                      <option key={v} value={v}>
                        {t("schedules.everyNHours", { n: v })}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {frequency === "daily" && (
                <div className="schedules-field">
                  <label className="schedules-field-label">
                    {t("schedules.executionTime")}
                  </label>
                  <input
                    className="input"
                    type="time"
                    value={dailyTime}
                    onChange={(e) => setDailyTime(e.target.value)}
                  />
                </div>
              )}

              {frequency === "weekly" && (
                <>
                  <div className="schedules-field">
                    <label className="schedules-field-label">
                      {t("schedules.weekday")}
                    </label>
                    <select
                      className="input"
                      value={weeklyDay}
                      onChange={(e) => setWeeklyDay(e.target.value)}
                    >
                      {[
                        ["1", t("schedules.monday")],
                        ["2", t("schedules.tuesday")],
                        ["3", t("schedules.wednesday")],
                        ["4", t("schedules.thursday")],
                        ["5", t("schedules.friday")],
                        ["6", t("schedules.saturday")],
                        ["0", t("schedules.sunday")],
                      ].map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="schedules-field">
                    <label className="schedules-field-label">
                      {t("schedules.executionTime")}
                    </label>
                    <input
                      className="input"
                      type="time"
                      value={weeklyTime}
                      onChange={(e) => setWeeklyTime(e.target.value)}
                    />
                  </div>
                </>
              )}

              {frequency === "custom" && (
                <div className="schedules-field">
                  <label className="schedules-field-label">
                    {t("schedules.cronExpression")}
                  </label>
                  <input
                    className="input"
                    type="text"
                    placeholder={t("schedules.cronPlaceholder")}
                    value={customCron}
                    onChange={(e) => setCustomCron(e.target.value)}
                  />
                  <div className="schedules-field-hint">
                    {t("schedules.cronHint")}
                  </div>
                </div>
              )}
              <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("schedules.prompt")}
                </label>
                <textarea
                  className="input schedules-textarea"
                  placeholder={t("schedules.promptPlaceholder")}
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="schedules-field">
                <label className="schedules-field-label">
                  {t("schedules.deliverTo")}
                </label>
                <select
                  className="input"
                  value={newDeliver}
                  onChange={(e) => setNewDeliver(e.target.value)}
                >
                  {DELIVER_TARGETS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <div className="schedules-field-hint">
                  {t("schedules.deliverHint")}
                </div>
              </div>
            </div>
            <div className="schedules-modal-footer">
              <button className="btn btn-secondary" onClick={closeCreateModal}>
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={!isScheduleValid() || actionInProgress === "creating"}
              >
                {actionInProgress === "creating"
                  ? t("schedules.creating")
                  : t("schedules.create")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          className="skills-detail-overlay"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="schedules-modal schedules-modal-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="schedules-modal-header">
              <h3>{t("schedules.deleteTaskTitle")}</h3>
              <button
                className="btn-ghost"
                onClick={() => setConfirmDelete(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="schedules-modal-body">
              <p className="schedules-confirm-text">
                {t("schedules.deleteConfirmText")}
              </p>
            </div>
            <div className="schedules-modal-footer">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirmDelete(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => handleRemove(confirmDelete)}
                disabled={actionInProgress === confirmDelete}
              >
                {actionInProgress === confirmDelete
                  ? t("schedules.deleting")
                  : t("schedules.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="schedules-header">
        <div>
          <h2 className="schedules-title">{t("schedules.title")}</h2>
          <p className="schedules-subtitle">{t("schedules.subtitle")}</p>
        </div>
        <div className="schedules-header-actions">
          <button className="btn btn-secondary" onClick={loadJobs}>
            <Refresh size={14} />
            {t("schedules.refresh")}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={14} />
            {t("schedules.newTask")}
          </button>
        </div>
      </div>

      {error && (
        <div className="skills-error">
          {error}
          <button className="btn-ghost" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="schedules-empty">
          <p className="schedules-empty-text">{t("schedules.empty")}</p>
          <p className="schedules-empty-hint">{t("schedules.emptyHint")}</p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            onClick={() => setShowCreate(true)}
          >
            <Plus size={14} />
            {t("schedules.firstTask")}
          </button>
        </div>
      ) : (
        <div className="schedules-list">
          {jobs.map((job) => (
            <div key={job.id} className="schedules-card">
              <div className="schedules-card-top">
                <div className="schedules-card-info">
                  <div className="schedules-card-name">{job.name}</div>
                  <div className="schedules-card-schedule">{job.schedule}</div>
                </div>
                <div className="schedules-card-actions">
                  <span
                    className={`schedules-badge schedules-badge-${job.state}`}
                  >
                    {job.state === "active"
                      ? t("schedules.active")
                      : job.state === "paused"
                        ? t("schedules.paused")
                        : t("schedules.completed")}
                  </span>
                  {job.state !== "completed" && (
                    <button
                      className="btn-ghost schedules-action-btn"
                      data-tooltip={
                        job.state === "paused"
                          ? t("schedules.resume")
                          : t("schedules.pause")
                      }
                      onClick={() => handleToggle(job)}
                      disabled={actionInProgress === job.id}
                    >
                      {job.state === "paused" ? (
                        <Play size={14} />
                      ) : (
                        <Pause size={14} />
                      )}
                    </button>
                  )}
                  {job.state === "active" && (
                    <button
                      className="btn-ghost schedules-action-btn"
                      data-tooltip={t("schedules.triggerNow")}
                      onClick={() => handleTrigger(job.id)}
                      disabled={actionInProgress === job.id}
                    >
                      <Zap size={14} />
                    </button>
                  )}
                  <button
                    className="btn-ghost schedules-action-btn schedules-action-danger"
                    data-tooltip={t("schedules.delete")}
                    onClick={() => setConfirmDelete(job.id)}
                    disabled={actionInProgress === job.id}
                  >
                    <Trash size={14} />
                  </button>
                </div>
              </div>

              {job.prompt && (
                <div className="schedules-card-prompt">{job.prompt}</div>
              )}

              <div className="schedules-card-meta">
                <span>
                  {t("schedules.nextRun")}: {formatTime(job.next_run_at)}
                </span>
                {job.last_run_at && (
                  <span>
                    {t("schedules.lastRun")}: {formatTime(job.last_run_at)}
                    {job.last_status && job.last_status !== "ok" && (
                      <span className="schedules-card-error-icon">
                        <Alert size={12} />
                      </span>
                    )}
                  </span>
                )}
                {job.repeat && job.repeat.times && (
                  <span>
                    {t("schedules.runCount")}: {job.repeat.completed}/
                    {job.repeat.times}
                  </span>
                )}
                {job.deliver.length > 0 &&
                  !(job.deliver.length === 1 && job.deliver[0] === "local") && (
                    <span>
                      {t("schedules.deliveredTo")}: {job.deliver.join(", ")}
                    </span>
                  )}
                {job.skills.length > 0 && (
                  <span>
                    {t("schedules.skills")}: {job.skills.join(", ")}
                  </span>
                )}
              </div>

              {job.last_error && (
                <div className="schedules-card-error">{job.last_error}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Schedules;
