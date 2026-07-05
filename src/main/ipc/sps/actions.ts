import { safeHandle } from "../safe-handle";
import { resolveSpsVaultDir } from "../../sps-storage";
import { runApiAction, runShellAction } from "../../sps-action-runner";
import { normalizeIpcProfile } from "../validate";

export function registerSpsActionsIpc(): void {
  safeHandle(
    "sps-trigger-action",
    async (
      _event,
      action: {
        type: "shell" | "api";
        command?: string;
        url?: string;
        headers?: string;
      },
      profile?: unknown,
    ): Promise<{ success: boolean; output?: string; error?: string }> => {
      if (action.type === "shell") {
        const vaultDir = resolveSpsVaultDir(normalizeIpcProfile(profile));
        return runShellAction(action.command, vaultDir);
      } else if (action.type === "api") {
        return runApiAction(action.url, action.headers);
      } else {
        return {
          success: false,
          error: `Unsupported action type: ${action.type}`,
        };
      }
    },
  );
}
