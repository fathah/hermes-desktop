// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  countRunningTasksByAssignee,
  officeAgentsChanged,
  profilesToOfficeAgents,
  type OfficeProfileInput,
  type OfficeTaskInput,
} from "./agents";

const profiles: OfficeProfileInput[] = [
  { id: "default", name: "Primary Agent", gatewayRunning: true },
  {
    id: "build-agent",
    name: "Build Agent",
    gatewayRunning: false,
  },
  { id: "research-agent", name: "Research Agent", gatewayRunning: true },
];

describe("Office Kanban activity", () => {
  it("matches running-card assignees to stable profile IDs", () => {
    const tasks: OfficeTaskInput[] = [
      { assignee: "build-agent", status: "running" },
      { assignee: " @BUILD-AGENT ", status: "running" },
      { assignee: "research-agent", status: "done" },
      { assignee: null, status: "running" },
    ];

    const agents = profilesToOfficeAgents(profiles, tasks);

    expect(
      agents.map(({ id, status, activeTaskCount }) => ({
        id,
        status,
        activeTaskCount,
      })),
    ).toEqual([
      { id: "default", status: "idle", activeTaskCount: 0 },
      {
        id: "build-agent",
        status: "working",
        activeTaskCount: 2,
      },
      { id: "research-agent", status: "idle", activeTaskCount: 0 },
    ]);
  });

  it("falls back to gateway liveness when Kanban is unavailable", () => {
    const agents = profilesToOfficeAgents(profiles, null);

    expect(
      agents.map(({ id, status, activeTaskCount }) => ({
        id,
        status,
        activeTaskCount,
      })),
    ).toEqual([
      { id: "default", status: "working", activeTaskCount: undefined },
      {
        id: "build-agent",
        status: "idle",
        activeTaskCount: undefined,
      },
      {
        id: "research-agent",
        status: "working",
        activeTaskCount: undefined,
      },
    ]);
  });

  it("counts only running cards with non-empty assignees", () => {
    const counts = countRunningTasksByAssignee([
      { assignee: "default", status: "running" },
      { assignee: "DEFAULT", status: "running" },
      { assignee: "default", status: "blocked" },
      { assignee: " ", status: "running" },
    ]);

    expect(Object.fromEntries(counts)).toEqual({ default: 2 });
  });

  it("detects activity-count changes even when status stays working", () => {
    const before = profilesToOfficeAgents(profiles, [
      { assignee: "default", status: "running" },
    ]);
    const after = profilesToOfficeAgents(profiles, [
      { assignee: "default", status: "running" },
      { assignee: "default", status: "running" },
    ]);

    expect(officeAgentsChanged(before, after)).toBe(true);
    expect(officeAgentsChanged(after, after)).toBe(false);
  });
});
