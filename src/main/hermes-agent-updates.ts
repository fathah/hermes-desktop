import { execFile } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  checkHermesUpdate,
  getChangelog,
  getEnhancedPath,
  getInstalledEngineSha,
  HERMES_HOME,
  HERMES_REPO,
  runHermesUpdate,
} from "./installer";
import {
  getHermesAgentUpdateRoutine,
  isHermesAgentUpdateRoutineDue,
  recordHermesAgentUpdateResult,
  suppressHermesAgentUpdateAutoApply,
  type HermesAgentUpdateRoutineResult,
} from "./config";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";
import { isGatewayRunning, isRemoteMode, restartGateway } from "./hermes";
import { stripAnsi } from "./utils";
import { refreshEngineCapabilities } from "./engine-capabilities";
import { verifyAndRecordEngineContract } from "./engine-contract-verify";

export interface HermesAgentUpdateCheckOptions {
  now?: Date;
  autoApply?: boolean;
  onProgress?: Parameters<typeof runHermesUpdate>[0];
  getInstalledSha?: typeof getInstalledEngineSha;
  refreshCapabilities?: typeof refreshEngineCapabilities;
  verifyContract?: typeof verifyAndRecordEngineContract;
  notifyContractBroken?: (message: string) => void;
}

async function gitStatusPorcelain(): Promise<{ ok: boolean; out: string }> {
  if (!existsSync(join(HERMES_REPO, ".git"))) {
    return { ok: false, out: "Hermes Agent is not installed as a git repo." };
  }

  return new Promise((resolve) => {
    execFile(
      "git",
      ["status", "--porcelain"],
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        timeout: 10000,
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            ok: false,
            out:
              stripAnsi(stderr?.toString() || "") ||
              stripAnsi((error as Error).message),
          });
        } else {
          resolve({ ok: true, out: stripAnsi(stdout.toString()).trim() });
        }
      },
    );
  });
}

async function hermesRepoIsClean(): Promise<{
  clean: boolean;
  reason?: string;
  code?: string;
}> {
  const status = await gitStatusPorcelain();
  if (!status.ok) {
    return { clean: false, reason: status.out, code: "repo-status-failed" };
  }
  if (status.out) {
    return {
      clean: false,
      reason: "Hermes Agent repo has uncommitted changes.",
      code: "dirty-repo",
    };
  }
  return { clean: true };
}

function result(
  status: HermesAgentUpdateRoutineResult["status"],
  message: string,
  checkedAt: string,
  extra: Partial<HermesAgentUpdateRoutineResult> = {},
): HermesAgentUpdateRoutineResult {
  return { checkedAt, status, message, ...extra };
}

function skippedUpdateReason(reason: string | undefined): boolean {
  return (
    reason === "not-a-git-repo" ||
    reason === "no-upstream" ||
    reason === "no-head"
  );
}

function checkFailureReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  return skippedUpdateReason(reason) ? reason : "fetch-failed";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function defaultNotifyContractBroken(message: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Notification } = require("electron") as typeof import("electron");
    if (Notification.isSupported && !Notification.isSupported()) return;
    new Notification({
      title: "Hermes Agent contract broken",
      body: message,
    }).show();
  } catch {
    // Best-effort OS notification; persisted update state is authoritative.
  }
}

