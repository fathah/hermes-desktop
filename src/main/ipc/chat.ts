import { ipcMain, BrowserWindow, shell, Notification } from "electron";
import {
  isRemoteMode,
  isGatewayRunning,
  startGateway,
  ensureSshTunnelIfNeeded,
  getRemoteAuthHeader,
  setSshRemoteApiKey,
  sendMessage,
  respondRunApproval,
} from "../hermes";
import {
  getConnectionConfig,
  getApiServerKey,
  getCompletionSound,
  getAutoApprove,
} from "../config";
import {
  sshGatewayStatus,
  sshStartGateway,
  sshReadRemoteApiKey,
} from "../ssh-remote";
import {
  startSshTunnel,
  isSshTunnelHealthy,
} from "../ssh-tunnel";
import { StreamRedactor } from "../redactor";
import { recordUsage } from "../usage-store";
import { canAutoApprove } from "../autonomy";
import { appendAuditLog } from "../index";
import { validateChatReadiness } from "../validation";
import {
  runConfigHealthCheck,
  autoFixIssue,
  readConfigFixLog,
  type IssueCode,
} from "../config-health";
import { getVoiceStatus, transcribeAudio, speakText } from "../voice";
import { checkOpenClawExists, runClawMigrate, type InstallProgress } from "../installer";
import type { Attachment } from "../../shared/attachments";

export const activeChatAborts = new Map<string, () => void>();

export function abortAllChats(): void {
  for (const abort of activeChatAborts.values()) {
    try {
      abort();
    } catch (e) {
      console.error("[chat] Failed to abort chat:", e);
    }
  }
  activeChatAborts.clear();
}

