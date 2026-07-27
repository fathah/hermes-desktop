// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  completeMission,
  dispatchMission,
  emitMissionEvent,
  makeMissionId,
  onMission,
  onMissionComplete,
  onMissionEvent,
  type Mission,
} from "./missionBus";

function mission(): Mission {
  return {
    id: makeMissionId(),
    agentId: "agent-1",
    dest: "bank",
    interaction: { repId: "atm", actionId: "checkBalance" },
  };
}

describe("mission bus", () => {
  // @lat: [[office-world-actions#Tests#Bus delivers and unsubscribes]]
  it("delivers missions, completions, and events to subscribers", () => {
    const seen: Mission[] = [];
    const completed: string[] = [];
    const events: string[] = [];
    const offMission = onMission((m) => seen.push(m));
    const offComplete = onMissionComplete((id) => completed.push(id));
    const offEvent = onMissionEvent((e) => events.push(e.type));

    const m = mission();
    dispatchMission(m);
    completeMission(m.id);
    emitMissionEvent({ type: "arrived", mission: m });
    emitMissionEvent({ type: "ended", mission: m });

    expect(seen).toEqual([m]);
    expect(completed).toEqual([m.id]);
    expect(events).toEqual(["arrived", "ended"]);

    // Unsubscribed listeners stop receiving — a torn-down AgentsLayer must
    // never act on a mission for a stale controller map.
    offMission();
    offComplete();
    offEvent();
    dispatchMission(mission());
    completeMission("nope");
    emitMissionEvent({ type: "ended", mission: m });
    expect(seen).toHaveLength(1);
    expect(completed).toHaveLength(1);
    expect(events).toHaveLength(2);
  });

  it("mints unique mission ids", () => {
    const ids = new Set([makeMissionId(), makeMissionId(), makeMissionId()]);
    expect(ids.size).toBe(3);
  });
});
