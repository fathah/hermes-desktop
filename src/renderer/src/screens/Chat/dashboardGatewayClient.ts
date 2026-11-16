import {
  GATEWAY_WINDOW_REQUESTS,
  gatewayClarifyResult,
  gatewayRequestRecord,
  normalizeGatewayServerRequestEvent,
  parseGatewayServerRequest,
  type GatewayServerRequest,
} from "../../../../shared/gateway-server-requests";
import {
  normalizeApprovalRequest,
  type ApprovalChoice,
} from "../../../../shared/chat-approval";

export interface DashboardRpcEvent<T = unknown> {
  payload?: T;
  session_id?: string;
  type: string;
}

export interface DashboardGatewayClientOptions {
  /** How long `connect()` waits for the WebSocket handshake before giving up.
   *  Without this, a socket stuck in CONNECTING (TCP accepted but the upgrade
   *  never completes — e.g. when the renderer is starved) leaves the connect
   *  promise pending forever, wedging the whole transport with no error and no
   *  fallback (issue #718). */
  connectTimeoutMs?: number;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
  onEvent?: (event: DashboardRpcEvent) => void;
  requestTimeoutMs?: number;
}

interface JsonRpcResponse<T = unknown> {
  error?: { code?: number; message?: string } | string;
  id: number | string;
  jsonrpc?: "2.0";
  result?: T;
}

interface JsonRpcNotification {
  method?: string;
  params?: unknown;
  type?: string;
  payload?: unknown;
  session_id?: string;
}

interface PendingRequest<T = unknown> {
  method: string;
  reject: (reason: Error) => void;
  resolve: (value: T) => void;
  timeout: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeDashboardNotification(
  value: unknown,
): DashboardRpcEvent | null {
  if (!isRecord(value)) return null;

  const notification = value as JsonRpcNotification;
  if (typeof notification.type === "string") {
    return {
      type: notification.type,
      payload: notification.payload,
      session_id:
        typeof notification.session_id === "string"
          ? notification.session_id
          : undefined,
    };
  }

  if (
    notification.method === "event" &&
    isRecord(notification.params) &&
    typeof notification.params.type === "string"
  ) {
    return {
      type: notification.params.type,
      payload: notification.params.payload,
      session_id:
        typeof notification.params.session_id === "string"
          ? notification.params.session_id
          : undefined,
    };
  }

  if (typeof notification.method === "string") {
    const params = isRecord(notification.params) ? notification.params : {};
    return {
      type: notification.method,
      payload: params.payload,
      session_id:
        typeof params.session_id === "string" ? params.session_id : undefined,
    };
  }

  return null;
}

export class DashboardGatewayClient {
  private nextRequestId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private socket: WebSocket | null = null;
  private serverRequests = new Map<string, GatewayServerRequest>();
  private deliveredRequests = new Set<string>();
  private settledRequests = new Set<string>();
  private activeServerSession: string | null = null;
  private awaitingSessionAdoption = false;
  private readonly requestTimeoutMs: number;
  private readonly connectTimeoutMs: number;

  constructor(private readonly options: DashboardGatewayClientOptions = {}) {
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.connectTimeoutMs =
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(wsUrl: string): Promise<void> {
    this.close();

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      this.socket = socket;
      let settled = false;

      // Bound the handshake: a socket stuck in CONNECTING fires neither `open`
      // nor `error`, so without this timer the promise would never settle and
      // the transport would wedge forever (issue #718). On timeout we reject and
      // close the half-open socket so `ensureClient` can fall back to legacy.
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        if (this.socket === socket) this.socket = null;
        try {
          socket.close();
        } catch {
          // Best-effort teardown of the stalled socket.
        }
        reject(new Error("Hermes dashboard WebSocket connection timed out"));
      }, this.connectTimeoutMs);

      const failOpen = (event: Event): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (this.socket === socket) this.socket = null;
        reject(new Error(`Could not connect to Hermes dashboard WebSocket`));
        this.options.onError?.(event);
      };