export async function runHermesAgentUpdateCheck(
  profile?: string,
  options: HermesAgentUpdateCheckOptions = {},
): Promise<HermesAgentUpdateRoutineResult> {
  const now = options.now || new Date();
  const checkedAt = now.toISOString();
  const routine = getHermesAgentUpdateRoutine(profile, now);
  const autoApply = options.autoApply ?? routine.autoApply;
  const getInstalledSha = options.getInstalledSha || getInstalledEngineSha;
  const refreshCapabilities =
    options.refreshCapabilities || refreshEngineCapabilities;
  const verifyContract =
    options.verifyContract || verifyAndRecordEngineContract;
  const notifyContractBroken =
    options.notifyContractBroken || defaultNotifyContractBroken;

  let finalResult: HermesAgentUpdateRoutineResult;

  try {
    if (isRemoteMode()) {
      finalResult = result(
        "skipped",
        "Skipped because Hermes Desktop is connected to a remote or SSH engine.",
        checkedAt,
        {
          phase: "check",
          reason: "remote-mode",
          restartStatus: "not-needed",
        },
      );
    } else {
      const update = await checkHermesUpdate();
      const changelog = update.available ? await getChangelog() : "";

      if (!update.available) {
        const status = update.reason
          ? skippedUpdateReason(update.reason)
            ? "skipped"
            : "error"
          : "current";
        const message = update.reason
          ? `Update check did not complete: ${update.reason}.`
          : "Hermes Agent is already current.";
        finalResult = result(status, message, checkedAt, {
          phase: "check",
          reason: checkFailureReason(update.reason) || "already-current",
          restartStatus: "not-needed",
          localHead: update.localHead,
          upstreamHead: update.upstreamHead,
          changelog,
        });
      } else if (!autoApply) {
        finalResult = result(
          "available",
          "Hermes Agent update available.",
          checkedAt,
          {
            phase: "check",
            reason: "update-available",
            restartStatus: "not-needed",
            localHead: update.localHead,
            upstreamHead: update.upstreamHead,
            behindBy: update.behindBy,
            changelog,
          },
        );
      } else if (routine.autoApplySuppressed) {
        finalResult = result(
          "available",
          "Hermes Agent update available, but auto-apply is paused until you acknowledge the last contract break.",
          checkedAt,
          {
            phase: "check",
            reason: "auto-apply-suppressed",
            restartStatus: "not-needed",
            localHead: update.localHead,
            upstreamHead: update.upstreamHead,
            behindBy: update.behindBy,
            changelog,
          },
        );
      } else {
        const clean = await hermesRepoIsClean();
        if (!clean.clean) {
          finalResult = result(
            "skipped",
            clean.reason || "Skipped because Hermes Agent repo is not clean.",
            checkedAt,
            {
              phase: "update",
              reason: clean.code || "dirty-repo",
              restartStatus: "not-needed",
              localHead: update.localHead,
              upstreamHead: update.upstreamHead,
              behindBy: update.behindBy,
              changelog,
            },
          );
        } else {
          const preUpdateSha = await getInstalledSha();
          try {
            await runHermesUpdate(options.onProgress || (() => {}));
          } catch (err) {
            finalResult = result("error", errorMessage(err), checkedAt, {
              phase: "update",
              reason: "update-failed",
              restartStatus: "not-needed",
              localHead: preUpdateSha || update.localHead,
              upstreamHead: update.upstreamHead,
              behindBy: update.behindBy,
              changelog,
            });
            recordHermesAgentUpdateResult(finalResult, profile);
            return finalResult;
          }

          if (isGatewayRunning(profile)) {
            try {
              const restarted = await restartGateway(profile);
              if (!restarted) {
                throw new Error("gateway restart returned false");
              }
              finalResult = result(
                "updated",
                "Hermes Agent updated successfully.",
                checkedAt,
                {
                  phase: "restart",
                  reason: "restart-succeeded",
                  restartStatus: "restarted",
                  localHead: preUpdateSha || update.localHead,
                  upstreamHead: update.upstreamHead,
                  behindBy: update.behindBy,
                  changelog,
                },
              );
            } catch (err) {
              const restartMessage = errorMessage(err);
              finalResult = result(
                "updated",
                `Hermes Agent updated, but the gateway restart failed: ${restartMessage}`,
                checkedAt,
                {
                  phase: "restart",
                  reason: "restart-failed",
                  restartStatus: "failed",
                  restartMessage,
                  localHead: preUpdateSha || update.localHead,
                  upstreamHead: update.upstreamHead,
                  behindBy: update.behindBy,
                  changelog,
                },
              );
            }
          } else {
            finalResult = result(
              "updated",
              "Hermes Agent updated successfully.",
              checkedAt,
              {
                phase: "update",
                reason: "updated",
                restartStatus: "not-needed",
                localHead: preUpdateSha || update.localHead,
                upstreamHead: update.upstreamHead,
                behindBy: update.behindBy,
                changelog,
              },
            );
          }

          try {
            await refreshCapabilities(profile);
            const contract = await verifyContract(profile);
            if (contract.status === "broken") {
              const brokenSha = await getInstalledSha();
              const message =
                "Hermes Agent updated, but the engine contract has breaking findings. Auto-apply is paused until you acknowledge it.";
              suppressHermesAgentUpdateAutoApply(
                "contract-broken",
                brokenSha || update.upstreamHead || null,
                checkedAt,
                profile,
              );
              notifyContractBroken(message);
              finalResult = result("contract-broken", message, checkedAt, {
                phase: "verify",
                reason: "contract-broken",
                restartStatus: finalResult.restartStatus,
                restartMessage: finalResult.restartMessage,
                localHead: preUpdateSha || update.localHead,
                upstreamHead: update.upstreamHead,
                behindBy: update.behindBy,
                changelog,
                contract,
              });
            } else {
              finalResult = { ...finalResult, contract };
            }
          } catch (err) {
            finalResult = result(
              "error",
              `Hermes Agent updated, but contract verification failed: ${errorMessage(err)}`,
              checkedAt,
              {
                phase: "verify",
                reason: "contract-verification-failed",
                restartStatus: finalResult.restartStatus,
                restartMessage: finalResult.restartMessage,
                localHead: preUpdateSha || update.localHead,
                upstreamHead: update.upstreamHead,
                behindBy: update.behindBy,
                changelog,
              },
            );
          }
        }
      }
    }
  } catch (err) {
    finalResult = result(
      "error",
      err instanceof Error ? err.message : String(err),
      checkedAt,
      {
        phase: "check",
        reason: "fetch-failed",
        restartStatus: "not-needed",
      },
    );
  }

  recordHermesAgentUpdateResult(finalResult, profile);
  return finalResult;
}

export async function maybeRunHermesAgentUpdateRoutine(
  now = new Date(),
  profile?: string,
): Promise<HermesAgentUpdateRoutineResult | null> {
  const routine = getHermesAgentUpdateRoutine(profile, now);
  if (!isHermesAgentUpdateRoutineDue(routine, now)) return null;
  return runHermesAgentUpdateCheck(profile, { now });
}
