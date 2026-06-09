import { BrowserWindow } from "electron";
import { registerKanbanIpc } from "./kanban";
import { registerEquityIpc } from "./equity";
import { registerAutomationIpc } from "./automation";
import { registerSkillsIpc } from "./skills";
import { registerSessionsIpc } from "./sessions";
import { registerMemoryIpc } from "./memory";
import { registerSpsIpc } from "./sps";

/**
 * Aggregator for the workspace-area IPC handlers. Each domain registers its
 * own handlers in a focused `ipc/<domain>.ts` module (mirroring chat/config/
 * notes/system); this keeps the previous single 674-line junk-drawer from
 * forcing edits here whenever an unrelated domain changes. `index.ts` still
 * calls only `registerWorkspaceIpc`.
 *
 * None of these handlers need the main window — the getter is accepted for
 * signature compatibility with the other register*Ipc entry points.
 */
export function registerWorkspaceIpc(
  _mainWindowGetter: () => BrowserWindow | null,
): void {
  registerKanbanIpc();
  registerEquityIpc();
  registerAutomationIpc();
  registerSkillsIpc();
  registerSessionsIpc();
  registerMemoryIpc();
  registerSpsIpc();
}
