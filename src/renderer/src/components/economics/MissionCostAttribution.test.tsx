import { fireEvent, render, screen } from "@testing-library/react";
import type { HccMissionCostAttribution } from "../../types/hcc";
import MissionCostAttribution from "./MissionCostAttribution";

const attribution: HccMissionCostAttribution = {
  schemaVersion: "mission-cost-attribution-v1",
  mission: { id: "mission-1", name: "Grounded mission", status: "completed" },
  summary: {
    linkedRunCount: 2,
    usageRecordedRunCount: 2,
    tokens: { status: "recorded", input: 230, output: 70, total: 300 },
    cost: { status: "recorded", value: 0.6, currency: "USD" },
    outcomeQuality: { status: "recorded", average: 0.9, recordedRunCount: 2 },
    verifiedOutcomeCount: 1,
    costPerVerifiedOutcome: {
      status: "recorded",
      value: 0.6,
      currency: "USD",
      denominator: 1,
    },
    evidence: { artifactCount: 1, verificationStepCount: 1 },
  },
  breakdowns: {
    runs: [
      { runId: "run-a", title: "Run A", status: "completed" },
      { runId: "run-b", title: "Run B", status: "completed" },
    ],
    workers: [
      {
        workerId: "worker.backend",
        runCount: 2,
        tokens: { status: "recorded", input: 230, output: 70, total: 300 },
        cost: { status: "recorded", value: 0.6, currency: "USD" },
        verifiedOutcomeCount: 1,
        costPerVerifiedOutcome: {
          status: "recorded",
          value: 0.6,
          currency: "USD",
          denominator: 1,
        },
      },
    ],
    models: [
      {
        provider: "openai",
        model: "gpt-test",
        runCount: 2,
        tokens: { status: "recorded", input: 230, output: 70, total: 300 },
        cost: { status: "recorded", value: 0.6, currency: "USD" },
        verifiedOutcomeCount: 1,
        costPerVerifiedOutcome: {
          status: "recorded",
          value: 0.6,
          currency: "USD",
          denominator: 1,
        },
      },
    ],
  },
  budget: {
    status: "configured",
    state: "exceeded",
    limitTokens: 1000,
    limitCost: 0.5,
    alertThreshold: 0.8,
    utilization: 1.2,
    requiresApproval: true,
    policy: "recommend_only_no_silent_stop_or_reroute",
  },
  provenance: {
    sourceRefs: [{ type: "conductor_job", id: "mission-1" }],
    sources: ["cost_events"],
    runLinkPolicy: "explicit_mission_learning_run_refs",
    policy: "real_telemetry_only",
  },
};

describe("MissionCostAttribution", () => {
  it("renders real totals, attribution ledgers, and governed budget warning", async () => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getHccMissionCostAttribution: vi.fn().mockResolvedValue(attribution),
      } as unknown as typeof window.hermesAPI,
    });

    const onCompareRuns = vi.fn();
    render(
      <MissionCostAttribution
        missionId="mission-1"
        onCompareRuns={onCompareRuns}
      />,
    );

    expect(await screen.findByText("MISSION ECONOMICS")).toBeInTheDocument();
    expect(screen.getByText("2/2 runs metered")).toBeInTheDocument();
    expect(screen.getAllByText("$0.6000").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("openai · gpt-test")).toBeInTheDocument();
    expect(screen.getByText("worker.backend")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Compare mission runs" }),
    );
    expect(onCompareRuns).toHaveBeenCalledWith(["run-a", "run-b"]);
    expect(
      screen.getByText(
        /Recommendation only—stop or reroute requires explicit approval/,
      ),
    ).toBeInTheDocument();
  });
});
