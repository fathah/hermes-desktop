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
import {
  CADENCES,
  cadenceLabel,
  type Cadence,
} from "../../../../../shared/scheduledResearch";
import type { CronJob } from "../../../../../shared/cronjobs";

type Schedule = Awaited<ReturnType<typeof window.hermesAPI.srList>>[number];
type Pending = Awaited<
  ReturnType<typeof window.hermesAPI.srListPending>
>[number];
type SkipInfo = { skipCount: number; lastSkipAt: number; lastReason: string };

export function ScheduledModal() {
  const setScheduledOpen = useStore((s) => s.setScheduledOpen);
  const ingestCommitPage = useStore((s) => s.ingestCommitPage);
  const selectPage = useStore((s) => s.selectPage);
  const flash = useStore((s) => s.flash);
  const onClose = () => setScheduledOpen(false);

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  // Agent-created cron jobs (ported from the deleted admin Schedules screen) —
  // oversight only: see every background job + stop/run it. Creation of new raw
  // cron jobs stays with the agent/CLI; research/digest scheduling is above.
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [skips, setSkips] = useState<Record<string, SkipInfo>>({});
  const [topic, setTopic] = useState("");
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [hour, setHour] = useState(8);
  const [wantAutoApply, setWantAutoApply] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const topicRef = useRef<HTMLInputElement>(null);

  // Silently commit pending updates whose schedule opted into autoApply (so a
  // trusted schedule keeps its page current without a review click). Review-first
  // schedules leave their pending for the user to Apply.
  const autoApplyPending = async (
    list: Pending[],
    scheds: Schedule[],
  ): Promise<boolean> => {
    let did = false;
    for (const p of list) {
      const s = scheds.find((x) => x.id === p.scheduleId);
      if (!s?.autoApply) continue;
      try {
        await commitChangeset(p.changeset, ingestCommitPage);
        await window.hermesAPI.spsAppendWikiLog?.("research", p.summary);
        await window.hermesAPI.srRemovePending(p.id);
        did = true;
      } catch {
        /* leave it for manual review */
      }
    }
    return did;
  };

  const refresh = async () => {
    const [s, p, cron, sk] = await Promise.all([
      window.hermesAPI.srList(),
      window.hermesAPI.srListPending(),
      window.hermesAPI.listCronJobs(true).catch(() => [] as CronJob[]),
      window.hermesAPI
        .getSchedulerSkips()
        .catch(() => ({}) as Record<string, SkipInfo>),
    ]);
    setCronJobs(cron || []);
    setSkips(sk || {});
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

  const onCreate = async () => {
    const t = topic.trim();
    if (!t) return;
    setCreating(true);
    setError("");
    try {
      const res = await window.hermesAPI.srCreate({
        topic: t,
        cadence,
        hour,
        autoApply: wantAutoApply,
      });
      if (!res.ok) {
        setError(res.error || "Couldn't create the schedule.");
        return;
      }
      setTopic("");
      await refresh();
    } finally {
      setCreating(false);
    }
  };

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
    <SpsModal title="⏱ Scheduled" onClose={onClose} width={660}>
      <div className="modal-body">
        {/* ── create ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto auto",
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
              placeholder="Research this topic on a schedule…"
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
            onClick={() => void onCreate()}
            disabled={creating || !topic.trim()}
          >
            {creating ? "Adding…" : "Add"}
          </button>
        </div>
        <div
          style={{
            display: "flex",
            gap: 16,
            marginBottom: 8,
            fontSize: 12,
            color: "var(--tx-3)",
          }}
        >
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={wantAutoApply}
              onChange={(e) => setWantAutoApply(e.target.checked)}
            />
            Auto-apply (skip review)
          </label>
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
            Schedules
          </div>
          {schedules.length === 0 && (
            <div className="cmts-empty" style={{ padding: "16px 0" }}>
              No schedules yet. Add a topic above to keep a wiki page current
              automatically — you review each update before it lands.
            </div>
          )}
          <div className="scroll" style={{ maxHeight: "34vh" }}>
            {schedules.map((s) => (
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
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    {s.kind === "digest" && (
                      <span
                        className="pal-chip on"
                        style={{ pointerEvents: "none" }}
                      >
                        Digest
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
                        ? " · runs in background"
                        : " · app-open only"}
                    {s.autoApply ? " · auto-apply" : ""}
                    {!s.enabled ? " · paused" : ""}
                  </small>
                </div>
                <button
                  className="cover-btn"
                  disabled={busyId === s.id}
                  onClick={() => void onRunNow(s.id)}
                >
                  {busyId === s.id ? "Running…" : "Run now"}
                </button>
                <button className="cover-btn" onClick={() => void onToggle(s)}>
                  {s.enabled ? "Pause" : "Resume"}
                </button>
                <button
                  className="cover-btn"
                  onClick={() => void onDelete(s.id)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ── agent tasks (cron) — oversight of background jobs ── */}
        {cronJobs.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="c-name" style={{ marginBottom: 6 }}>
              Scheduled work ({cronJobs.length})
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
