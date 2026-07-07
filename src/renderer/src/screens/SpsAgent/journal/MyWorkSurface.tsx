import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import { JournalCalendar } from "./JournalCalendar";
import { DayTimeline } from "./DayTimeline";
import { useJournalEntries, groupByDate } from "./useJournalEntries";
import {
  addMonths,
  isoFromDate,
  monthLabel,
  parseISO,
} from "../lib/journalDates";
import {
  QuickActions,
  Glance,
  PinnedNotes,
  AgentStatus,
} from "../cockpit/CockpitSurface";
import { ActiveWorkSurface } from "../activeWork/ActiveWorkSurface";
import { ReviewQueueSurface } from "../review/ReviewQueueSurface";
import { openSettings } from "../../../lib/openSettings";
import { OperatorReadinessPanel } from "../../../components/OperatorReadinessPanel";
import { cadenceLabel } from "../../../../../shared/scheduledResearch";
import { appLaunchCadenceLabel } from "../../../../../shared/app-launcher";
import type { CronJob } from "../../../../../shared/cronjobs";
import type { AppLaunchSchedule } from "../../../../../shared/app-launcher";
import type { OperatorReadinessAction } from "../../../../../shared/operator-readiness";

type WorkTab = "tasks" | "delegated" | "scheduled" | "review";
type Schedule = Awaited<ReturnType<typeof window.hermesAPI.srList>>[number];

