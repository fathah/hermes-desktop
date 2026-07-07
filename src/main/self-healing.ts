import { existsSync, readFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, resolve, basename } from "path";
import type { BrowserWindow } from "electron";
import { profileHome, safeWriteFile } from "./utils";
import { listInstalledSkills } from "./skills";
import { readDesktopConfig, readEnv } from "./config";
import { getApiUrl, getRemoteAuthHeader } from "./hermes";
import { gatewayFetch, publicFetch } from "./security/network-policy";
import { formatLogError, log } from "./log";

let mainWindowGetter: (() => BrowserWindow | null) | null = null;

export function setMainWindowGetter(getter: () => BrowserWindow | null): void {
  mainWindowGetter = getter;
}

interface SelfHealingResult {
  success: boolean;
  explanation?: string;
  filePatched?: string;
  diff?: string;
  error?: string;
}

export function getRecentPatches(
  profile: string,
  jobId: string,
  limit = 3,
): string[] {
  try {
    const logDir = join(profileHome(profile), "logs");
    const logFile = join(logDir, "config-fixes.log");
    if (!existsSync(logFile)) {
      return [];
    }
    const logContent = readFileSync(logFile, "utf-8");
    const lines = logContent.split("\n").filter((l) => l.trim() !== "");
    const results: string[] = [];

    // Traverse from latest to oldest
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (
          obj.issueCode === "SELF_HEALING_REMEDIATION" &&
          obj.jobId === jobId &&
          typeof obj.patchedContent === "string"
        ) {
          results.push(obj.patchedContent);
          if (results.length >= limit) {
            break;
          }
        }
      } catch {
        /* ignore */
      }
    }
    return results;
  } catch {
    return [];
  }
}

export function getRecentScreenshot(
  profile: string,
  jobId: string,
): string | null {
  try {
    const logDir = join(profileHome(profile), "logs", "routines");
    if (!existsSync(logDir)) return null;
    const files = readdirSync(logDir);
    const matchingFiles = files
      .filter(
        (f) => f.startsWith(`routine-${jobId}-`) && f.endsWith("-error.png"),
      )
      .map((f) => join(logDir, f));

    if (matchingFiles.length === 0) return null;

    // Sort by modification time to get the newest
    matchingFiles.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    return matchingFiles[0];
  } catch {
    return null;
  }
}

/**
 * Triggered by the scheduler when a background routine exits with a non-zero code.
 */
