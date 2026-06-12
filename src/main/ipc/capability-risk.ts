import { safeHandle } from "./safe-handle";
import {
  checkCapabilityRisks,
  getCapabilityRiskSummary,
  reviewCapabilityRisk,
} from "../capability-risk";

export function registerCapabilityRiskIpc(): void {
  safeHandle("capability-risk-summary", (_event, profile?: string) =>
    getCapabilityRiskSummary(profile),
  );
  safeHandle("capability-risk-check-now", (_event, profile?: string) =>
    checkCapabilityRisks(profile),
  );
  safeHandle(
    "capability-risk-review",
    (_event, id: string, profile?: string) => reviewCapabilityRisk(id, profile),
  );
}
