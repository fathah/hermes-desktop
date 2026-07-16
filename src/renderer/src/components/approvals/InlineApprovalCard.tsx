import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, RefreshCw, ShieldCheck, X } from "lucide-react";
import type { HccInlineApprovalItem, HccInlineApprovals } from "../../types/hcc";

interface InlineApprovalCardProps {
  missionId: string;
}

function InlineApprovalCard({ missionId }: InlineApprovalCardProps): React.JSX.Element {
  const [data, setData] = useState<HccInlineApprovals | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMessage(null);
    try {
      setData(await window.hermesAPI.getHccInlineApprovals(missionId) as HccInlineApprovals);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Approvals unavailable");
    }
  }, [missionId]);

  useEffect(() => {
    setData(null);
    setNotes({});
    setConfirmId(null);
    void load();
  }, [load]);

  const decide = async (item: HccInlineApprovalItem, decision: "approve" | "reject"): Promise<void> => {
    const note = notes[item.id]?.trim() || "";
    if (!note) return;
    setBusy(item.id);
    setMessage(null);
    try {
      await window.hermesAPI.decideHccInlineApproval(
        missionId,
        item.approvalDomain,
        item.id,
        decision,
        "desktop-operator",
        note.trim(),
      );
      setMessage(`${item.title} ${decision === "approve" ? "approved" : "rejected"}.`);
      setNotes((current) => ({ ...current, [item.id]: "" }));
      setConfirmId(null);
      await load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Decision failed");
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return <section className="inline-approvals"><div className="inline-approval-loading">Loading mission approvals…</div></section>;
  }

  return (
    <section className="inline-approvals" aria-label="Mission inline approvals">
      <header>
        <div><ShieldCheck size={16} /><span>APPROVALS AT ORIGIN</span><strong>{data.summary.pending} pending</strong></div>
        <button aria-label="Refresh approvals" onClick={() => void load()}><RefreshCw size={14} /></button>
      </header>

      {data.items.length === 0 ? (
        <div className="inline-approval-empty">No approval records linked to this mission.</div>
      ) : (
        <div className="inline-approval-list">
          {data.items.map((item) => {
            const actionable = item.allowedDecisions.length > 0;
            const executes = item.resolutionMode === "approve_executes_guarded_action";
            const itemNote = notes[item.id] || "";
            return (
              <article key={`${item.approvalDomain}:${item.id}`} className="inline-approval-item">
                <div className="inline-approval-item-head">
                  <span>{item.approvalDomain === "run_request" ? "RUN ACTION" : "PROPOSAL"}</span>
                  <em className={`approval-status status-${item.status}`}>{item.status}</em>
                </div>
                <strong>{item.title.replaceAll("_", " ")}</strong>
                <p>{item.reason || "No rationale recorded."}</p>
                <small>{item.riskLevel || "governed"} · target {item.targetId || "not recorded"}</small>
                {executes && actionable && (
                  <div className="inline-approval-warning"><AlertTriangle size={13} />Approval executes the guarded run action immediately.</div>
                )}
                {actionable && (
                  <div className="inline-approval-actions">
                    <input aria-label={`Decision note for ${item.title}`} placeholder="Decision note (required)" value={itemNote} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} />
                    {executes && confirmId === item.id ? (
                      <>
                        <button className="approval-confirm" disabled={!itemNote.trim() || busy === item.id} onClick={() => void decide(item, "approve")}><Check size={13} />Confirm execution</button>
                        <button onClick={() => setConfirmId(null)}>Cancel</button>
                      </>
                    ) : (
                      <button disabled={!itemNote.trim() || busy === item.id} onClick={() => executes ? setConfirmId(item.id) : void decide(item, "approve")}><Check size={13} />{executes ? "Approve action" : "Approve · no apply"}</button>
                    )}
                    <button className="approval-reject" disabled={!itemNote.trim() || busy === item.id} onClick={() => void decide(item, "reject")}><X size={13} />Reject</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {message && <div className="inline-approval-message">{message}</div>}
      <footer>{data.provenance.policy.replaceAll("_", " ")}</footer>
    </section>
  );
}

export default InlineApprovalCard;