export function registerChatIpc(mainWindowGetter: () => BrowserWindow | null): void {
  // Pre-send chat readiness
  ipcMain.handle("validate-chat-readiness", (_event, profile?: string) => {
    return validateChatReadiness(profile);
  });

  // Config-health audit
  ipcMain.handle("get-config-health", (_event, profile?: string) => {
    return runConfigHealthCheck(profile);
  });

  ipcMain.handle("rerun-config-health", (_event, profile?: string) => {
    return runConfigHealthCheck(profile);
  });

  ipcMain.handle(
    "autofix-config-issue",
    (
      _event,
      code: IssueCode,
      profile?: string,
      context?: Record<string, string>,
    ) => {
      return autoFixIssue(code, profile, context);
    },
  );

  ipcMain.handle("get-config-fix-log", (_event, maxEntries?: number) => {
    return readConfigFixLog(maxEntries);
  });

  // Chat sending and abortion
  ipcMain.handle(
    "send-message",
    async (
      event,
      message: string,
      profile?: string,
      resumeSessionId?: string,
      history?: Array<{ role: string; content: string }>,
      attachments?: Attachment[],
      contextFolder?: string,
      groundInWorkspace?: boolean,
      clientRunId?: string,
    ) => {
      if (!isRemoteMode() && !isGatewayRunning(profile)) {
        startGateway(profile);
      }

      await ensureSshTunnelIfNeeded();
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        const gatewayRunning = await sshGatewayStatus(conn.ssh);
        const tunnelHealthy = await isSshTunnelHealthy();
        if (!gatewayRunning || !tunnelHealthy) {
          await sshStartGateway(conn.ssh);
          await startSshTunnel(conn.ssh);
        }
        if (!getRemoteAuthHeader().Authorization) {
          const key = await sshReadRemoteApiKey(conn.ssh);
          setSshRemoteApiKey(key);
        }
      }

      const sessionKey =
        resumeSessionId || clientRunId || `sender-${event.sender.id}`;

      const existing = activeChatAborts.get(sessionKey);
      if (existing) {
        existing();
      }

      let fullResponse = "";
      const chatStartTime = Date.now();
      let resolveChat: (v: { response: string; sessionId?: string }) => void;
      let rejectChat: (reason?: unknown) => void;
      const promise = new Promise<{ response: string; sessionId?: string }>(
        (res, rej) => {
          resolveChat = res;
          rejectChat = rej;
        },
      );

      const secretsToRedact: string[] = [];
      const apiServerKey = getApiServerKey(profile);
      if (apiServerKey) {
        secretsToRedact.push(apiServerKey);
      }
      const remoteAuth = getRemoteAuthHeader();
      if (remoteAuth.Authorization) {
        const match = remoteAuth.Authorization.match(/^Bearer\s+(.+)$/);
        if (match && match[1]) {
          secretsToRedact.push(match[1]);
        }
      }
      const contentRedactor = new StreamRedactor(secretsToRedact);
      const reasoningRedactor = new StreamRedactor(secretsToRedact);

      const safeSend = (channel: string, payload: unknown): boolean => {
        if (event.sender.isDestroyed()) return false;
        try {
          event.sender.send(channel, payload, clientRunId);
          return true;
        } catch {
          return false;
        }
      };

      const handle = await sendMessage(
        message,
        {
          onChunk: (chunk) => {
            const { chunkToEmit } = contentRedactor.process(chunk);
            if (chunkToEmit) {
              fullResponse += chunkToEmit;
              if (!safeSend("chat-chunk", chunkToEmit)) {
                const abort = activeChatAborts.get(sessionKey);
                if (abort) abort();
              }
            }
          },
          onReasoningChunk: (chunk) => {
            const { chunkToEmit } = reasoningRedactor.process(chunk);
            if (chunkToEmit) {
              if (!safeSend("chat-reasoning-chunk", chunkToEmit)) {
                const abort = activeChatAborts.get(sessionKey);
                if (abort) abort();
              }
            }
          },
          onDone: (sessionId) => {
            const contentFlush = contentRedactor.flush();
            if (contentFlush) {
              fullResponse += contentFlush;
              safeSend("chat-chunk", contentFlush);
            }
            const reasoningFlush = reasoningRedactor.flush();
            if (reasoningFlush) {
              safeSend("chat-reasoning-chunk", reasoningFlush);
            }
            activeChatAborts.delete(sessionKey);
            safeSend("chat-done", sessionId || "");
            if (getCompletionSound()) shell.beep();
            resolveChat({ response: fullResponse, sessionId });
            if (
              mainWindowGetter() &&
              !mainWindowGetter()!.isFocused() &&
              Date.now() - chatStartTime > 10000
            ) {
              const preview = fullResponse
                .replace(/[#*_`~\n]+/g, " ")
                .trim()
                .slice(0, 80);
              new Notification({
                title: "Hermes Agent",
                body: preview || "Response ready",
              }).show();
            }
          },
          onError: (error) => {
            contentRedactor.flush();
            reasoningRedactor.flush();
            activeChatAborts.delete(sessionKey);
            safeSend("chat-error", error);
            rejectChat(new Error(error));
            if (mainWindowGetter() && !mainWindowGetter()!.isFocused()) {
              new Notification({
                title: "Hermes Agent — Error",
                body: error.slice(0, 100),
              }).show();
            }
          },
          onToolProgress: (tool) => {
            safeSend("chat-tool-progress", tool);
          },
          onUsage: (usage) => {
            safeSend("chat-usage", usage);
            recordUsage(
              {
                sessionId: usage.sessionId ?? resumeSessionId,
                model: usage.model,
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens,
                cost: usage.cost,
                cacheRead: usage.cacheRead,
                cacheWrite: usage.cacheWrite,
              },
              { profile },
            );
          },
          onApprovalRequest: (req) => {
            if (getAutoApprove(profile) && canAutoApprove(req)) {
              void respondRunApproval(req.id, "once", profile);
              appendAuditLog({
                ts: Date.now(),
                action: "auto-approve",
                command: req.command,
                runId: req.id,
                profile: profile || "default",
              });
              console.log(`[autonomy] auto-approved: ${req.command ?? req.id}`);
              safeSend("chat-approval-auto", { ...req, sessionKey });
              return;
            }
            safeSend("chat-approval-request", { ...req, sessionKey });
          },
          onCheckpoint: (cp) => {
            safeSend("chat-checkpoint", { ...cp, sessionKey });
          },
          onDelegateProgress: (p) => {
            safeSend("chat-delegate-progress", { ...p, sessionKey });
          },
        },
        profile,
        resumeSessionId,
        history,
        attachments,
        contextFolder,
        groundInWorkspace,
      );

      activeChatAborts.set(sessionKey, handle.abort);
      return promise;
    },
  );

  ipcMain.handle("abort-chat", (event, sessionId?: string) => {
    const sessionKey = sessionId || `sender-${event.sender.id}`;
    const abort = activeChatAborts.get(sessionKey);
    if (abort) {
      abort();
      activeChatAborts.delete(sessionKey);
    }
  });

  // Voice I/O (WS4)
  ipcMain.handle("get-voice-status", (_event, profile?: string) =>
    getVoiceStatus(profile),
  );
  ipcMain.handle(
    "transcribe-audio",
    (_event, audio: ArrayBuffer, mime: string, profile?: string) =>
      transcribeAudio(audio, mime, profile),
  );
  ipcMain.handle(
    "speak-text",
    (_event, text: string, voice: string | undefined, profile?: string) =>
      speakText(text, voice, profile),
  );

  // OpenClaw migration
  ipcMain.handle("check-openclaw", () => checkOpenClawExists());
  ipcMain.handle("run-claw-migrate", async (event) => {
    try {
      await runClawMigrate((progress: InstallProgress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("install-progress", progress);
        }
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
