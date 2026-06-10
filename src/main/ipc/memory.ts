import { safeHandle } from "./safe-handle";
import {
  readMemory,
  addMemoryEntry,
  updateMemoryEntry,
  removeMemoryEntry,
  writeUserProfile,
  writeMemory,
} from "../memory";
import { getMemoryTimeline } from "../memory-timeline";
import {
  readFocus,
  writeFocus,
  getDailyContextHookStatus,
  setDailyContextHookEnabled,
} from "../personalization";
import { readSoul, writeSoul, resetSoul } from "../soul";
import { getToolsets, setToolsetEnabled } from "../tools";
import {
  sshReadMemory,
  sshAddMemoryEntry,
  sshUpdateMemoryEntry,
  sshRemoveMemoryEntry,
  sshWriteUserProfile,
  sshReadSoul,
  sshWriteSoul,
  sshResetSoul,
  sshGetToolsets,
  sshSetToolsetEnabled,
} from "../ssh-remote";
import { registerDualHandler } from "./utility";

// The agent's editable "self": long-term memory, focus/personalization, the
// soul prompt, and toolset toggles. Most are dual-mode (local + SSH); the ones
// not yet wired for SSH return an explicit "not available over SSH" result.
export function registerMemoryIpc(): void {
  // Memory
  registerDualHandler("read-memory", readMemory, sshReadMemory);
  safeHandle("get-memory-timeline", (_event, profile?: string) =>
    getMemoryTimeline(profile),
  );
  registerDualHandler("add-memory-entry", addMemoryEntry, sshAddMemoryEntry);
  registerDualHandler(
    "update-memory-entry",
    updateMemoryEntry,
    sshUpdateMemoryEntry,
  );
  registerDualHandler(
    "remove-memory-entry",
    removeMemoryEntry,
    sshRemoveMemoryEntry,
  );
  registerDualHandler(
    "write-user-profile",
    writeUserProfile,
    sshWriteUserProfile,
  );
  registerDualHandler(
    "write-memory",
    (content: string, profile?: string) => writeMemory(content, profile),
    () => ({
      success: false,
      error: "Editing memory isn't available over SSH yet.",
    }),
  );
  registerDualHandler(
    "read-focus",
    () => readFocus(),
    () => "",
  );
  registerDualHandler(
    "write-focus",
    (content: string) => writeFocus(content),
    () => ({
      success: false,
      error: "Editing focus isn't available over SSH yet.",
    }),
  );
  registerDualHandler(
    "get-daily-context-hook-status",
    (profile?: string) => getDailyContextHookStatus(profile),
    () => ({
      configured: false,
      allowlisted: false,
      scriptExists: false,
      enabled: false,
    }),
  );
  registerDualHandler(
    "set-daily-context-hook-enabled",
    (enabled: boolean, profile?: string) =>
      setDailyContextHookEnabled(enabled, profile),
    () => ({
      success: false,
      error: "The daily-context hook isn't available over SSH yet.",
    }),
  );

  // Soul
  registerDualHandler("read-soul", readSoul, sshReadSoul);
  registerDualHandler("write-soul", writeSoul, sshWriteSoul);
  registerDualHandler("reset-soul", resetSoul, sshResetSoul);

  // Tools
  registerDualHandler("get-toolsets", getToolsets, sshGetToolsets);
  registerDualHandler(
    "set-toolset-enabled",
    setToolsetEnabled,
    sshSetToolsetEnabled,
  );
}
