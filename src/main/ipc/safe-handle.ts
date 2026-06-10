import { ipcMain } from "electron";
import { log } from "../log";
import { redactExternalText } from "../external-context/redact";

/**
 * The exact listener type `ipcMain.handle` expects. Deriving it (rather than
 * re-declaring `(event, ...args: any[])`) keeps `safeHandle` a perfect drop-in:
 * any handler that type-checks against `ipcMain.handle` type-checks here too,
 * with no `any` of our own and no parameter-variance surprises.
 */
export type IpcHandler = Parameters<typeof ipcMain.handle>[1];

/**
 * Pure: turn a thrown value into the redacted, serializable message we rethrow
 * plus the structured fields we log. Extracted from {@link safeHandle} so the
 * redaction + shaping logic is unit-testable without electron in the loop.
 *
 * Secrets can surface in either the message (e.g. a bad URL with an embedded
 * token) or the stack — both pass through {@link redactExternalText}.
 */
export function describeIpcError(
  channel: string,
  err: unknown,
): {
  message: string;
  fields: { channel: string; message: string; stack?: string };
} {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const message = redactExternalText(rawMessage);
  const rawStack = err instanceof Error ? err.stack : undefined;
  const stack =
    typeof rawStack === "string" ? redactExternalText(rawStack) : undefined;
  return { message, fields: { channel, message, stack } };
}

/**
 * Drop-in replacement for `ipcMain.handle` that wraps the handler in a
 * try/catch: on throw it emits one structured, redacted log line
 * (`log.error("ipc", { channel, message, stack })`) and rethrows a clean
 * `Error` carrying only the redacted message.
 *
 * Return shapes are deliberately NOT altered — successful results pass through
 * untouched, because renderer hooks depend on the existing contracts. Across
 * the IPC boundary Electron already serializes thrown errors down to their
 * message, so collapsing to `new Error(message)` changes nothing the renderer
 * could observe except that secrets are now scrubbed.
 */
export function safeHandle(channel: string, fn: IpcHandler): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...args);
    } catch (err) {
      const { message, fields } = describeIpcError(channel, err);
      log.error("ipc", fields);
      throw new Error(message);
    }
  });
}
