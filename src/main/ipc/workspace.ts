import { BrowserWindow } from "electron";
import { registerKanbanIpc } from "./kanban";
import { registerEquityIpc } from "./equity";
import { registerAutomationIpc } from "./automation";
import { registerSkillsIpc } from "./skills";
import { registerSessionsIpc } from "./sessions";
import { registerMemoryIpc } from "./memory";
import { registerSpsIpc } from "./sps";
import { registerScheduledResearchIpc } from "./scheduled-research";
import { registerAppLauncherIpc } from "./app-launcher";

/**
 * Aggregator for the workspace-area IPC handlers. Each domain registers its
 * own handlers in a focused `ipc/<domain>.ts` module (mirroring chat/config/
 * notes/system); this keeps the previous single 674-line junk-drawer from
 * forcing edits here whenever an unrelated domain changes. `index.ts` still
 * calls only `registerWorkspaceIpc`.
 *
 * Most of these handlers don't need the main window; scheduled-research uses it
 * to push a "scheduled-research-update" event to the renderer on a "Run now".
 */
export function registerWorkspaceIpc(
  mainWindowGetter: () => BrowserWindow | null,
): void {
  registerKanbanIpc();
  registerEquityIpc();
  registerAutomationIpc();
  registerSkillsIpc();
  registerSessionsIpc();
  registerMemoryIpc();
  registerSpsIpc();
  registerAppLauncherIpc();
  registerScheduledResearchIpc(mainWindowGetter);
}
