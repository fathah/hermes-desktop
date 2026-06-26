// task-routing.ts — the "Organize" step of the Tasks-Dump inbox. Takes a
// freshly-classified task and performs the routing side effect:
//
//   • route "ai", not risky → dispatch to the Hermes Kanban (the agent does it).
//     The task row stores only the Kanban id (delegatedTo); execution state
//     lives in Kanban, so the ToDo row never drifts from it.
//   • route "ai", risky     → hold in "review" (no dispatch) until the user OKs.
//   • route "human"         → schedule the nag engine (a TaskNagRecord).
//
// If an AI dispatch fails (e.g. the Hermes CLI is unavailable), the task is NOT
// dropped — it falls back to the human lane with a nag scheduled.
import { createTask } from "./kanban";
import { setNagRecord } from "./tasks-dump";
import {
  createNagRecord,
  type NagCadence,
  type RouteTaskInput,
  type RouteTaskOutcome,
} from "../shared/tasks-dump";

function cadenceFor(input: RouteTaskInput): NagCadence {
  return input.triage.nagCadence ?? "daily";
}

export async function routeTask(
  input: RouteTaskInput,
  profile?: string,
): Promise<RouteTaskOutcome> {
  const { rowId, title, body, triage } = input;
  const now = Date.now();

  if (triage.route === "ai" && !triage.risky) {
    const result = await createTask(
      { title, body: body || undefined, triage: true, goalMode: true },
      profile,
    );
    const delegatedTo = result.success ? result.data?.id : undefined;
    if (delegatedTo) {
      return { route: "ai", status: "doing", delegatedTo, dispatched: true };
    }
    // Dispatch failed — don't lose the task. Fall back to the human lane.
    await setNagRecord(createNagRecord(rowId, cadenceFor(input), now), profile);
    return {
      route: "human",
      status: "todo",
      dispatched: false,
      fellBackToHuman: true,
    };
  }

  if (triage.route === "ai" && triage.risky) {
    // Review gate: a risky AI task waits in "review" until the user approves it.
    return { route: "ai", status: "review", dispatched: false };
  }

  // Human lane: schedule the nag engine to chase it.
  await setNagRecord(createNagRecord(rowId, cadenceFor(input), now), profile);
  return { route: "human", status: "todo", dispatched: false };
}
