import { safeHandle } from "./safe-handle";
import {
  getResearchReachInstallInstructions,
  getResearchReachStatus,
  importAgentReachSkill,
  runResearchReachSafeInstall,
} from "../research-reach";

export function registerResearchReachIpc(): void {
  safeHandle("research-reach-status", () => getResearchReachStatus());
  safeHandle("research-reach-install-instructions", () =>
    getResearchReachInstallInstructions(),
  );
  safeHandle("research-reach-safe-install", () =>
    runResearchReachSafeInstall(),
  );
  safeHandle("research-reach-import-skill", (_event, profile?: string) =>
    importAgentReachSkill(profile),
  );
}
