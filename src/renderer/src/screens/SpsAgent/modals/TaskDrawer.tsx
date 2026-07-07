// TaskDrawer.tsx — task detail side drawer. Ported from app.jsx TaskDrawer.
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { STATUS, PRIO } from "../data/seed";
import { usePersonPages } from "../hooks/usePersonPages";
import { useKanbanStatuses } from "../hooks/useKanbanStatuses";
import { KanbanStatusBadge } from "../tasks/chips";
import {
  summarizeNag,
  NAG_SNOOZE_PRESETS,
  type TaskNagRecord,
} from "../../../../../shared/tasks-dump";
import {
  availableChannels,
  type ChannelKind,
} from "../../../../../shared/contacts";

const CHANNEL_LABEL: Record<ChannelKind, string> = {
  email: "Email",
  sms: "SMS",
  imessage: "iMessage",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
};
import type {
  Task,
  StatusKey,
  PrioKey,
  PersonKey,
  ChecklistItem,
} from "../types";
import { useStore } from "../store";
import { rowToMarkdown, rowFromMarkdown } from "../editor/rowMarkdown";
import { pageIdFromPath } from "../lib/pageId";

interface Props {
  task: Task;
  onClose: () => void;
}

function parseChecklistAndDesc(body = ""): {
  desc: string;
  checklist: ChecklistItem[];
} {
  const lines = body.split("\n");
  const checklist: ChecklistItem[] = [];
  const descLines: string[] = [];
  for (const line of lines) {
    const match = /^\s*-\s*\[([ xX])\]\s*(.*)$/.exec(line);
    if (match) {
      checklist.push({
        id: Math.random().toString(36).substring(2, 9),
        text: match[2].trim(),
        checked: match[1].toLowerCase() === "x",
      });
    } else {
      descLines.push(line);
    }
  }
  return {
    desc: descLines.join("\n").trim(),
    checklist,
  };
}

function serializeBody(desc: string, checklist: ChecklistItem[]): string {
  let body = desc.trim();
  if (checklist.length > 0) {
    const listMd = checklist
      .map((item) => `- [${item.checked ? "x" : " "}] ${item.text}`)
      .join("\n");
    body = body ? `${body}\n\n${listMd}` : listMd;
  }
  return body;
}

