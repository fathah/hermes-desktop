import { getOperatorReadiness } from "../operator-readiness";
import { safeHandle } from "./safe-handle";

export function registerOperatorReadinessIpc(): void {
  safeHandle("get-operator-readiness", (_event, profile?: string) =>
    getOperatorReadiness(profile),
  );
}
