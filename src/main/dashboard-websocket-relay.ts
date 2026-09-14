import { randomBytes } from "crypto";
import http from "http";
import WebSocket, { WebSocketServer, type RawData } from "ws";

export interface DashboardWebSocketRelayOptions {
  acceptTimeoutMs?: number;
  connectTimeoutMs?: number;
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

function bridgeWebSockets(renderer: WebSocket, target: WebSocket): void {
  renderer.on("message", (data, isBinary) =>
    forwardFrame(target, data, isBinary),
  );
  target.on("message", (data, isBinary) =>
    forwardFrame(renderer, data, isBinary),
  );
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
          bridgeWebSockets(renderer, upstream);
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
  return dashboardWebSocketUrlNeedsRelay(targetUrl)
    ? createLoopbackWebSocketRelay(targetUrl)
    : targetUrl;
}