function fmtTime(ms: number): string {
  if (!ms) return "never";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtCronTime(iso: string | null): string {
  if (!iso) return "not scheduled";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function WorkScheduledPanel(): React.JSX.Element {
  const setScheduledOpen = useStore((s) => s.setScheduledOpen);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [launchSchedules, setLaunchSchedules] = useState<AppLaunchSchedule[]>(
    [],
  );
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  async function refresh(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const [scheduleRows, launchRows, cronRows] = await Promise.all([
        window.hermesAPI.srList(),
        window.hermesAPI.appLaunchListSchedules().catch(() => []),
        window.hermesAPI.listCronJobs(true).catch(() => [] as CronJob[]),
      ]);
      setSchedules(scheduleRows || []);
      setLaunchSchedules(launchRows || []);
      setCronJobs(cronRows || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load scheduled items.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function toggleSchedule(rule: Schedule): Promise<void> {
    setBusyId(rule.id);
    try {
      await window.hermesAPI.srUpdate(rule.id, { enabled: !rule.enabled });
      await refresh();
    } finally {
      setBusyId("");
    }
  }

  async function toggleCron(job: CronJob): Promise<void> {
    setBusyId(job.id);
    try {
      if (job.state === "paused") await window.hermesAPI.resumeCronJob(job.id);
      else await window.hermesAPI.pauseCronJob(job.id);
      await refresh();
    } finally {
      setBusyId("");
    }
  }

  async function toggleLaunchSchedule(rule: AppLaunchSchedule): Promise<void> {
    setBusyId(rule.id);
    try {
      await window.hermesAPI.appLaunchUpdateSchedule(rule.id, {
        enabled: !rule.enabled,
      });
      await refresh();
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="work-rule-panel">
      <div className="work-rule-head">
        <div>
          <h2>Scheduled</h2>
          <p>
            Topic monitors and agent jobs stay visible here. New output goes to
            review before it changes your workspace.
          </p>
        </div>
        <button className="cover-btn" onClick={() => setScheduledOpen(true)}>
          <Icon name="clock" size={15} /> Manage scheduled items
        </button>
      </div>

      {error && <div className="active-work-error">{error}</div>}
      {loading ? (
        <div className="ck-empty">Loading scheduled items...</div>
      ) : schedules.length === 0 &&
        launchSchedules.length === 0 &&
        cronJobs.length === 0 ? (
        <div className="ck-empty">No scheduled items are active.</div>
      ) : (
        <div className="work-rule-list">
          {schedules.map((rule) => (
            <article className="work-rule-row" key={rule.id}>
              <div className="work-rule-main">
                <strong>
                  {rule.kind === "digest" ? "External sessions" : rule.topic}
                </strong>
                <span>
                  {rule.kind === "digest" ? "External digest" : "Topic monitor"}{" "}
                  · {cadenceLabel(rule.cadence, rule.hour)} · last{" "}
                  {fmtTime(rule.lastRunAt)}
                </span>
                <small>
                  Next run follows cadence while app scheduling is available ·{" "}
                  {rule.enabled ? "enabled" : "paused"} · review-first
                </small>
              </div>
              <button
                className="cover-btn"
                disabled={busyId === rule.id}
                onClick={() => void toggleSchedule(rule)}
              >
                {rule.enabled ? "Pause" : "Resume"}
              </button>
            </article>
          ))}
          {launchSchedules.map((rule) => (
            <article className="work-rule-row" key={rule.id}>
              <div className="work-rule-main">
                <strong>{rule.label}</strong>
                <span>
                  Launch recipe ·{" "}
                  {appLaunchCadenceLabel(rule.cadence, rule.hour)} · last{" "}
                  {fmtTime(rule.lastRunAt)}
                </span>
                <small>
                  {rule.runWhenClosed ? "app-open and LaunchAgent" : "app-open"}{" "}
                  · {rule.enabled ? "enabled" : "paused"}
                  {rule.lastStatus ? ` · ${rule.lastStatus}` : ""}
                </small>
                {rule.lastError && <small>{rule.lastError}</small>}
              </div>
              <button
                className="cover-btn"
                disabled={busyId === rule.id}
                onClick={() => void toggleLaunchSchedule(rule)}
              >
                {rule.enabled ? "Pause" : "Resume"}
              </button>
            </article>
          ))}
          {cronJobs.map((job) => (
            <article className="work-rule-row" key={job.id}>
              <div className="work-rule-main">
                <strong>{job.name}</strong>
                <span>
                  Agent job · last {fmtCronTime(job.last_run_at)} · next{" "}
                  {fmtCronTime(job.next_run_at)}
                </span>
                <small>{job.state}</small>
              </div>
              {job.state !== "completed" && (
                <button
                  className="cover-btn"
                  disabled={busyId === job.id}
                  onClick={() => void toggleCron(job)}
                >
                  {job.state === "paused" ? "Resume" : "Pause"}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function MyWorkSurface() {
  const selected = useStore((s) => s.journalDate);
  const setJournalDate = useStore((s) => s.setJournalDate);
  const createJournalEntry = useStore((s) => s.createJournalEntry);
  const setSurface = useStore((s) => s.setSurface);
  const setScheduledOpen = useStore((s) => s.setScheduledOpen);
  const [tab, setTab] = useState<WorkTab>("tasks");

  const [monthAnchor, setMonthAnchor] = useState(selected);

  const entries = useJournalEntries();
  const byDate = groupByDate(entries);
  const today = isoFromDate(new Date());

  const parts = parseISO(monthAnchor) ?? parseISO(today)!;
  const goToday = (): void => {
    setMonthAnchor(today);
    setJournalDate(today);
  };
  const handleReadinessAction = useCallback(
    (action: OperatorReadinessAction): void => {
      const target = action.target;
      if (target.kind === "settings") {
        openSettings(target.view);
      } else if (target.kind === "surface") {
        setSurface(target.surface);
      } else {
        setScheduledOpen(true);
      }
    },
    [setScheduledOpen, setSurface],
  );

  return (
    <div className="doc-scroll scroll">
      <div className="work-shell">
        <header className="work-shell-head">
          <div>
            <h1>Work</h1>
            <p>Tasks, delegated goals, scheduled items, and review queue.</p>
          </div>
        </header>
        <div className="work-tabs" role="tablist" aria-label="Work sections">
          {[
            ["tasks", "Tasks"],
            ["delegated", "Delegated"],
            ["scheduled", "Scheduled"],
            ["review", "Review"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`work-tab ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id as WorkTab)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "tasks" && (
          <div className="work-unified-container">
            <div className="work-unified-left">
              <div className="jr">
                <div className="jr-head">
                  <span className="jr-title">
                    {monthLabel(parts.year, parts.month)}
                  </span>
                  <span className="jr-spacer" />
                  <button
                    className="jr-icon-btn"
                    title="Previous month"
                    onClick={() => setMonthAnchor(addMonths(monthAnchor, -1))}
                  >
                    <Icon
                      name="chevR"
                      size={15}
                      style={{ transform: "rotate(180deg)" }}
                    />
                  </button>
                  <button className="jr-btn" onClick={goToday}>
                    Today
                  </button>
                  <button
                    className="jr-icon-btn"
                    title="Next month"
                    onClick={() => setMonthAnchor(addMonths(monthAnchor, 1))}
                  >
                    <Icon name="chevR" size={15} />
                  </button>
                  <button
                    className="jr-btn primary"
                    onClick={() => createJournalEntry(selected)}
                  >
                    <Icon name="plus" size={14} /> New entry
                  </button>
                </div>

                <JournalCalendar
                  monthAnchor={monthAnchor}
                  selected={selected}
                  today={today}
                  byDate={byDate}
                  onSelectDay={setJournalDate}
                />

                <DayTimeline
                  date={selected}
                  byDate={byDate}
                  onNewEntry={() => createJournalEntry(selected)}
                />
              </div>
            </div>

            <div className="work-unified-right">
              <div className="work-right-section-title">
                <Icon name="checkbox" size={16} />
                <span>Operator Readiness</span>
              </div>
              <div className="work-widget-card">
                <OperatorReadinessPanel onAction={handleReadinessAction} />
              </div>

              <div className="work-right-section-title">
                <Icon name="board" size={16} />
                <span>At a Glance</span>
              </div>
              <div className="work-widget-card">
                <Glance />
              </div>

              <div className="work-right-section-title">
                <Icon name="wand" size={16} />
                <span>Quick Actions</span>
              </div>
              <div className="work-widget-card">
                <QuickActions />
              </div>

              <div className="work-right-section-title">
                <Icon name="code" size={16} />
                <span>Assistant Status</span>
              </div>
              <div className="work-widget-card">
                <AgentStatus />
              </div>

              <div className="work-right-section-title">
                <Icon name="comment" size={16} />
                <span>Pinned Notes</span>
              </div>
              <div className="work-widget-card">
                <PinnedNotes />
              </div>
            </div>
          </div>
        )}
        {tab === "delegated" && <ActiveWorkSurface />}
        {tab === "scheduled" && <WorkScheduledPanel />}
        {tab === "review" && <ReviewQueueSurface profile="default" />}
      </div>
    </div>
  );
}
