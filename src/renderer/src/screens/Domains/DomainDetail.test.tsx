import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DomainDetail from "./DomainDetail";

const domain = {
  id: "domain.health",
  name: "Health",
  description: "Energy, sleep, recovery, and physical sustainability.",
  health_score: 64,
  momentum_score: 58,
  neglect_risk: "medium",
  open_loops: ["recovery_mode_spec"],
  core_metrics: ["sleep"],
  obligations: ["maintain_recovery_capacity"],
  active_goals: ["avoid_overload"],
  review_cadence: "weekly",
  alert_thresholds: { low_energy_days: 3 },
  linked_projects: [{ id: "project.health", name: "Recovery protocol", status: "active", momentum_score: 60, risk_score: 30 }],
  linked_gateways: [{ id: "life-os-gateway", displayName: "Life OS Gateway" }],
  memory_capsules: [{ id: "mem.health", kind: "fact", summary: "Protect recovery capacity.", body: "", scope_type: "domain", domain_ids: ["domain.health"], project_ids: [], gateway_ids: [], tool_ids: [], importance: "high", confidence: "high", freshness: "fresh", sensitivity: "local", promotion_state: "promoted", source_type: "manual", contradiction_state: "none" }],
};

describe("DomainDetail", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: { getHccDomainDetail: vi.fn().mockResolvedValue(domain) } as unknown as typeof window.hermesAPI,
    });
  });

  it("renders domain state, linked projects, alerts, gateways, and scoped memory", async () => {
    render(<DomainDetail domainId="domain.health" />);

    expect(await screen.findByRole("heading", { name: "Health" })).toBeInTheDocument();
    expect(screen.getByText("Alert thresholds")).toBeInTheDocument();
    expect(screen.getByText("low energy days")).toBeInTheDocument();
    expect(screen.getByText("Recovery protocol")).toBeInTheDocument();
    expect(screen.getByText("Life OS Gateway")).toBeInTheDocument();
    expect(screen.getByText("Protect recovery capacity.")).toBeInTheDocument();
  });
});
