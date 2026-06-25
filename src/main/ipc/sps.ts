import { registerSpsActionsIpc } from "./sps/actions";
import { registerSpsActiveWorkIpc } from "./sps/active-work";
import { registerSpsCaptureIpc } from "./sps/capture";
import { registerSpsCoreIpc } from "./sps/core";
import { registerSpsDeckIpc } from "./sps/deck";
import { registerSpsEmailMonitorIpc } from "./sps/email-monitor";
import { registerSpsLearningIpc } from "./sps/learning";
import { registerSpsNotebookLmIpc } from "./sps/notebooklm";
import { registerSpsResearchIpc } from "./sps/research";
import { registerSpsVaultIpc } from "./sps/vault";

export function registerSpsIpc(): void {
  registerSpsCoreIpc();
  registerSpsCaptureIpc();
  registerSpsEmailMonitorIpc();
  registerSpsVaultIpc();
  registerSpsDeckIpc();
  registerSpsLearningIpc();
  registerSpsActiveWorkIpc();
  registerSpsResearchIpc();
  registerSpsNotebookLmIpc();
  registerSpsActionsIpc();
}