export function TaskDrawer({ task, onClose }: Props) {
  const setOpenTask = useStore((s) => s.setOpenTask);
  const updateTask = useStore((s) => s.updateTask);

  const isFolderBacked = task.id.includes("/");
  const dbFolder = isFolderBacked ? task.id.split("/")[0] : "";
  const rowId = isFolderBacked ? pageIdFromPath(task.id) : "";

  // Local state for all fields
  const [title, setTitle] = useState(task.title);
  const [status, setStatus] = useState<StatusKey>(task.status);
  const [prio, setPrio] = useState<PrioKey>(task.prio);
  const [who, setWho] = useState<PersonKey>(task.who);
  const { persons } = usePersonPages();
  const assignee = persons.find((p) => p.id === who);
  // Channels we can hand off to via the OS (Telegram has no by-id deep link).
  const messageChannels = assignee
    ? availableChannels(assignee).filter((c) => c.kind !== "telegram")
    : [];
  const [due, setDue] = useState(task.due);
  const [est, setEst] = useState(task.est);

  const [desc, setDesc] = useState(task.desc || "");
  const [checklist, setChecklist] = useState<ChecklistItem[]>(
    task.checklist || [],
  );
  const [loading, setLoading] = useState(isFolderBacked);
  const [customProps, setCustomProps] = useState<Record<string, unknown>>(
    task.custom || {},
  );

  // Live agent status for a row delegated to the Hermes agent (Kanban is the
  // source of truth; the row only stores `delegatedTo`). Empty array ⇒ no poll.
  const { statusFor } = useKanbanStatuses(
    task.delegatedTo ? [task.delegatedTo] : [],
  );
  const agentStatus = statusFor(task.delegatedTo);

  // Nag state (volatile, JSON sidecar) for a human task's reminders. Fetched
  // once on open; mutated by the snooze/ack controls below.
  const [nag, setNag] = useState<TaskNagRecord | null>(null);
  useEffect(() => {
    if (!isFolderBacked || task.route !== "human") {
      setNag(null);
      return;
    }
    let cancelled = false;
    void window.hermesAPI
      .spsNagGet?.(rowId)
      .then((rec) => {
        if (!cancelled) setNag(rec ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [task.id, task.route, isFolderBacked, rowId]);

  const snoozeNag = async (ms: number): Promise<void> => {
    const rec = await window.hermesAPI.spsSnoozeNag?.(rowId, Date.now() + ms);
    setNag(rec ?? null);
  };
  const ackNag = async (): Promise<void> => {
    await window.hermesAPI.spsAckNag?.(rowId);
    setNag(null);
  };
  const nagSummary = summarizeNag(nag, Date.now());

  // Load folder-backed extra data
  useEffect(() => {
    if (!isFolderBacked) return;
    let cancelled = false;
    const loadData = async () => {
      try {
        const res = await window.hermesAPI.spsReadRow(dbFolder, rowId);
        if (res && !cancelled) {
          const { props, body } = rowFromMarkdown(res);
          setTitle((props.title as string) || task.title);
          setStatus((props.status as StatusKey) || task.status);
          setPrio((props.prio as PrioKey) || task.prio);
          setWho((props.who as PersonKey) || task.who);
          setDue(String(props.due ?? ""));
          setEst(String(props.est ?? ""));
          setCustomProps(props);

          const parsed = parseChecklistAndDesc(body);
          setDesc(parsed.desc);
          setChecklist(parsed.checklist);
        }
      } catch (e) {
        console.error("Failed to load folder-backed task data:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadData();
    return () => {
      cancelled = true;
    };
  }, [
    task.id,
    task.prio,
    task.status,
    task.title,
    task.who,
    isFolderBacked,
    dbFolder,
    rowId,
  ]);

  // General persistence dispatcher
  const saveChanges = async (
    patch: Partial<Task> & { descVal?: string; checklistVal?: ChecklistItem[] },
  ) => {
    const nextTitle = patch.title !== undefined ? patch.title : title;
    const nextStatus = patch.status !== undefined ? patch.status : status;
    const nextPrio = patch.prio !== undefined ? patch.prio : prio;
    const nextWho = patch.who !== undefined ? patch.who : who;
    const nextDue = patch.due !== undefined ? patch.due : due;
    const nextEst = patch.est !== undefined ? patch.est : est;
    const nextDesc = patch.descVal !== undefined ? patch.descVal : desc;
    const nextChecklist =
      patch.checklistVal !== undefined ? patch.checklistVal : checklist;

    const labelVal = patch.custom?.label || task.custom?.label;
    const updatedTask: Task = {
      ...task,
      title: nextTitle,
      status: nextStatus,
      prio: nextPrio,
      who: nextWho,
      due: nextDue,
      est: nextEst,
      desc: nextDesc,
      checklist: nextChecklist,
      custom: {
        ...task.custom,
        ...(labelVal !== undefined ? { label: labelVal } : {}),
      },
    };
    setOpenTask(updatedTask);

    if (isFolderBacked) {
      const nextProps = {
        ...customProps,
        title: nextTitle,
        status: nextStatus,
        prio: nextPrio,
        who: nextWho,
        due: nextDue,
        est: nextEst,
        ...(labelVal !== undefined ? { label: labelVal } : {}),
      };
      const bodyMd = serializeBody(nextDesc, nextChecklist);
      const markdown = rowToMarkdown(nextProps, bodyMd);
      await window.hermesAPI.spsExportRow(dbFolder, rowId, markdown);
    } else {
      updateTask(task.id, {
        title: nextTitle,
        status: nextStatus,
        prio: nextPrio,
        who: nextWho,
        due: nextDue,
        est: nextEst,
        desc: nextDesc,
        checklist: nextChecklist,
        custom: updatedTask.custom,
      });
    }
  };

  const addChecklistItem = () => {
    const newItem: ChecklistItem = {
      id: Math.random().toString(36).substring(2, 9),
      text: "New subtask",
      checked: false,
    };
    const nextList = [...checklist, newItem];
    setChecklist(nextList);
    void saveChanges({ checklistVal: nextList });
  };

  const updateChecklistItem = (
    itemId: string,
    text: string,
    checked: boolean,
  ) => {
    const nextList = checklist.map((item) =>
      item.id === itemId ? { ...item, text, checked } : item,
    );
    setChecklist(nextList);
    void saveChanges({ checklistVal: nextList });
  };

  const removeChecklistItem = (itemId: string) => {
    const nextList = checklist.filter((item) => item.id !== itemId);
    setChecklist(nextList);
    void saveChanges({ checklistVal: nextList });
  };

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <button
            className="tb-btn"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <Icon name="x" size={17} />
          </button>
          <span className="drawer-spacer"></span>
        </div>
        <div className="drawer-body scroll">
          {loading ? (
            <div className="drawer-loading">Loading details…</div>
          ) : (
            <>
              <input
                className="drawer-title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => void saveChanges({ title })}
                title="Task Title"
                placeholder="Task Title"
              />
              <div className="field-grid">
                <div className="fk">
                  <Icon name="board" size={15} /> Status
                </div>
                <div className="fv">
                  <select
                    value={status}
                    onChange={(e) => {
                      const val = e.target.value as StatusKey;
                      setStatus(val);
                      void saveChanges({ status: val });
                    }}
                    className="drawer-select"
                    title="Status"
                    aria-label="Status"
                  >
                    {Object.keys(STATUS).map((key) => (
                      <option key={key} value={key}>
                        {STATUS[key].label}
                      </option>
                    ))}
                  </select>
                </div>
                {task.delegatedTo && (
                  <>
                    <div className="fk">
                      <Icon name="board" size={15} /> Agent
                    </div>
                    <div className="fv">
                      {agentStatus ? (
                        <KanbanStatusBadge status={agentStatus} />
                      ) : (
                        <span style={{ color: "var(--tx-3)" }}>
                          Delegated · status pending…
                        </span>
                      )}
                    </div>
                  </>
                )}
                <div className="fk">
                  <Icon name="flag" size={15} /> Priority
                </div>
                <div className="fv">
                  <select
                    value={prio}
                    onChange={(e) => {
                      const val = e.target.value as PrioKey;
                      setPrio(val);
                      void saveChanges({ prio: val });
                    }}
                    className="drawer-select"
                    title="Priority"
                    aria-label="Priority"
                  >
                    {Object.keys(PRIO).map((key) => (
                      <option key={key} value={key}>
                        {PRIO[key].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="fk">
                  <Icon name="home" size={15} /> Owner
                </div>
                <div className="fv">
                  <select
                    value={who}
                    onChange={(e) => {
                      const val = e.target.value as PersonKey;
                      setWho(val);
                      void saveChanges({ who: val });
                    }}
                    className="drawer-select"
                    title="Owner"
                    aria-label="Owner"
                  >
                    {!persons.some((p) => p.id === who) && who && (
                      <option value={who}>{who}</option>
                    )}
                    {persons.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {messageChannels.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        marginTop: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      {messageChannels.map((channel) => (
                        <button
                          key={channel.kind}
                          className="drawer-select"
                          style={{
                            width: "auto",
                            padding: "2px 8px",
                            cursor: "pointer",
                          }}
                          title={`Message ${assignee?.name ?? ""} via ${CHANNEL_LABEL[channel.kind]}`}
                          onClick={() =>
                            void window.hermesAPI.spsOpenContactChannel(
                              channel,
                              assignee
                                ? {
                                    personId: assignee.id,
                                    personName: assignee.name,
                                    followUpAt: due.trim() || undefined,
                                    note: title.trim()
                                      ? `Task: ${title.trim()}`
                                      : undefined,
                                  }
                                : undefined,
                            )
                          }
                        >
                          {CHANNEL_LABEL[channel.kind]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="fk">
                  <Icon name="calendar" size={15} /> Due
                </div>
                <div className="fv">
                  <input
                    type="text"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                    onBlur={() => void saveChanges({ due })}
                    placeholder="e.g. Jun 9 or 2026-06-20"
                    className="drawer-input"
                    title="Due date"
                  />
                </div>
                <div className="fk">
                  <Icon name="clock" size={15} /> Estimate
                </div>
                <div className="fv">
                  <input
                    type="text"
                    value={est}
                    onChange={(e) => setEst(e.target.value)}
                    onBlur={() => void saveChanges({ est })}
                    placeholder="e.g. 1d or 4h"
                    className="drawer-input"
                    title="Estimate"
                  />
                </div>
              </div>
              <hr className="b-divider drawer-divider" />

              {nagSummary.active && (
                <div className="drawer-section">
                  <h3 className="drawer-section-title">
                    <Icon name="clock" size={15} /> Reminders
                  </h3>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ color: "var(--tx-3)", fontSize: 13 }}>
                      {nagSummary.label}
                    </span>
                    <span className="flex-grow" />
                    {nagSummary.snoozed ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => void snoozeNag(0)}
                      >
                        Resume now
                      </button>
                    ) : (
                      NAG_SNOOZE_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          className="btn btn-ghost btn-sm"
                          onClick={() => void snoozeNag(preset.ms)}
                        >
                          Snooze {preset.label}
                        </button>
                      ))
                    )}
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => void ackNag()}
                      title="Stop reminding me about this task"
                    >
                      Stop reminders
                    </button>
                  </div>
                </div>
              )}

              <div className="drawer-section">
                <h3 className="drawer-section-title">Description</h3>
                <textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  onBlur={() => void saveChanges({ descVal: desc })}
                  placeholder="Write a description here..."
                  className="drawer-textarea"
                  title="Description"
                  aria-label="Description"
                />
              </div>

              <div className="drawer-checklist-container">
                <h3 className="drawer-checklist-title">
                  <Icon name="checkbox" size={15} /> Subtasks / Checklist
                </h3>
                {checklist.map((item) => (
                  <div key={item.id} className="drawer-checklist-item">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(e) =>
                        updateChecklistItem(
                          item.id,
                          item.text,
                          e.target.checked,
                        )
                      }
                      title="Toggle subtask"
                      aria-label="Toggle subtask"
                    />
                    <input
                      type="text"
                      value={item.text}
                      onChange={(e) => {
                        const nextList = checklist.map((it) =>
                          it.id === item.id
                            ? { ...it, text: e.target.value }
                            : it,
                        );
                        setChecklist(nextList);
                      }}
                      onBlur={() =>
                        void saveChanges({ checklistVal: checklist })
                      }
                      title="Subtask text"
                      placeholder="Subtask text"
                      className={`drawer-checklist-input ${item.checked ? "completed" : ""}`}
                    />
                    <button
                      onClick={() => removeChecklistItem(item.id)}
                      className="drawer-checklist-delete"
                      title="Remove subtask"
                      aria-label="Remove subtask"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={addChecklistItem}
                  className="btn drawer-checklist-add"
                >
                  <Icon name="plus" size={12} /> Add item
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