      socket.addEventListener(
        "open",
        () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          socket.removeEventListener("error", failOpen);
          // Older Agents reject the unknown method; their event protocol stays available.
          void this.request("client.capabilities", {
            server_requests: true,
          }).catch(() => undefined);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener("error", failOpen, { once: true });
      socket.addEventListener("message", (event) => {
        if (this.socket === socket) this.handleMessage(event);
      });
      socket.addEventListener("close", (event) => {
        const ownsSocket = this.socket === socket;
        // A close before the handshake settles must still reject the connect
        // promise — otherwise a CONNECTING→CLOSED transition with no `error`
        // event would hang it until the timeout fires.
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error("Hermes dashboard WebSocket closed"));
        }
        if (!ownsSocket) return;
        this.socket = null;
        this.clearServerRequests();
        this.rejectPending("Hermes dashboard WebSocket closed");
        this.options.onClose?.(event);
      });
    });
  }

  request<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new Error("Hermes dashboard WebSocket is not connected"),
      );
    }

    if (
      (method === "approval.respond" || method === "clarify.respond") &&
      typeof params.request_id === "string" &&
      params.request_id.startsWith("srq-")
    ) {
      const request = this.serverRequests.get(params.request_id);
      if (!request || request.sessionId !== this.activeServerSession) {
        return Promise.reject(new Error("Hermes request is no longer open"));
      }
      let result: Record<string, unknown> | null = null;
      if (
        method === "clarify.respond" &&
        request.method === "clarify" &&
        typeof params.answer === "string"
      ) {
        result = gatewayClarifyResult(request, params.answer);
      } else if (
        method === "approval.respond" &&
        request.method === "approval"
      ) {
        const choices = normalizeApprovalRequest(
          request.params,
          request.id,
        ).choices;
        if (
          choices.includes(params.choice as ApprovalChoice) &&
          ["once", "session", "always", "deny"].includes(String(params.choice))
        ) {
          result = { choice: params.choice, all: false };
        }
      }
      if (!result || !this.respondServerRequest(request.id, result)) {
        return Promise.reject(
          new Error("Hermes request answer could not be delivered"),
        );
      }
      return Promise.resolve(
        (method === "approval.respond"
          ? { resolved: 1 }
          : { status: "ok" }) as T,
      );
    }

    const id = this.nextRequestId++;
    const message = { jsonrpc: "2.0", id, method, params };
    const sessionHandoff = [
      "session.create",
      "session.resume",
      "session.activate",
    ].includes(method);
    if (sessionHandoff) this.awaitingSessionAdoption = true;

    return new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        if (sessionHandoff) this.finishFailedSessionHandoff();
        reject(new Error(`Hermes dashboard request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value: unknown) => resolve(value as T),
        reject,
        timeout,
      });
      try {
        socket.send(JSON.stringify(message));
      } catch (error) {
        this.pending.delete(id);
        if (sessionHandoff) this.finishFailedSessionHandoff();
        window.clearTimeout(timeout);
        reject(
          error instanceof Error
            ? error
            : new Error("Hermes dashboard send failed"),
        );
      }
    });
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    this.clearServerRequests();
    this.rejectPending("Hermes dashboard WebSocket closed");
    if (
      socket &&
      (socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.OPEN)
    ) {
      socket.close();
    }
  }

  /** Bind replayed requests only after the caller has adopted the resumed runtime identity. */
  activateServerRequests(sessionId: string): void {
    this.activeServerSession = sessionId;
    this.awaitingSessionAdoption = false;
    for (const request of this.serverRequests.values()) {
      if (request.sessionId !== sessionId) {
        this.serverRequests.delete(request.id);
        this.deliveredRequests.delete(request.id);
        this.rejectServerRequest(
          request.id,
          4404,
          "This chat does not own the requested interaction.",
        );
      } else this.deliverServerRequest(request);
    }
  }

  private hasPendingSessionHandoff(): boolean {
    return [...this.pending.values()].some(({ method }) =>
      ["session.create", "session.resume", "session.activate"].includes(method),
    );
  }

  private finishFailedSessionHandoff(): void {
    this.awaitingSessionAdoption = this.hasPendingSessionHandoff();
    if (this.awaitingSessionAdoption) return;
    if (this.activeServerSession) {
      this.activateServerRequests(this.activeServerSession);
      return;
    }
    for (const request of this.serverRequests.values()) {
      this.serverRequests.delete(request.id);
      this.deliveredRequests.delete(request.id);
      this.rejectServerRequest(
        request.id,
        4404,
        "The requested session could not be adopted.",
      );
    }
  }

  respondServerRequest(id: string, result: Record<string, unknown>): boolean {
    const request = this.serverRequests.get(id);
    const socket = this.socket;
    if (!request || !socket || socket.readyState !== WebSocket.OPEN)
      return false;
    try {
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
    } catch {
      return false;
    }
    this.serverRequests.delete(id);
    this.deliveredRequests.delete(id);
    this.rememberSettled(id);
    return true;
  }

  private rememberSettled(id: string): void {
    this.settledRequests.add(id);
    if (this.settledRequests.size > 512)
      this.settledRequests.delete(this.settledRequests.values().next().value!);
  }

  private clearServerRequests(): void {
    this.serverRequests.clear();
    this.deliveredRequests.clear();
    this.settledRequests.clear();
    this.activeServerSession = null;
    this.awaitingSessionAdoption = false;
  }

  private rejectServerRequest(id: string, code: number, message: string): void {
    this.rememberSettled(id);
    try {
      this.socket?.send(
        JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
      );
    } catch {
      /* Disconnected requests are restored by the Agent. */
    }
  }

  private receiveServerRequest(value: unknown, replay = false): void {
    const frame = gatewayRequestRecord(value);
    const request = parseGatewayServerRequest(value);
    if (!request) {
      if (typeof frame?.id === "string")
        this.rejectServerRequest(
          frame.id,
          -32602,
          "Invalid Hermes server request",
        );
      return;
    }
    // A snapshot captured before an answer/cancel cannot reopen it on the same socket.
    // A real reconnect clears these tombstones and may restore an unreceived answer.
    if (this.settledRequests.has(request.id)) return;
    const existing = this.serverRequests.get(request.id);
    if (existing && !replay) return;
    // Secrets are consumed and answered by the main-process relay before this boundary.
    if (
      !request.sessionId ||
      !["approval", "clarify"].includes(request.method)
    ) {
      this.rejectServerRequest(
        request.id,
        GATEWAY_WINDOW_REQUESTS.has(request.method) ? 4404 : -32601,
        "This Hermes Desktop surface cannot answer this request.",
      );
      return;
    }
    if (!normalizeGatewayServerRequestEvent(request)) {
      this.rejectServerRequest(request.id, -32602, "Invalid Hermes question");
      return;
    }
    if (
      this.activeServerSession &&
      request.sessionId !== this.activeServerSession &&
      !this.awaitingSessionAdoption
    ) {
      this.rejectServerRequest(
        request.id,
        4404,
        "This chat does not own the requested interaction.",
      );
      return;
    }
    if (existing) {
      const identity = (value: GatewayServerRequest): string =>
        JSON.stringify([
          value.method,
          value.sessionId,
          Object.entries(value.params)
            .filter(
              ([key]) => !["answers", "server_request_replay"].includes(key),
            )
            .sort(([a], [b]) => a.localeCompare(b)),
        ]);
      if (identity(existing) !== identity(request)) {
        this.serverRequests.delete(request.id);
        this.deliveredRequests.delete(request.id);
        this.options.onEvent?.({
          type: `${existing.method}.expire`,
          session_id: existing.sessionId,
          payload: { request_id: existing.id },
        });
        this.rejectServerRequest(
          request.id,
          -32602,
          "A pending interaction changed its identity.",
        );
        return;
      }
      if (request.method === "approval") return;
      const before = gatewayRequestRecord(existing.params.answers) ?? {};
      const incoming = gatewayRequestRecord(request.params.answers) ?? {};
      const additions = Object.entries(incoming).filter(
        ([key]) => !Object.hasOwn(before, key),
      );
      if (!additions.length) return;
      request.params = {
        ...request.params,
        answers: Object.fromEntries([...Object.entries(before), ...additions]),
      };
      this.deliveredRequests.delete(request.id);
    }
    if (
      this.serverRequests.size >= 128 &&
      !this.serverRequests.has(request.id)
    ) {
      this.rejectServerRequest(
        request.id,
        -32000,
        "Too many pending Hermes requests",
      );
      return;
    }
    this.serverRequests.set(request.id, {
      ...request,
      params: {
        ...request.params,
        ...(replay ? { server_request_replay: true } : {}),
      },
    });
    this.deliverServerRequest(this.serverRequests.get(request.id)!);
  }

  private deliverServerRequest(request: GatewayServerRequest): void {
    if (
      request.sessionId !== this.activeServerSession ||
      this.deliveredRequests.has(request.id)
    )
      return;
    const event = normalizeGatewayServerRequestEvent(request);
    if (!event) return;
    this.deliveredRequests.add(request.id);
    this.options.onEvent?.(event);
  }

  private handleMessage(event: MessageEvent): void {
    let message: unknown;
    try {
      message =
        typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }

    if (isRecord(message) && "id" in message && "method" in message) {
      this.receiveServerRequest(message);
      return;
    }

    if (isRecord(message) && "id" in message && !("method" in message)) {
      this.resolveResponse(message as unknown as JsonRpcResponse);
      return;
    }

    const normalized = normalizeDashboardNotification(message);
    if (normalized?.type === "request.cancel") {
      const payload = gatewayRequestRecord(normalized.payload);
      if (typeof payload?.id === "string") {
        const request = this.serverRequests.get(payload.id);
        if (
          request &&
          normalized.session_id &&
          normalized.session_id !== request.sessionId
        )
          return;
        this.serverRequests.delete(payload.id);
        this.deliveredRequests.delete(payload.id);
        this.rememberSettled(payload.id);
        if (request)
          this.options.onEvent?.({
            type: `${request.method}.expire`,
            session_id: request.sessionId,
            payload: { request_id: request.id },
          });
      }
      return;
    }
    if (normalized) this.options.onEvent?.(normalized);
  }

  private resolveResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    window.clearTimeout(pending.timeout);

    if (response.error) {
      if (
        ["session.create", "session.resume", "session.activate"].includes(
          pending.method,
        )
      )
        this.finishFailedSessionHandoff();
      const message =
        typeof response.error === "string"
          ? response.error
          : response.error.message || "Hermes dashboard request failed";
      pending.reject(new Error(message));
      return;
    }

    if (
      ["session.resume", "session.activate", "session.events.since"].includes(
        pending.method,
      )
    ) {
      const result = gatewayRequestRecord(response.result);
      if (Array.isArray(result?.open_requests)) {
        for (const request of result.open_requests)
          this.receiveServerRequest(request, true);
      }
    }

    pending.resolve(response.result);
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}
