export type BridgePayload = Record<string, unknown>;

export interface BridgeHandlers {
  status: (payload: BridgePayload) => Promise<unknown> | unknown;
  activeNote: (payload: BridgePayload) => Promise<unknown> | unknown;
  openNote: (payload: BridgePayload) => Promise<unknown> | unknown;
  insertAtCursor: (payload: BridgePayload) => Promise<unknown> | unknown;
  replaceSelection: (payload: BridgePayload) => Promise<unknown> | unknown;
  runCommand: (payload: BridgePayload) => Promise<unknown> | unknown;
  writeNote: (payload: BridgePayload) => Promise<unknown> | unknown;
}

type HeaderBag = Headers | Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderBag, name: string): string {
  if (headers instanceof Headers) return headers.get(name) ?? "";
  const direct = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(direct) ? (direct[0] ?? "") : (direct ?? "");
}

export function isAuthorizedBridgeRequest(
  headers: HeaderBag,
  token: string,
): boolean {
  return (
    token.length > 0 &&
    headerValue(headers, "X-Hermes-Obsidian-Token") === token
  );
}

export async function dispatchBridgeFunction(
  name: string,
  payload: BridgePayload,
  handlers: BridgeHandlers,
): Promise<unknown> {
  switch (name) {
    case "status":
      return handlers.status(payload);
    case "active-note":
      return handlers.activeNote(payload);
    case "open-note":
      return handlers.openNote(payload);
    case "insert-at-cursor":
      return handlers.insertAtCursor(payload);
    case "replace-selection":
      return handlers.replaceSelection(payload);
    case "run-command":
      return handlers.runCommand(payload);
    case "write-note":
      return handlers.writeNote(payload);
    default:
      throw new Error("Unsupported Obsidian bridge function");
  }
}