export async function triggerSelfHealing(
  jobId: string,
  jobName: string,
  logFilePath: string,
  profile: string,
): Promise<SelfHealingResult> {
  log.info("self-healing", {
    msg: "starting diagnosis for failed job",
    jobId,
    jobName,
    profile,
  });
  try {
    // 1. Read the last 200 lines of logs
    if (!existsSync(logFilePath)) {
      return { success: false, error: "Log file does not exist." };
    }
    const logContent = readFileSync(logFilePath, "utf-8");
    const logLines = logContent.split("\n");
    const logTail = logLines.slice(-200).join("\n");

    // 2. Identify associated skill and script from the jobs list
    const cronJobsPath = join(profileHome(profile), "cron", "jobs.json");
    if (!existsSync(cronJobsPath)) {
      return { success: false, error: "Cron jobs definition not found." };
    }
    const cronData = JSON.parse(readFileSync(cronJobsPath, "utf-8"));
    const jobs = cronData.jobs || [];
    const job = jobs.find(
      (j: {
        id: string;
        skill?: string;
        skills?: string[];
        script?: string;
        prompt: string;
      }) => j.id === jobId,
    );
    if (!job) {
      return { success: false, error: `Job with ID ${jobId} not found.` };
    }

    const skillName = job.skill || (job.skills && job.skills[0]) || null;
    let skillContent = "";
    let skillPath = "";
    let scriptContent = "";
    let scriptPath = "";

    // Load custom skill if available
    if (skillName) {
      const installedSkills = listInstalledSkills(profile);
      const matchedSkill = installedSkills.find(
        (s) => s.name.toLowerCase() === skillName.toLowerCase(),
      );
      if (matchedSkill) {
        skillPath = join(matchedSkill.path, "SKILL.md");
        if (existsSync(skillPath)) {
          skillContent = readFileSync(skillPath, "utf-8");
        }
      }
    }

    // Load script if available
    if (job.script) {
      // Check in the profile scripts folder first
      scriptPath = join(profileHome(profile), "scripts", job.script);
      if (!existsSync(scriptPath) && matchedSkillFolder(profile, skillName)) {
        // Fallback to skill folder
        scriptPath = join(matchedSkillFolder(profile, skillName)!, job.script);
      }

      if (existsSync(scriptPath)) {
        scriptContent = readFileSync(scriptPath, "utf-8");
      }
    }

    if (!skillContent && !scriptContent) {
      return {
        success: false,
        error: "No custom skill or script associated with this job.",
      };
    }

    // 3. Query LLM (Gemini or Configured Key)
    const previousPatches = getRecentPatches(profile, jobId);
    const screenshotPath = getRecentScreenshot(profile, jobId);
    const prompt = buildTriagePrompt(
      jobName,
      job.prompt,
      logTail,
      skillContent,
      scriptContent,
      job.script,
      previousPatches,
    );
    const triageResponse = await callTriageLLM(prompt, profile, screenshotPath);

    if (!triageResponse.success || !triageResponse.rawOutput) {
      return {
        success: false,
        error: triageResponse.error || "LLM did not return a response.",
      };
    }

    // 4. Parse response
    const parsed = parseLLMResponse(triageResponse.rawOutput);
    if (!parsed) {
      return {
        success: false,
        error: "Failed to parse self-healing structured JSON output from LLM.",
      };
    }

    // 5. Apply file patch with traversal checks
    let targetFilePath = "";
    if (parsed.fileToPatch === "SKILL.md" && skillPath) {
      targetFilePath = skillPath;
    } else if (parsed.fileToPatch === job.script && scriptPath) {
      targetFilePath = scriptPath;
    } else if (
      parsed.fileToPatch &&
      job.script &&
      parsed.fileToPatch === basename(job.script)
    ) {
      targetFilePath = scriptPath;
    } else {
      return {
        success: false,
        error: `Refused: target file "${parsed.fileToPatch}" is invalid or does not match skill/script.`,
      };
    }

    // Double check path safety (no traversal)
    const resolvedPath = resolve(targetFilePath);
    const profileRoot = resolve(profileHome(profile));
    if (!resolvedPath.startsWith(profileRoot)) {
      return {
        success: false,
        error: "Refused: patch path escapes profile home directory.",
      };
    }

    const originalContent = readFileSync(targetFilePath, "utf-8");

    // Snapshot the pre-patch file so a wrong LLM patch can be reverted. The
    // audit log only records the NEW content, so without this backup there is no
    // path back to the last human-written version. If the backup can't be
    // written, refuse to patch — a still-broken job beats an unrecoverable one.
    const backupPath = `${targetFilePath}.selfheal-bak-${Date.now()}`;
    try {
      safeWriteFile(backupPath, originalContent);
    } catch (err) {
      return {
        success: false,
        error: `Refused: could not write pre-patch backup (${
          err instanceof Error ? err.message : String(err)
        }).`,
      };
    }

    safeWriteFile(targetFilePath, parsed.patchedContent);

    // Generate plain-text diff preview
    const diffText = generateSimpleDiff(originalContent, parsed.patchedContent);

    // Write audit record
    logTriageFix(profile, {
      ts: Date.now(),
      issueCode: "SELF_HEALING_REMEDIATION",
      action: "autofix",
      jobId,
      filePatched: parsed.fileToPatch,
      patchedContent: parsed.patchedContent,
      explanation: parsed.explanation,
      detail: `Self-healed ${parsed.fileToPatch} (backup: ${backupPath}): ${parsed.explanation}`,
    });

    // 6. Notify frontend UI
    if (mainWindowGetter) {
      const win = mainWindowGetter();
      if (win) {
        win.webContents.send("system-stabilized", {
          jobId,
          jobName,
          explanation: parsed.explanation,
          filePatched: basename(targetFilePath),
          diff: diffText,
        });
      }
    }

    log.info("self-healing", {
      msg: "successfully self-healed",
      jobId,
      jobName,
      profile,
      filePatched: parsed.fileToPatch,
    });
    return {
      success: true,
      explanation: parsed.explanation,
      filePatched: basename(targetFilePath),
      diff: diffText,
    };
  } catch (err) {
    log.error("self-healing", {
      msg: "error during log triage",
      jobId,
      jobName,
      profile,
      error: formatLogError(err),
    });
    return { success: false, error: (err as Error).message };
  }
}

