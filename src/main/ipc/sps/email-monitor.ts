import { safeHandle } from "../safe-handle";
import { requireLocalWorkspace } from "../connection-guards";
import {
  applyEmailMonitorFeedbackForProfile,
  getEmailMonitorConfig,
  getEmailMonitorStatus,
  runEmailMonitorNow,
  saveEmailMonitorConfig,
} from "../../email-monitor";
import type {
  EmailMonitorConfig,
  EmailMonitorFeedback,
} from "../../../shared/email-monitor";

export function registerSpsEmailMonitorIpc(): void {
  safeHandle("sps-email-monitor-get-config", (_event, profile?: string) => {
    requireLocalWorkspace();
    return getEmailMonitorConfig(profile);
  });
  safeHandle(
    "sps-email-monitor-save-config",
    (_event, config: EmailMonitorConfig, profile?: string) => {
      requireLocalWorkspace();
      return saveEmailMonitorConfig(config, profile);
    },
  );
  safeHandle("sps-email-monitor-status", (_event, profile?: string) => {
    requireLocalWorkspace();
    return getEmailMonitorStatus(profile);
  });
  safeHandle("sps-email-monitor-run-now", (_event, profile?: string) => {
    requireLocalWorkspace();
    return runEmailMonitorNow(profile);
  });
  safeHandle(
    "sps-email-monitor-apply-feedback",
    (_event, feedback: EmailMonitorFeedback, profile?: string) => {
      requireLocalWorkspace();
      return applyEmailMonitorFeedbackForProfile(feedback, profile);
    },
  );
}
