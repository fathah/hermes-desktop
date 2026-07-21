import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WarRoom from "./WarRoom";

const summary = {
  hero: { title: "HCC War Room", subtitle: "What matters now.", activeProjectCount: 2, domainCount: 3, toolCount: 4 },
  priorities: [],
  riskyDomains: [],
  dueReviews: [],
  openLoops: [],
  memoryPackets: {
    tiny: { packet_type: "tiny", summary: { count: 0, availableMatches: 0, elapsedMs: 1 }, items: [] },
    review: { packet_type: "review", summary: { count: 0, availableMatches: 0, elapsedMs: 1 }, items: [] },
  },
  execution: {
    summary: { queued: 3, running: 2, blocked: 1, failed: 4, completed: 5, cancelled: 0 },
    blockedRuns: [{ id: "run_blocked", task_title: "Recover stalled mission", worker_id: "worker-alpha", status: "blocked" }],
    workers: [{ worker_id: "worker-alpha", runCount: 6 }],
  },
  reality: {
    profile: {
      energyState: "normal",
      operatingMode: "normal",
      maxActiveProjects: 3,
      weeklyFocusMinutes: 600,
      weeklyRecoveryMinutes: 420,
      values: ["health before overload"],
      principles: ["ship grounded work"],
      antiGoals: ["busywork"],
      currentSeason: "build",
      riskTolerance: "balanced",
      strategicPriorityOrder: ["health", "HCC OS"],
      ambitionHorizon: "three years",
      hardConstraints: ["protect sleep"],
      softPreferences: ["deep work mornings"],
    },
    capacity: { weeklyFocusMinutes: 600, energyAdjustedMinutes: 500, projectDemandMinutes: 250, scheduledMinutes: 0, loadRatio: 0.5, remainingMinutes: 250 },
    schedule: { horizonDays: 7, scheduledMinutes: 0, blocks: [] },
    antiChaos: { currentMode: "normal", recommendedMode: "normal", simplify: false },
    conflicts: [],
    interventions: [],
  },
  tradeoffs: [],
  recovery: { degraded: false, recommendedMode: "normal", currentMode: "normal", signals: { critical: 0, high: 0, energy: "normal" }, actions: [] },
  observability: {
    schemaVersion: "hcc-observability-v1",
    generatedAt: 1_700_000_000,
    status: "healthy",
    signals: { critical: 0, warning: 0, conflicts: 0, interventions: 0 },
    domains: { total: 3, stable: 2, atRisk: 1, averageHealth: 75 },
    projects: { total: 2, active: 2, blocked: 0, completed: 0, throughputRate: 0 },
    execution: { ledgerCount: 5, pendingApproval: 0, active: 2, failed: 0, runs: { queued: 3 } },
    capacity: { weeklyFocusMinutes: 600, weeklyRecoveryMinutes: 420, energyAdjustedMinutes: 500, projectDemandMinutes: 250, scheduledMinutes: 0, loadRatio: 0.5, remainingMinutes: 250, currentMode: "normal", recommendedMode: "normal", energyState: "normal" },
    memory: { status: "healthy", healthScore: 92, pendingReviews: 0, sensitiveWarnings: 0, sensitiveBlocked: 1, snapshotAgeHours: 2 },
    reviews: { highUrgency: 0 },
    gateways: { total: 15, running: 15, unavailable: 0 },
    privacy: { policyCount: 5, retentionPolicyCount: 2, accessDeniedCount: 1, auditEventCount: 7 },
  },
  recommendations: [],
  integrity: { health: "healthy", summary: { issueCount: 0, orphanEdgeCount: 0, invalidRelationshipCount: 0, invalidNodeTypeCount: 0, invalidRelationshipPairCount: 0, semanticDuplicateCount: 0 } },
  summary: { priorityCount: 0, riskyDomainCount: 0, dueReviewCount: 0, openLoopCount: 0, graphEdgeCount: 0, elevatedDependencyRiskCount: 0, integrityIssueCount: 0, integrityHealth: "healthy", blockedRunCount: 1, runCount: 15 },
};

describe("WarRoom", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getHccWarRoomSummary: vi.fn().mockResolvedValue(summary),
        stageHccIntervention: vi.fn(),
        updateHccOperatingProfile: vi.fn().mockResolvedValue(summary.reality.profile),
        createHccTimeBlock: vi.fn(),
        cancelHccTimeBlock: vi.fn(),
        decideHccTradeoff: vi.fn(),
        stageHccRecoveryAction: vi.fn(),
      } as unknown as typeof window.hermesAPI,
    });
  });

  it("renders backend-driven execution pressure and blocked work", async () => {
    render(<WarRoom onOpenProject={vi.fn()} onOpenDomain={vi.fn()} onOpenMemory={vi.fn()} />);

    expect(await screen.findByText("Execution pressure")).toBeInTheDocument();
    expect(screen.getByText("Recover stalled mission")).toBeInTheDocument();
    expect(screen.getByText("worker-alpha")).toBeInTheDocument();
    expect(screen.getByText("Running").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("Blocked").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("Queued").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("Failed").nextSibling).toHaveTextContent("4");
    expect(screen.getByText("Identity operating model")).toBeInTheDocument();
    expect(screen.getByDisplayValue("health before overload")).toBeInTheDocument();
    expect(screen.getByText("Time architecture")).toBeInTheDocument();
    expect(screen.getByText("No focus blocks scheduled in next seven days.")).toBeInTheDocument();
    expect(screen.getByText("System observability")).toBeInTheDocument();
    expect(screen.getByText("Privacy enforcement")).toBeInTheDocument();
    expect(screen.getByText("Gateway availability")).toBeInTheDocument();
    expect(screen.getByText("Conflict and tradeoff engine")).toBeInTheDocument();
    expect(screen.getByText("No active conflicts require arbitration.")).toBeInTheDocument();
    expect(screen.getByText("Recovery and anti-chaos")).toBeInTheDocument();
  });
});
