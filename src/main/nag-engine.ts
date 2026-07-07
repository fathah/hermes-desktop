// nag-engine.ts — the "Reflect" loop for human-owned tasks. On each (throttled)
// scheduler tick it reads the nag records, looks up the current task facts from
// the note-index, and asks the pure planNagActions what to fire. The escalation
// ladder:
//   • badge        → no notification (the overdue task on the ToDo page is the badge)
//   • notification → a local macOS notification
//   • channel      → an insistent local notification (nag ME, the default) plus,
//                    only when the task opted in (autoSendOnEscalate), a
//                    best-effort Telegram auto-send to the assignee.
// Opening the note-index means this can't run under vitest; the decision logic
// it delegates to (planNagActions) is unit-tested in scheduler-nag.test.ts.
import { Notification } from "electron";
import { getSpsNoteIndex } from "./note-index";
import { listNagRecords, removeNagRecord, setNagRecord } from "./tasks-dump";
import { sendTelegramViaGateway } from "./contact-messaging";
import { deliverOwnerNotification } from "./owner-delivery";
import {
  PERSON_FOLDER,
  parsePersonFrontmatter,
  preferredChannel,
  type ContactChannel,
} from "../shared/contacts";
import {
  planNagActions,
  type NagAction,
  type NagTaskMeta,
} from "../shared/tasks-dump";
import { formatLogError, log } from "./log";

interface IndexRow {
  path: string;
  title?: string;
  props?: Record<string, unknown>;
}

function rowIdFromPath(path: string): string {
  return path.replace(/\.md$/, "").split("/").pop() ?? path;
}

function notify(title: string, body: string): void {
  try {
    new Notification({ title, body }).show();
  } catch (err) {
    log.error("nag-engine", {
      msg: "notification failed",
      title,
      error: formatLogError(err),
    });
  }
}

function resolveChannel(
  assigneeId: string | undefined,
  personRows: IndexRow[],
): ContactChannel | null {
  if (!assigneeId) return null;
  const row = personRows.find((r) => rowIdFromPath(r.path) === assigneeId);
  if (!row) return null;
  return preferredChannel(parsePersonFrontmatter(row.props ?? {}));
}

async function deliverOwnerNag(
  action: NagAction,
  profile?: string,
): Promise<void> {
  try {
    await deliverOwnerNotification(
      {
        event: "nag",
        title: "Overdue task needs action",
        body: action.title,
        dedupeKey: `nag:${action.rowId}:${action.tier}`,
      },
      profile,
    );
  } catch (err) {
    log.error("nag-engine", {
      msg: "owner nag delivery failed",
      rowId: action.rowId,
      error: formatLogError(err),
    });
  }
}

async function fireNag(
  action: NagAction,
  personRows: IndexRow[],
  profile?: string,
): Promise<void> {
  if (action.tier === "badge") return; // the overdue ToDo row is the badge
  if (action.tier === "notification") {
    notify("⏰ Still waiting", action.title);
    return;
  }
  // channel tier: nag me (the default), plus opt-in auto-send to the assignee.
  notify("⏰ Overdue — needs action", action.title);
  await deliverOwnerNag(action, profile);
  if (!action.autoSend) return;
  const channel = resolveChannel(action.assigneeId, personRows);
  if (channel?.kind === "telegram") {
    await sendTelegramViaGateway(
      channel.value,
      `Reminder: ${action.title}`,
      profile,
    ).catch(() => false);
  }
}

/** One nag-engine pass. Throttled by the scheduler; safe to call when empty. */
export async function nagTick(profile?: string): Promise<void> {
  const records = await listNagRecords(profile);
  if (!records.length) return;
  const now = Date.now();
  const index = await getSpsNoteIndex(profile);
  const taskRows = index.query({ scope: "tasks" }) as IndexRow[];
  const meta: Record<string, NagTaskMeta> = {};
  for (const row of taskRows) {
    const props = row.props ?? {};
    meta[rowIdFromPath(row.path)] = {
      title: typeof props.title === "string" ? props.title : row.title || "",
      done: props.status === "done",
      autoSendOnEscalate: props.autoSendOnEscalate === true,
      assigneeId:
        typeof props.assigneeId === "string" ? props.assigneeId : undefined,
    };
  }
  const plan = planNagActions(records, meta, now);
  if (plan.actions.length) {
    const personRows = index.query({ scope: PERSON_FOLDER }) as IndexRow[];
    for (const action of plan.actions) {
      await fireNag(action, personRows, profile);
    }
  }
  for (const advanced of plan.advanced) await setNagRecord(advanced, profile);
  for (const staleId of plan.staleIds) await removeNagRecord(staleId, profile);
}