function matchedSkillFolder(
  profile: string,
  skillName: string | null,
): string | null {
  if (!skillName) return null;
  const installedSkills = listInstalledSkills(profile);
  const matched = installedSkills.find(
    (s) => s.name.toLowerCase() === skillName.toLowerCase(),
  );
  return matched ? matched.path : null;
}

function buildTriagePrompt(
  jobName: string,
  jobPrompt: string,
  logs: string,
  skillContent: string,
  scriptContent: string,
  scriptName: string | null,
  previousPatches: string[] = [],
): string {
  let causalHistoryBlock = "";
  if (previousPatches.length > 0) {
    causalHistoryBlock =
      `\n--- PREVIOUS FIX ATTEMPTS (THAT FAILED RUNTIME VALIDATION) ---\n` +
      `Below are the previously generated versions of files that still failed when run. ` +
      `You MUST NOT repeat these incorrect versions or patterns:\n` +
      previousPatches
        .map((patch, idx) => `[Attempt #${idx + 1}]:\n${patch}\n---`)
        .join("\n") +
      "\n";
  }

  return `You are an expert autonomous software reliability agent.
A background task (routines job) has failed in Hermes Desktop.
Job Name: "${jobName}"
Instructions: "${jobPrompt}"

Here is the log trace showing the failure details:
\`\`\`
${logs}
\`\`\`
${causalHistoryBlock}
Here is the code context of the associated files:
${skillContent ? `\n--- SKILL.md ---\n${skillContent}\n` : ""}
${scriptContent && scriptName ? `\n--- SCRIPT (${scriptName}) ---\n${scriptContent}\n` : ""}

Analyze the logs carefully. Identify if the failure is caused by an instruction logic bug in SKILL.md or a bug in the script (${scriptName ?? ""}).
Provide the exact corrected file content.

You MUST respond strictly with a JSON object. Do not include markdown code fences or conversational prefix/suffix.

Format your output exactly as follows:
{
  "explanation": "State clearly what went wrong (e.g., incorrect API parameter, parse index out of bounds) and how your change fixes it.",
  "fileToPatch": "${scriptName ? scriptName : "SKILL.md"}",
  "patchedContent": "Write the entire, complete updated contents of the file here."
}`;
}

