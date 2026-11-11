import { randomBytes } from "crypto";
import http from "http";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import {
  gatewayRequestRecord,
  parseGatewayServerRequest,
  type GatewayServerRequest,
} from "../shared/gateway-server-requests";

export interface DashboardWebSocketRelayOptions {
  acceptTimeoutMs?: number;
  connectTimeoutMs?: number;
  collectSensitiveRequest?: (
    request: GatewayServerRequest,
    signal: AbortSignal,
  ) => Promise<{ value: string } | null>;
}

const RENDERER_SAFE_WS_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function dashboardWebSocketUrlNeedsRelay(rawUrl: string): boolean {
  const url = new URL(rawUrl);
  return url.protocol === "ws:" && !RENDERER_SAFE_WS_HOSTS.has(url.hostname);
}

function rejectUpgrade(socket: NodeJS.ReadWriteStream, status: string): void {
  socket.write(
    `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.end();
}

function validCloseCode(code: number): boolean {
  return code === 1000 || (code >= 3000 && code <= 4999);
}

function closePeer(peer: WebSocket, code: number, reason: Buffer): void {
  if (peer.readyState !== WebSocket.OPEN) return;
  if (validCloseCode(code)) peer.close(code, reason.toString("utf8"));
  else peer.close();
}

function forwardFrame(peer: WebSocket, data: RawData, isBinary: boolean): void {
  if (peer.readyState !== WebSocket.OPEN) return;
  peer.send(data, { binary: isBinary }, (error) => {
    if (error) peer.terminate();
  });
}

function frameObject(
  data: RawData,
  isBinary: boolean,
): Record<string, unknown> | null {
  if (isBinary) return null;
  try {
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString("utf8")
      : Buffer.isBuffer(data)
        ? data.toString("utf8")
        : Buffer.from(data).toString("utf8");
    return gatewayRequestRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function bridgeWebSockets(
  renderer: WebSocket,
  target: WebSocket,
  options: DashboardWebSocketRelayOptions,
): void {
  const sensitive = new Map<string, AbortController>();
  const sensitiveSessions = new Map<string, string>();
  const retired = new Set<string>();
  let live = true;
  let prompts = Promise.resolve();
  const retire = (id: string): void => {
    retired.add(id);
    if (retired.size > 512) retired.delete(retired.values().next().value!);
  };
  const cancel = (id: string, sessionId?: string): void => {
    if (
      sessionId &&
      sensitive.has(id) &&
      sensitiveSessions.get(id) !== sessionId
    )
      return;
    sensitive.get(id)?.abort();
    sensitive.delete(id);
    sensitiveSessions.delete(id);
    retire(id);
  };
  const close = (): void => {
    live = false;
    for (const controller of sensitive.values()) controller.abort();
    sensitive.clear();
    sensitiveSessions.clear();
    retired.clear();
  };
  const answer = (id: string, response: Record<string, unknown>): void => {
    if (!live || target.readyState !== WebSocket.OPEN) return;
    try {
      target.send(JSON.stringify({ jsonrpc: "2.0", id, ...response }));
    } catch {
      /* The disconnected request cannot be answered later on another socket. */
    }
  };
  renderer.on("message", (data, isBinary) => {
    const frame = frameObject(data, isBinary);
    // The chat renderer never owns password RPCs or their responses.
    if (
      typeof frame?.id === "string" &&
      (sensitive.has(frame.id) || retired.has(frame.id))
    )
      return;
    forwardFrame(target, data, isBinary);
  });
  const consumeSensitiveRequest = (request: GatewayServerRequest): boolean => {
    if (
      ![
        "sudo",
        "secret",
        "vault.unlock_prompt",
        "vault.code",
        "vault.save_login",
      ].includes(request.method)
    )
      return false;
    if (sensitive.has(request.id) || retired.has(request.id)) return true;
    if (!request.sessionId.trim()) {
      retire(request.id);
      answer(request.id, {
        error: {
          code: -32602,
          message: "Sensitive input requires an owning chat session.",
        },
      });
      return true;
    }
    if (request.method === "vault.save_login" || sensitive.size >= 32) {
      retire(request.id);
      answer(request.id, {
        error: {
          code: -32601,
          message:
            "This sensitive interaction is not supported by this desktop.",
        },
      });
      return true;
    }
    const controller = new AbortController();
    sensitive.set(request.id, controller);
    sensitiveSessions.set(request.id, request.sessionId);
    prompts = prompts.then(async () => {
      if (!live || controller.signal.aborted) return;
      const collect =
        options.collectSensitiveRequest ??
        (async (value, signal) => {
          const { collectGatewayRequestValue } =
            await import("./gatewayPrompt");
          return collectGatewayRequestValue(value, signal);
        });
      try {
        const result = await collect(request, controller.signal);
        if (
          !live ||
          controller.signal.aborted ||
          sensitive.get(request.id) !== controller
        )
          return;
        answer(
          request.id,
          result
            ? { result }
            : {
                error: {
                  code: -32601,
                  message:
                    "This sensitive interaction is not supported by this desktop.",
                },
              },
        );
      } catch {
        if (live && !controller.signal.aborted) {
          answer(request.id, {
            error: {
              code: -32603,
              message: "The sensitive interaction could not be completed.",
            },
          });
        }
      } finally {
        if (sensitive.get(request.id) === controller) {
          sensitive.delete(request.id);
          sensitiveSessions.delete(request.id);
        }
        retire(request.id);
      }
    });
    return true;
  };
  target.on("message", (data, isBinary) => {
    const frame = frameObject(data, isBinary);
    const params = gatewayRequestRecord(frame?.params);
    if (frame?.method === "event" && params?.type === "request.cancel") {
      const id = gatewayRequestRecord(params.payload)?.id;
      if (typeof id === "string")
        cancel(
          id,
          typeof params.session_id === "string" ? params.session_id : undefined,
        );
    }
    const result = gatewayRequestRecord(frame?.result);
    if (frame && Array.isArray(result?.open_requests)) {
      const openRequests = result.open_requests.filter((entry) => {
        const request = parseGatewayServerRequest(entry);
        return !request || !consumeSensitiveRequest(request);
      });
      if (openRequests.length !== result.open_requests.length) {
        forwardFrame(
          renderer,
          Buffer.from(
            JSON.stringify({
              ...frame,
              result: { ...result, open_requests: openRequests },
            }),
          ),
          false,
        );
        return;
      }
    }
    const request = parseGatewayServerRequest(frame);
    if (request && consumeSensitiveRequest(request)) return;
    forwardFrame(renderer, data, isBinary);
  });
  renderer.once("close", close);
  target.once("close", close);
  renderer.once("close", (code, reason) => closePeer(target, code, reason));
  target.once("close", (code, reason) => closePeer(renderer, code, reason));
  renderer.on("error", () => target.terminate());
  target.on("error", () => renderer.terminate());
}

export function createLoopbackWebSocketRelay(
  targetUrl: string,
  options: DashboardWebSocketRelayOptions = {},
): Promise<string> {
  const target = new URL(targetUrl);
  if (target.protocol !== "ws:" && target.protocol !== "wss:") {
    return Promise.reject(
      new Error("Dashboard WebSocket relay target must use WS(S)."),
    );
  }

  const capabilityPath = `/${randomBytes(32).toString("hex")}`;
  const acceptTimeoutMs = options.acceptTimeoutMs ?? 15_000;
  const connectTimeoutMs = options.connectTimeoutMs ?? 8_000;

  return new Promise((resolve, reject) => {
    const relay = http.createServer((_request, response) => {
      response.writeHead(404).end();
    });
    const sockets = new WebSocketServer({ noServer: true });
    let accepted = false;
    let listening = false;
    let listenerClosed = false;
    let acceptTimer: NodeJS.Timeout | undefined;

    const closeListener = (): void => {
      if (acceptTimer) clearTimeout(acceptTimer);
      if (listening && !listenerClosed) {
        listenerClosed = true;
        relay.close();
      }
    };

    relay.on("error", (error) => {
      closeListener();
      if (!listening) reject(error);
    });

    relay.on("upgrade", (request, socket, head) => {
      if (accepted || request.url !== capabilityPath) {
        rejectUpgrade(socket, "404 Not Found");
        return;
      }
      accepted = true;
      if (acceptTimer) clearTimeout(acceptTimer);

      const upstream = new WebSocket(target.toString());
      let handshakeSettled = false;
      const failHandshake = (status: string): void => {
        if (handshakeSettled) return;
        handshakeSettled = true;
        clearTimeout(connectTimer);
        if (!socket.destroyed) rejectUpgrade(socket, status);
        closeListener();
      };
      const connectTimer = setTimeout(() => {
        upstream.terminate();
        failHandshake("504 Gateway Timeout");
      }, connectTimeoutMs);
      connectTimer.unref?.();

      upstream.once("open", () => {
        if (handshakeSettled) return;
        handshakeSettled = true;
        clearTimeout(connectTimer);
        sockets.handleUpgrade(request, socket, head, (renderer) => {
          closeListener();
          bridgeWebSockets(renderer, upstream, options);
        });
      });
      upstream.once("error", () => {
        failHandshake("502 Bad Gateway");
      });
      upstream.once("close", () => {
        failHandshake("502 Bad Gateway");
      });
      socket.once("close", () => {
        if (upstream.readyState !== WebSocket.OPEN) {
          upstream.terminate();
          failHandshake("502 Bad Gateway");
        }
      });
    });

    relay.listen(0, "127.0.0.1", () => {
      listening = true;
      const address = relay.address();
      if (typeof address === "string" || address === null) {
        closeListener();
        reject(new Error("Could not allocate dashboard WebSocket relay port."));
        return;
      }
      relay.unref();
      acceptTimer = setTimeout(closeListener, acceptTimeoutMs);
      acceptTimer.unref?.();
      resolve(`ws://127.0.0.1:${address.port}${capabilityPath}`);
    });
  });
}

export async function dashboardWebSocketUrlForRenderer(
  targetUrl: string,
): Promise<string> {
  // All transports use the main-process boundary, including Local and WSS:
  // sudo/password answers must never cross the chat renderer.
  return createLoopbackWebSocketRelay(targetUrl);
}
