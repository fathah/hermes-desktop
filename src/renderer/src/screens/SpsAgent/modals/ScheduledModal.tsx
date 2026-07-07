// ScheduledModal.tsx — manage Scheduled Research and review the updates it
// produces. Two sections: (1) Schedules — create/pause/run-now/delete a
// recurring "research topic X, keep its page current" job; (2) Pending updates —
// the smart-merges scheduled runs proposed, applied through the SAME
// commitChangeset(op:"update") path as manual research/ingest (so the living
// page + its "## Updates" changelog update consistently in both storage modes).
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import { SpsModal } from "./SpsModal";
import { commitChangeset } from "../inbox/ingestApply";
import { AppLaunchSection } from "./app-launcher/AppLaunchSection";
import {
  CADENCES,
  IMPORTANCE_THRESHOLDS,
  SOURCE_INTENTS,
  cadenceLabel,
  normalizeMonitorSourcePlan,
  type Cadence,
  type ImportanceThreshold,
  type MonitorDiscoveryResult,
  type MonitorSourceEntry,
  type MonitorSourceStatus,
  type SourceIntent,
  type TelegramDeliveryStatus,
} from "../../../../../shared/scheduledResearch";
import type { CronJob } from "../../../../../shared/cronjobs";
import type {
  AppLaunchSchedule,
  AppLaunchTarget,
} from "../../../../../shared/app-launcher";

type Schedule = Awaited<ReturnType<typeof window.hermesAPI.srList>>[number];
type Pending = Awaited<
  ReturnType<typeof window.hermesAPI.srListPending>
>[number];
type SkipInfo = { skipCount: number; lastSkipAt: number; lastReason: string };

const SOURCE_INTENT_LABELS: Record<SourceIntent, string> = {
  all: "All",
  web: "Web",
  rss: "RSS",
  substack: "Substack",
  social: "Social",
};

const IMPORTANCE_LABELS: Record<ImportanceThreshold, string> = {
  digest: "Digest",
  noteworthy: "Noteworthy",
  breaking: "Breaking",
};

const TELEGRAM_SETUP_URL =
  "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram";

const TELEGRAM_UNAVAILABLE_STATUS: TelegramDeliveryStatus = {
  available: false,
  reason: "missing-channel",
  message: "No configured Telegram channel was found.",
};

const SOURCE_STATUS_LABELS: Record<MonitorSourceStatus, string> = {
  suggested: "Suggested",
  approved: "Approved",
  ignored: "Ignored",
  unavailable: "Unavailable",
};

function sourceTarget(source: MonitorSourceEntry): string {
  return source.url ?? source.query ?? "";
}

function groupedSources(
  sources: MonitorSourceEntry[],
): Array<[MonitorSourceEntry["kind"], MonitorSourceEntry[]]> {
  const order: MonitorSourceEntry["kind"][] = [
    "rss",
    "substack",
    "web",
    "social",
  ];
  return order
    .map(
      (kind) =>
        [kind, sources.filter((s) => s.kind === kind)] as [
          MonitorSourceEntry["kind"],
          MonitorSourceEntry[],
        ],
    )
    .filter(([, list]) => list.length > 0);
}

