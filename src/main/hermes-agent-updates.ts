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
  rollbackEngineTo,
  runHermesUpdate,
} from "./installer";
import {
  isHermesAgentUpdateRoutineDue,
  getHermesAgentUpdateRoutine,
  recordHermesAgentUpdateResult,
  suppressHermesAgentUpdateAutoApply,
  type HermesAgentUpdateChannel,
  type HermesAgentUpdateRoutineResult,
} from "./engine-update-state";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";
import { isGatewayRunning, isRemoteMode, restartGateway } from "./hermes";
import { stripAnsi } from "./utils";
import { refreshEngineCapabilities } from "./engine-capabilities";
import { verifyAndRecordEngineContract } from "./engine-contract-verify";
import { publicFetch } from "./security/network-policy";

const HERMES_AGENT_GITHUB_API =
  "https://api.github.com/repos/NousResearch/hermes-agent";
const HERMES_AGENT_GIT_URL = "https://github.com/NousResearch/hermes-agent.git";

export interface HermesAgentReleaseTarget {
  tag: string;
  sha: string;
  url?: string;
  name?: string;
}

interface GitHubReleaseResponse {
  tag_name?: string;
  name?: string;
  html_url?: string;
}

interface HermesAgentUpdateCandidate {
  available: boolean;
  channel: HermesAgentUpdateChannel;
  reason?: string;
  localHead?: string;
  upstreamHead?: string;
  behindBy?: number;
  changelog?: string;
  releaseTag?: string;
  releaseSha?: string;
}

export interface HermesAgentUpdateCheckOptions {
  now?: Date;
  autoApply?: boolean;
  onProgress?: Parameters<typeof runHermesUpdate>[0];
  getInstalledSha?: typeof getInstalledEngineSha;
  resolveLatestRelease?: typeof resolveLatestHermesAgentReleaseTarget;
  applyReleaseSha?: (
    sha: string,
    onProgress: Parameters<typeof runHermesUpdate>[0],
  ) => Promise<void>;
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

function sameSha(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function validateResolvedSha(sha: string): string | null {
  return /^[0-9a-f]{40}$/i.test(sha.trim()) ? sha.trim() : null;
}

async function resolveGitTagSha(tag: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [
        "ls-remote",
        "--tags",
        HERMES_AGENT_GIT_URL,
        `refs/tags/${tag}`,
        `refs/tags/${tag}^{}`,
      ],
      {
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        timeout: 15000,
        ...HIDDEN_SUBPROCESS_OPTIONS,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              stripAnsi(stderr?.toString() || "") ||
                stripAnsi((error as Error).message),
            ),
          );
          return;
        }

        const lines = stdout
          .toString()
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const peeled =
          lines.find((line) => line.endsWith(`refs/tags/${tag}^{}`)) ||
          lines.find((line) => line.endsWith(`refs/tags/${tag}`));
        const sha = validateResolvedSha(peeled?.split(/\s+/)[0] || "");
        if (!sha) {
          reject(
            new Error(`Could not resolve release tag ${tag} to a commit SHA.`),
          );
          return;
        }
        resolve(sha);
      },
    );
  });
}

export async function resolveLatestHermesAgentReleaseTarget(): Promise<HermesAgentReleaseTarget> {
  const response = await publicFetch(
    `${HERMES_AGENT_GITHUB_API}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "hermes-desktop-agent-updates",
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `GitHub release request failed: ${response.status} ${response.statusText}`,
    );
  }

  const release = (await response.json()) as GitHubReleaseResponse;
  const tag =
    typeof release.tag_name === "string" ? release.tag_name.trim() : "";
  if (!tag) {
    throw new Error("Latest Hermes Agent release did not include a tag.");
  }

  return {
    tag,
    sha: await resolveGitTagSha(tag),
    url: typeof release.html_url === "string" ? release.html_url : undefined,
    name: typeof release.name === "string" ? release.name : undefined,
  };
}

function releaseChangelog(release: HermesAgentReleaseTarget): string {
  const title =
    release.name && release.name !== release.tag
      ? `${release.tag} - ${release.name}`
      : release.tag;
  return release.url ? `${title}\n${release.url}` : title;
}

async function checkMainChannelUpdate(): Promise<HermesAgentUpdateCandidate> {
  const update = await checkHermesUpdate();
  return {
    ...update,
    channel: "main",
    changelog: update.available ? await getChangelog() : "",
  };
}

async function checkReleaseChannelUpdate(
  getInstalledSha: typeof getInstalledEngineSha,
  resolveLatestRelease: typeof resolveLatestHermesAgentReleaseTarget,
): Promise<HermesAgentUpdateCandidate> {
  const [localHead, release] = await Promise.all([
    getInstalledSha(),
    resolveLatestRelease(),
  ]);
  return {
    available: !sameSha(localHead, release.sha),
    channel: "release",
    localHead: localHead || undefined,
    upstreamHead: release.sha,
    changelog: releaseChangelog(release),
    releaseTag: release.tag,
    releaseSha: release.sha,
  };
}

function updateResultFields(
  update: HermesAgentUpdateCandidate,
): Partial<HermesAgentUpdateRoutineResult> {
  return {
    updateChannel: update.channel,
    releaseTag: update.releaseTag,
    releaseSha: update.releaseSha,
  };
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
  const resolveLatestRelease =
    options.resolveLatestRelease || resolveLatestHermesAgentReleaseTarget;
  const applyReleaseSha =
    options.applyReleaseSha ||
    ((sha: string, onProgress: Parameters<typeof runHermesUpdate>[0]) =>
      rollbackEngineTo(sha, onProgress));
  const onProgress = options.onProgress || (() => {});
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
      const update =
        routine.engineUpdateChannel === "release"
          ? await checkReleaseChannelUpdate(
              getInstalledSha,
              resolveLatestRelease,
            )
          : await checkMainChannelUpdate();
      const updateFields = updateResultFields(update);

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
          changelog: update.changelog,
          ...updateFields,
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
            changelog: update.changelog,
            ...updateFields,
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
            changelog: update.changelog,
            ...updateFields,
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
              changelog: update.changelog,
              ...updateFields,
            },
          );
        } else {
          const preUpdateSha = await getInstalledSha();
          try {
            if (update.channel === "release") {
              if (!update.releaseSha) {
                throw new Error("Release update did not include a commit SHA.");
              }
              await applyReleaseSha(update.releaseSha, onProgress);
            } else {
              await runHermesUpdate(onProgress);
            }
          } catch (err) {
            finalResult = result("error", errorMessage(err), checkedAt, {
              phase: "update",
              reason: "update-failed",
              restartStatus: "not-needed",
              localHead: preUpdateSha || update.localHead,
              upstreamHead: update.upstreamHead,
              behindBy: update.behindBy,
              changelog: update.changelog,
              ...updateFields,
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
                  changelog: update.changelog,
                  ...updateFields,
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
                  changelog: update.changelog,
                  ...updateFields,
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
                changelog: update.changelog,
                ...updateFields,
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
                changelog: update.changelog,
                contract,
                ...updateFields,
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
                changelog: update.changelog,
                ...updateFields,
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
        updateChannel: routine.engineUpdateChannel,
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