async function callTriageLLM(
  prompt: string,
  profile: string,
  screenshotPath: string | null,
): Promise<{ success: boolean; rawOutput?: string; error?: string }> {
  const desktopConfig = readDesktopConfig();
  const env = readEnv(profile);

  // User Configurable Triage Settings from desktop.json
  const provider = (desktopConfig.triageProvider as string) || null;
  const triageModel =
    (desktopConfig.triageModel as string) || "gemini-1.5-flash";
  const triageApiKey = (desktopConfig.triageApiKey as string) || null;

  // Let the fallback key check resolve. If no custom triage settings, check environment for GOOGLE_API_KEY
  if (!provider && env.GOOGLE_API_KEY) {
    // Direct Gemini API call
    return callGeminiDirectly(
      prompt,
      triageModel,
      env.GOOGLE_API_KEY,
      screenshotPath,
    );
  }

  if (provider === "gemini" && triageApiKey) {
    return callGeminiDirectly(
      prompt,
      triageModel,
      triageApiKey,
      screenshotPath,
    );
  }

  // Fallback to active model gateway
  try {
    const apiUrl = getApiUrl(profile);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...getRemoteAuthHeader(),
    };

    let userContent: unknown = prompt;
    if (screenshotPath && existsSync(screenshotPath)) {
      const base64Data = readFileSync(screenshotPath, "base64");
      userContent = [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${base64Data}`,
          },
        },
      ];
    }

    const payload = {
      model: "hermes-agent",
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You are a reliability bot. Output strictly JSON as instructed.",
        },
        { role: "user", content: userContent },
      ],
    };

    const res = await gatewayFetch(`${apiUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        success: false,
        error: `Gateway API responded with ${res.status}: ${text}`,
      };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawOutput = data.choices?.[0]?.message?.content || "";
    return { success: true, rawOutput };
  } catch (err) {
    return {
      success: false,
      error: `LLM gateway request failed: ${(err as Error).message}`,
    };
  }
}

async function callGeminiDirectly(
  prompt: string,
  model: string,
  apiKey: string,
  screenshotPath: string | null,
): Promise<{ success: boolean; rawOutput?: string; error?: string }> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const parts: Array<Record<string, unknown>> = [{ text: prompt }];
    if (screenshotPath && existsSync(screenshotPath)) {
      const base64Data = readFileSync(screenshotPath, "base64");
      parts.push({
        inlineData: {
          mimeType: "image/png",
          data: base64Data,
        },
      });
    }

    const res = await publicFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        success: false,
        error: `Gemini API responded with ${res.status}: ${text}`,
      };
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const rawOutput = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return { success: true, rawOutput };
  } catch (err) {
    return {
      success: false,
      error: `Gemini API direct call failed: ${(err as Error).message}`,
    };
  }
}

function parseLLMResponse(
  raw: string,
): { explanation: string; fileToPatch: string; patchedContent: string } | null {
  try {
    // Strip markdown code fences if LLM included them despite system instructions
    let jsonStr = raw.trim();
    if (jsonStr.startsWith("```")) {
      const lines = jsonStr.split("\n");
      if (lines[0].startsWith("```json") || lines[0].startsWith("```")) {
        lines.shift();
      }
      if (lines[lines.length - 1] === "```") {
        lines.pop();
      }
      jsonStr = lines.join("\n").trim();
    }

    const obj = JSON.parse(jsonStr);
    if (
      typeof obj.explanation === "string" &&
      typeof obj.fileToPatch === "string" &&
      typeof obj.patchedContent === "string"
    ) {
      return obj;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function generateSimpleDiff(original: string, updated: string): string {
  const origLines = original.split("\n");
  const updLines = updated.split("\n");
  const diff: string[] = [];

  let oIdx = 0;
  let uIdx = 0;

  while (oIdx < origLines.length || uIdx < updLines.length) {
    if (origLines[oIdx] === updLines[uIdx]) {
      oIdx++;
      uIdx++;
    } else {
      if (oIdx < origLines.length && !updLines.includes(origLines[oIdx])) {
        diff.push(`- ${origLines[oIdx]}`);
        oIdx++;
      } else if (
        uIdx < updLines.length &&
        !origLines.includes(updLines[uIdx])
      ) {
        diff.push(`+ ${updLines[uIdx]}`);
        uIdx++;
      } else {
        diff.push(`- ${origLines[oIdx] || ""}`);
        diff.push(`+ ${updLines[uIdx] || ""}`);
        oIdx++;
        uIdx++;
      }
    }
  }

  return diff.join("\n");
}

function logTriageFix(profile: string, entry: unknown): void {
  try {
    const logDir = join(profileHome(profile), "logs");
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, "config-fixes.log");
    const existing = existsSync(logFile) ? readFileSync(logFile, "utf-8") : "";
    const line = JSON.stringify(entry) + "\n";
    safeWriteFile(logFile, `${existing}${line}`);
  } catch {
    /* ignore */
  }
}