export function ScheduledModal() {
  const setScheduledOpen = useStore((s) => s.setScheduledOpen);
  const scheduledDraftTopic = useStore((s) => s.scheduledDraftTopic);
  const setScheduledDraftTopic = useStore((s) => s.setScheduledDraftTopic);
  const ingestCommitPage = useStore((s) => s.ingestCommitPage);
  const selectPage = useStore((s) => s.selectPage);
  const flash = useStore((s) => s.flash);
  const onClose = () => setScheduledOpen(false);

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  // Agent-created cron jobs (ported from the deleted admin Schedules screen) —
  // oversight only: see every agent job + stop/run it. Creation of new raw
  // cron jobs stays with the agent/CLI; research/digest scheduling is above.
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [launchTargets, setLaunchTargets] = useState<AppLaunchTarget[]>([]);
  const [launchSchedules, setLaunchSchedules] = useState<AppLaunchSchedule[]>(
    [],
  );
  const [skips, setSkips] = useState<Record<string, SkipInfo>>({});
  const [topic, setTopic] = useState("");
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [hour, setHour] = useState(8);
  const [sourceIntent, setSourceIntent] = useState<SourceIntent>("all");
  const [importanceThreshold, setImportanceThreshold] =
    useState<ImportanceThreshold>("noteworthy");
  const [telegramPush, setTelegramPush] = useState(false);
  const [telegramStatus, setTelegramStatus] =
    useState<TelegramDeliveryStatus | null>(null);
  const [sourcePlan, setSourcePlan] = useState<MonitorSourceEntry[]>([]);
  const [discovery, setDiscovery] = useState<MonitorDiscoveryResult | null>(
    null,
  );
  const [discovering, setDiscovering] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const topicRef = useRef<HTMLInputElement>(null);

  // Scheduled items are review-first: generated changes stay pending until the
  // user applies them from the Work/Review surface.
  const autoApplyPending = async (
    _list: Pending[],
    _scheds: Schedule[],
  ): Promise<boolean> => {
    return false;
  };

  const refresh = async () => {
    const [s, p, cron, sk, telegram, launchTargetsList, launchSchedulesList] =
      await Promise.all([
        window.hermesAPI.srList(),
        window.hermesAPI.srListPending(),
        window.hermesAPI.listCronJobs(true).catch(() => [] as CronJob[]),
        window.hermesAPI
          .getSchedulerSkips()
          .catch(() => ({}) as Record<string, SkipInfo>),
        window.hermesAPI
          .srTelegramStatus()
          .catch(() => TELEGRAM_UNAVAILABLE_STATUS),
        window.hermesAPI.appLaunchListTargets().catch(() => []),
        window.hermesAPI.appLaunchListSchedules().catch(() => []),
      ]);
    setCronJobs(cron || []);
    setSkips(sk || {});
    setTelegramStatus(telegram);
    setLaunchTargets(launchTargetsList || []);
    setLaunchSchedules(launchSchedulesList || []);
    const applied = await autoApplyPending(p || [], s || []);
    if (applied) {
      const p2 = await window.hermesAPI.srListPending();
      setSchedules(s || []);
      setPending(p2 || []);
    } else {
      setSchedules(s || []);
      setPending(p || []);
    }
  };

  useEffect(() => {
    topicRef.current?.focus();
    void refresh();
    // A scheduled tick / Run now that produces a change pushes this event.
    const off = window.hermesAPI.onScheduledResearchUpdate(
      () => void refresh(),
    );
    return () => {
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!scheduledDraftTopic) return;
    setTopic(scheduledDraftTopic);
    setScheduledDraftTopic(null);
  }, [scheduledDraftTopic, setScheduledDraftTopic]);

  useEffect(() => {
    if (telegramStatus && !telegramStatus.available && telegramPush) {
      setTelegramPush(false);
    }
  }, [telegramPush, telegramStatus]);

  const onDiscoverSources = async () => {
    const t = topic.trim();
    if (!t) return;
    setDiscovering(true);
    setError("");
    try {
      const result = await window.hermesAPI.srDiscoverSources({
        topic: t,
        sourceIntent,
        existingPlan: sourcePlan,
      });
      setDiscovery(result);
      setSourcePlan(result.candidates);
    } finally {
      setDiscovering(false);
    }
  };

  const setLocalSourceStatus = (id: string, status: MonitorSourceStatus) => {
    setSourcePlan((plan) =>
      normalizeMonitorSourcePlan(
        plan.map((source) =>
          source.id === id ? { ...source, status } : source,
        ),
      ),
    );
  };

  const editLocalSource = (id: string, value: string) => {
    setSourcePlan((plan) =>
      plan.map((source) => {
        if (source.id !== id) return source;
        if (source.url) return { ...source, url: value };
        return { ...source, query: value };
      }),
    );
  };

  const updateScheduleSourceStatus = async (
    schedule: Schedule,
    sourceId: string,
    status: MonitorSourceStatus,
  ) => {
    const next = normalizeMonitorSourcePlan(
      (schedule.sourcePlan ?? []).map((source) =>
        source.id === sourceId ? { ...source, status } : source,
      ),
    );
    await window.hermesAPI.srUpdateSourcePlan(schedule.id, next);
    await refresh();
  };

  const onCreate = async () => {
    const t = topic.trim();
    if (!t) return;
    const canUseTelegram = telegramStatus?.available === true;
    setCreating(true);
    setError("");
    try {
      const res = await window.hermesAPI.srCreate({
        topic: t,
        cadence,
        hour,
        sourceIntent,
        sourcePlan,
        importanceThreshold,
        telegramPush: canUseTelegram ? telegramPush : false,
        telegramMode: "summary-only",
        autoApply: false,
      });
      if (!res.ok) {
        setError(res.error || "Couldn't create the schedule.");
        return;
      }
      setTopic("");
      setSourcePlan([]);
      setDiscovery(null);
      await refresh();
    } finally {
      setCreating(false);
    }
  };

  const telegramAvailable = telegramStatus?.available === true;
  const telegramUnavailable = telegramStatus !== null && !telegramAvailable;

  const onRunNow = async (id: string) => {
    setBusyId(id);
    try {
      const res = await window.hermesAPI.srRunNow(id);
      await refresh();
      if (res.outcome === "changed")
        flash("Found an update — see Pending below");
      // Surface the run's own summary (e.g. a digest's "No external sessions
      // this period") instead of the research-only generic line.
      else if (res.outcome === "no-change")
        flash(res.summary || "No new info this run");
      else if (res.outcome === "no-sources")
        flash("No web sources found", { tone: "warn" });
      else flash(res.error || "Run failed", { tone: "warn" });
    } finally {
      setBusyId(null);
    }
  };

  const onToggle = async (s: Schedule) => {
    await window.hermesAPI.srUpdate(s.id, { enabled: !s.enabled });
    await refresh();
  };

  const onDelete = async (id: string) => {
    await window.hermesAPI.srDelete(id);
    await refresh();
  };

  const onApply = async (p: Pending) => {
    setBusyId(p.id);
    try {
      await commitChangeset(p.changeset, ingestCommitPage);
      // Log the wiki evolution under the originating schedule's kind so a digest
      // commit isn't mislabelled "research".
      const sched = schedules.find((s) => s.id === p.scheduleId);
      const op = sched?.kind === "digest" ? "digest" : "research";
      await window.hermesAPI.spsAppendWikiLog?.(op, p.summary);
      await window.hermesAPI.srRemovePending(p.id);
      await refresh();
      selectPage(p.pageId);
      flash(`Applied "${p.topic}" to your Knowledge Base`);
    } finally {
      setBusyId(null);
    }
  };

  const onDismiss = async (p: Pending) => {
    await window.hermesAPI.srRemovePending(p.id);
    await refresh();
  };

  const fmtLast = (ms: number): string => {
    if (!ms) return "never run";
    const days = Math.floor((Date.now() - ms) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    return `${days}d ago`;
  };

  // ── agent cron-job oversight ──
  const onCronToggle = async (job: CronJob) => {
    setBusyId(job.id);
    try {
      if (job.state === "paused") await window.hermesAPI.resumeCronJob(job.id);
      else await window.hermesAPI.pauseCronJob(job.id);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const onCronTrigger = async (job: CronJob) => {
    setBusyId(job.id);
    try {
      await window.hermesAPI.triggerCronJob(job.id);
      await refresh();
      flash(`Triggered "${job.name}"`);
    } finally {
      setBusyId(null);
    }
  };

  const onCronDelete = async (job: CronJob) => {
    setBusyId(job.id);
    try {
      await window.hermesAPI.removeCronJob(job.id);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const fmtCronTime = (iso: string | null): string => {
    if (!iso) return "--";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <SpsModal title="Scheduled" onClose={onClose} width={760}>
      <div className="modal-body">
        {/* ── create ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 1fr) auto auto",
            gap: 8,
            marginBottom: 6,
            alignItems: "center",
          }}
        >
          <div className="pal-input" style={{ margin: 0 }}>
            <Icon name="search" size={16} style={{ color: "var(--tx-3)" }} />
            <input
              ref={topicRef}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onCreate();
              }}
              placeholder="Monitor this topic…"
            />
          </div>
          <select
            className="cover-btn"
            value={cadence}
            onChange={(e) => setCadence(e.target.value as Cadence)}
          >
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            className="cover-btn"
            onClick={() => void onCreate()}
            disabled={creating || !topic.trim()}
          >
            {creating ? "Adding…" : "Create"}
          </button>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 8,
            fontSize: 12,
            color: "var(--tx-3)",
            alignItems: "center",
          }}
        >
          <select
            className="cover-btn"
            value={sourceIntent}
            onChange={(e) => setSourceIntent(e.target.value as SourceIntent)}
            title="Source focus"
          >
            {SOURCE_INTENTS.map((intent) => (
              <option key={intent} value={intent}>
                {SOURCE_INTENT_LABELS[intent]}
              </option>
            ))}
          </select>
          <select
            className="cover-btn"
            value={importanceThreshold}
            onChange={(e) =>
              setImportanceThreshold(e.target.value as ImportanceThreshold)
            }
            title="Importance threshold"
          >
            {IMPORTANCE_THRESHOLDS.map((threshold) => (
              <option key={threshold} value={threshold}>
                {IMPORTANCE_LABELS[threshold]}
              </option>
            ))}
          </select>
          <select
            className="cover-btn"
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
            title="Hour of day to run after"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <button
            className="cover-btn"
            onClick={() => void onDiscoverSources()}
            disabled={discovering || !topic.trim()}
          >
            {discovering ? "Discovering…" : "Discover sources"}
          </button>
          <label
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              opacity: telegramAvailable ? 1 : 0.65,
            }}
          >
            <input
              type="checkbox"
              checked={telegramPush}
              disabled={!telegramAvailable}
              aria-describedby={
                telegramAvailable ? undefined : "telegram-summary-status"
              }
              onChange={(e) => {
                if (!telegramAvailable) return;
                setTelegramPush(e.target.checked);
              }}
            />
            Telegram summary
          </label>
          {!telegramAvailable && (
            <span
              id="telegram-summary-status"
              style={{
                display: "inline-flex",
                gap: 6,
                alignItems: "center",
                flexWrap: "wrap",
                color: "var(--tx-3)",
              }}
            >
              {telegramUnavailable
                ? "Telegram is not configured. Set it up before enabling push summaries."
                : "Checking Telegram setup…"}
              {telegramUnavailable && (
                <button
                  type="button"
                  className="cover-btn"
                  onClick={() =>
                    void window.hermesAPI.openExternal(TELEGRAM_SETUP_URL)
                  }
                >
                  Set up Telegram
                </button>
              )}
            </span>
          )}
          <span className="pal-chip" style={{ pointerEvents: "none" }}>
            Review-first
          </span>
        </div>
        {error && (
          <small
            style={{
              color: "var(--rd, #d66)",
              display: "block",
              marginBottom: 8,
            }}
          >
            {error}
          </small>
        )}
        {sourcePlan.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="c-name" style={{ marginBottom: 6 }}>
              Source review
            </div>
            {discovery?.warnings.map((warning) => (
              <small
                key={warning}
                style={{ color: "var(--tx-3)", display: "block" }}
              >
                {warning}
              </small>
            ))}
            <div className="scroll" style={{ maxHeight: "22vh" }}>
              {groupedSources(sourcePlan).map(([kind, list]) => (
                <div key={kind} style={{ marginBottom: 6 }}>
                  <small style={{ color: "var(--tx-3)" }}>
                    {SOURCE_INTENT_LABELS[kind]}
                  </small>
                  {list.map((source) => (
                    <div
                      key={source.id}
                      className="lst-row"
                      style={{
                        alignItems: "center",
                        gap: 8,
                        height: "auto",
                        padding: "6px",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="c-name">{source.label}</div>
                        <input
                          className="cover-btn"
                          value={sourceTarget(source)}
                          onChange={(e) =>
                            editLocalSource(source.id, e.target.value)
                          }
                          style={{ width: "100%", textAlign: "left" }}
                        />
                      </div>
                      <span
                        className={
                          source.status === "approved"
                            ? "pal-chip on"
                            : "pal-chip"
                        }
                        style={{ pointerEvents: "none" }}
                      >
                        {SOURCE_STATUS_LABELS[source.status]}
                      </span>
                      {source.status !== "approved" && (
                        <button
                          className="cover-btn"
                          onClick={() =>
                            setLocalSourceStatus(source.id, "approved")
                          }
                        >
                          Approve
                        </button>
                      )}
                      {source.status !== "ignored" && (
                        <button
                          className="cover-btn"
                          onClick={() =>
                            setLocalSourceStatus(source.id, "ignored")
                          }
                        >
                          Ignore
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── pending updates ── */}
        {pending.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="c-name" style={{ marginBottom: 6 }}>
              Pending updates ({pending.length})
            </div>
            <div className="scroll" style={{ maxHeight: "28vh" }}>
              {pending.map((p) => (
                <div
                  key={p.id}
                  className="lst-row"
                  style={{
                    alignItems: "flex-start",
                    gap: 8,
                    height: "auto",
                    padding: "8px 6px",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="c-name">{p.topic}</div>
                    <small style={{ color: "var(--tx-3)", display: "block" }}>
                      {p.summary}
                    </small>
                  </div>
                  <button
                    className="cover-btn"
                    disabled={busyId === p.id}
                    onClick={() => void onApply(p)}
                  >
                    {busyId === p.id ? "Applying…" : "Apply"}
                  </button>
                  <button
                    className="cover-btn"
                    onClick={() => void onDismiss(p)}
                  >
                    Dismiss
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── schedules ── */}
        <div style={{ marginTop: 12 }}>
          <div className="c-name" style={{ marginBottom: 6 }}>
            Topic monitors
          </div>
          {schedules.length === 0 && (
            <div className="cmts-empty" style={{ padding: "16px 0" }}>
              No topic monitors yet. Add a topic above to keep a cited workspace
              page current — you review each update before it lands.
            </div>
          )}
          <div className="scroll" style={{ maxHeight: "38vh" }}>
            {schedules.map((s) => {
              const plan = normalizeMonitorSourcePlan(s.sourcePlan);
              const approved = plan.filter(
                (source) => source.status === "approved",
              ).length;
              const suggested = plan.filter(
                (source) => source.status === "suggested",
              ).length;
              return (
                <div
                  key={s.id}
                  className="lst-row"
                  style={{
                    alignItems: "flex-start",
                    gap: 8,
                    height: "auto",
                    padding: "8px 6px",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="c-name"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      {s.kind === "digest" ? (
                        <span
                          className="pal-chip on"
                          style={{ pointerEvents: "none" }}
                        >
                          External digest
                        </span>
                      ) : (
                        <span
                          className="pal-chip on"
                          style={{ pointerEvents: "none" }}
                        >
                          Topic monitor
                        </span>
                      )}
                      {s.kind === "digest"
                        ? s.scope?.source
                          ? `External sessions · ${s.scope.source}`
                          : "External sessions"
                        : s.topic}
                    </div>
                    <small style={{ color: "var(--tx-3)", display: "block" }}>
                      {cadenceLabel(s.cadence, s.hour)} · {fmtLast(s.lastRunAt)}
                      {s.kind === "digest"
                        ? " · app-open only"
                        : s.cronJobId
                          ? " · runs via scheduler"
                          : " · app-open only"}
                      {s.kind !== "digest" && s.sourceIntent
                        ? ` · ${SOURCE_INTENT_LABELS[s.sourceIntent]}`
                        : ""}
                      {approved
                        ? ` · ${approved} approved source${approved === 1 ? "" : "s"}`
                        : ""}
                      {suggested ? ` · ${suggested} suggested` : ""}
                      {s.telegramPush
                        ? telegramAvailable
                          ? " · Telegram summary"
                          : " · Telegram setup needed"
                        : ""}
                      {" · review-first"}
                      {!s.enabled ? " · paused" : ""}
                    </small>
                    {s.lastError && (
                      <small
                        role="status"
                        style={{
                          color: "var(--error)",
                          display: "block",
                          marginTop: 4,
                        }}
                      >
                        {s.lastError}
                      </small>
                    )}
                    {plan.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {plan.map((source) => (
                          <div
                            key={source.id}
                            style={{
                              display: "flex",
                              gap: 6,
                              alignItems: "center",
                              marginTop: 4,
                            }}
                          >
                            <small
                              style={{
                                color: "var(--tx-3)",
                                flex: 1,
                                minWidth: 0,
                              }}
                            >
                              {SOURCE_INTENT_LABELS[source.kind]} ·{" "}
                              {source.label} ·{" "}
                              {SOURCE_STATUS_LABELS[source.status]}
                            </small>
                            {source.status !== "approved" && (
                              <button
                                className="cover-btn"
                                onClick={() =>
                                  void updateScheduleSourceStatus(
                                    s,
                                    source.id,
                                    "approved",
                                  )
                                }
                              >
                                Approve
                              </button>
                            )}
                            {source.status !== "ignored" && (
                              <button
                                className="cover-btn"
                                onClick={() =>
                                  void updateScheduleSourceStatus(
                                    s,
                                    source.id,
                                    "ignored",
                                  )
                                }
                              >
                                Ignore
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    className="cover-btn"
                    disabled={busyId === s.id}
                    onClick={() => void onRunNow(s.id)}
                  >
                    {busyId === s.id ? "Running…" : "Run now"}
                  </button>
                  <button
                    className="cover-btn"
                    onClick={() => void onToggle(s)}
                  >
                    {s.enabled ? "Pause" : "Resume"}
                  </button>
                  <button
                    className="cover-btn"
                    onClick={() => void onDelete(s.id)}
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <AppLaunchSection
          targets={launchTargets}
          schedules={launchSchedules}
          onRefresh={refresh}
          flash={flash}
        />

        {/* ── agent tasks (cron) — oversight of agent jobs ── */}
        {cronJobs.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="c-name" style={{ marginBottom: 6 }}>
              Agent jobs ({cronJobs.length})
            </div>
            <div className="scroll" style={{ maxHeight: "30vh" }}>
              {cronJobs.map((job) => {
                const skip = skips[job.id];
                return (
                  <div
                    key={job.id}
                    className="lst-row"
                    style={{
                      alignItems: "flex-start",
                      gap: 8,
                      height: "auto",
                      padding: "8px 6px",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className="c-name"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {job.name}
                        {job.state === "paused" && (
                          <span
                            className="pal-chip"
                            style={{ pointerEvents: "none" }}
                          >
                            Paused
                          </span>
                        )}
                      </div>
                      <small style={{ color: "var(--tx-3)", display: "block" }}>
                        {job.schedule} · next {fmtCronTime(job.next_run_at)} ·
                        last {fmtCronTime(job.last_run_at)}
                        {job.last_status &&
                          job.last_status !== "ok" &&
                          ` · ${job.last_status}`}
                      </small>
                      {skip && skip.skipCount > 0 && (
                        <small
                          style={{
                            color: "var(--rd, #d66)",
                            display: "block",
                          }}
                        >
                          ⚠ skipped {skip.skipCount}×
                          {skip.lastReason ? ` · ${skip.lastReason}` : ""}
                        </small>
                      )}
                    </div>
                    {job.state !== "completed" && (
                      <button
                        className="cover-btn"
                        disabled={busyId === job.id}
                        onClick={() => void onCronToggle(job)}
                      >
                        {job.state === "paused" ? "Resume" : "Pause"}
                      </button>
                    )}
                    {job.state === "active" && (
                      <button
                        className="cover-btn"
                        disabled={busyId === job.id}
                        onClick={() => void onCronTrigger(job)}
                      >
                        Run now
                      </button>
                    )}
                    <button
                      className="cover-btn"
                      disabled={busyId === job.id}
                      onClick={() => void onCronDelete(job)}
                    >
                      Delete
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </SpsModal>
  );
}
