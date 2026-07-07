import { BrowserWindow, shell, Notification } from "electron";
import { safeHandle } from "./safe-handle";
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
import { startSshTunnel, isSshTunnelHealthy } from "../ssh-tunnel";
import {
  runChatTurn,
  type ChatTurnSink,
  type ChatTurnEffects,
} from "../chat-orchestrator";
import { saveAssistantMessageMetadata } from "../messages-metadata";
import { adoptCouncilResponse } from "../sessions";
import { recordUsage } from "../usage-store";
import { canAutoApprove } from "../autonomy";
import { appendAuditLog } from "../audit-log";
import { appendActionReceipt } from "../action-receipts";
import { validateChatReadiness } from "../validation";
import {
  runConfigHealthCheck,
  autoFixIssue,
  readConfigFixLog,
  type IssueCode,
} from "../config-health";
import { getRoutinesStatus } from "../routines-status";
import { getVoiceStatus, transcribeAudio, speakText } from "../voice";
import { formatLogError, log } from "../log";
import type { Attachment } from "../../shared/attachments";

export const activeChatAborts = new Map<string, () => void>();

function payloadId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const id = (payload as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() ? id : undefined;
}

export function abortAllChats(): void {
  for (const abort of activeChatAborts.values()) {
    try {
      abort();
    } catch (e) {
      log.error("chat", {
        msg: "failed to abort chat",
        error: formatLogError(e),
      });
    }
  }
  activeChatAborts.clear();
}

/**
 * Ensure the chat transport is reachable before sending: start the local
 * gateway if needed, and in SSH mode bring up the remote gateway + tunnel and
 * fetch the remote API key. Extracted verbatim from the send-message handler.
 */
async function ensureChatGatewayReady(profile?: string): Promise<void> {
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
}

export function registerChatIpc(
  mainWindowGetter: () => BrowserWindow | null,
): void {
  // Pre-send chat readiness
  safeHandle("validate-chat-readiness", (_event, profile?: string) => {
    return validateChatReadiness(profile);
  });

  // Config-health audit
  safeHandle("get-config-health", (_event, profile?: string) => {
    return runConfigHealthCheck(profile);
  });

  safeHandle("rerun-config-health", (_event, profile?: string) => {
    return runConfigHealthCheck(profile);
  });

  safeHandle(
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

  safeHandle("get-config-fix-log", (_event, maxEntries?: number) => {
    return readConfigFixLog(maxEntries);
  });

  safeHandle("get-routines-status", (_event, profile?: string) => {
    return getRoutinesStatus(profile);
  });

  // Chat sending and abortion
  safeHandle(
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
      modelOverride?: { model?: string; provider?: string; baseUrl?: string },
    ) => {
      await ensureChatGatewayReady(profile);

      const sessionKey =
        resumeSessionId || clientRunId || `sender-${event.sender.id}`;
      const chatStartTime = Date.now();

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

      const sink: ChatTurnSink = {
        emit: (channel, payload) => {
          if (event.sender.isDestroyed()) return false;
          try {
            if (channel === "chat-tool-progress") {
              appendActionReceipt(
                {
                  source: "assistant",
                  action: "tool-progress",
                  outcome: "progress",
                  summary: payload,
                  refs: clientRunId
                    ? [{ kind: "client-run", id: clientRunId }]
                    : undefined,
                },
                profile,
              );
            } else if (channel === "chat-approval-request") {
              appendActionReceipt(
                {
                  source: "assistant",
                  action: "approval",
                  outcome: "requested",
                  summary: "Approval requested",
                  refs: payloadId(payload)
                    ? [{ kind: "run", id: payloadId(payload) }]
                    : undefined,
                },
                profile,
              );
            }
            event.sender.send(channel, payload, clientRunId);
            return true;
          } catch {
            return false;
          }
        },
      };

      const effects: ChatTurnEffects = {
        recordUsage: (usage) => {
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
        persistAssistantMetadata: (sessionId) => {
          saveAssistantMessageMetadata({
            sessionId,
            profile,
            modelOverride,
            clientRunId,
          });
        },
        maybeAutoApprove: (req) => {
          if (getAutoApprove(profile) && canAutoApprove(req)) {
            void respondRunApproval(req.id, "once", profile);
            appendAuditLog({
              ts: Date.now(),
              action: "auto-approve",
              command: req.command,
              runId: req.id,
              profile: profile || "default",
            });
            appendActionReceipt(
              {
                source: "assistant",
                action: "approval",
                outcome: "auto-approved",
                summary: "Auto-approved command",
                refs: [{ kind: "run", id: req.id }],
              },
              profile,
            );
            log.info("autonomy", {
              msg: "auto-approved",
              command: req.command,
              runId: req.id,
              profile: profile || "default",
            });
            return true;
          }
          return false;
        },
        playCompletionSound: () => {
          if (getCompletionSound()) shell.beep();
        },
        notifyComplete: (response) => {
          if (
            mainWindowGetter() &&
            !mainWindowGetter()!.isFocused() &&
            Date.now() - chatStartTime > 10000
          ) {
            const preview = response
              .replace(/[#*_`~\n]+/g, " ")
              .trim()
              .slice(0, 80);
            new Notification({
              title: "Hermes Agent",
              body: preview || "Response ready",
            }).show();
          }
        },
        notifyError: (error) => {
          if (mainWindowGetter() && !mainWindowGetter()!.isFocused()) {
            new Notification({
              title: "Hermes Agent — Error",
              body: error.slice(0, 100),
            }).show();
          }
        },
      };

      return runChatTurn(
        {
          message,
          profile,
          resumeSessionId,
          history,
          attachments,
          contextFolder,
          groundInWorkspace,
          clientRunId,
          modelOverride,
        },
        {
          transport: sendMessage,
          sink,
          effects,
          abortRegistry: activeChatAborts,
          sessionKey,
          secretsToRedact,
        },
      );
    },
  );

  safeHandle("abort-chat", (event, sessionId?: string) => {
    const sessionKey = sessionId || `sender-${event.sender.id}`;
    const abort = activeChatAborts.get(sessionKey);
    if (abort) {
      abort();
      activeChatAborts.delete(sessionKey);
    }
  });

  safeHandle(
    "adopt-council-response",
    (_event, messageId: number, sessionId: string, councilGroupId: string) => {
      return adoptCouncilResponse(messageId, sessionId, councilGroupId);
    },
  );

  // Voice I/O (WS4)
  safeHandle("get-voice-status", (_event, profile?: string) =>
    getVoiceStatus(profile),
  );
  safeHandle(
    "transcribe-audio",
    (_event, audio: ArrayBuffer, mime: string, profile?: string) =>
      transcribeAudio(audio, mime, profile),
  );
  safeHandle(
    "speak-text",
    (_event, text: string, voice: string | undefined, profile?: string) =>
      speakText(text, voice, profile),
  );
}
