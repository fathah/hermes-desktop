// telos-auditor.ts — main-process orchestration for the Telos Alignment Auditor.
//
// Compares the user's recent vault files with their TELOS.md objectives
// and generates a detailed alignment analysis report page.

import fs from "fs";
import { join } from "path";
import { getSpsNoteIndex } from "./note-index";
import { getApiUrl, getRemoteAuthHeader } from "./hermes";
import { resolveSpsVaultDir } from "./sps-storage";

export interface AuditResult {
  success: boolean;
  title?: string;
  markdown?: string;
  error?: string;
}

// Models sometimes wrap their answer in a ```markdown fence. Trim it and strip
// the wrapping fence so callers get the raw body.
function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:markdown|md)?\s*\n/, "").replace(/\n```$/, "");
}

export async function runTelosAudit(profile?: string): Promise<AuditResult> {
  try {
    const vaultPath = resolveSpsVaultDir(profile);
    const telosPath = join(vaultPath, "TELOS.md");

    if (!fs.existsSync(telosPath)) {
      return {
        success: false,
        error:
          "No TELOS.md found in vault root. Please initialize it on the cockpit dashboard first.",
      };
    }

    const telosContent = fs.readFileSync(telosPath, "utf-8");
    const index = await getSpsNoteIndex(profile);
    const records = index.query({ limit: 15 });

    // Filter out system files or sub-folders
    const recentRecords = records.filter(
      (r) =>
        r.path !== "TELOS.md" &&
        r.path !== "_manifest.json" &&
        !r.path.includes("/"),
    );

    const summaries: string[] = [];
    for (const r of recentRecords) {
      try {
        const filePath = join(vaultPath, r.path);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf-8");
          // Extract a snippet to avoid context window explosion
          const snippet = content.slice(0, 800);
          summaries.push(
            `Note Title: ${r.title}\nPath: ${r.path}\nSnippet:\n${snippet}`,
          );
        }
      } catch {
        // skip read errors
      }
    }

    const todayStr = new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const systemPrompt =
      "You are the Principal Alignment Auditor. You review user workspace data and grade their alignment with their core goals.";
    const prompt = [
      "Analyze my recent work compared to my core objectives stored in TELOS.md.",
      "",
      "--- TELOS.md ---",
      telosContent,
      "",
      "--- RECENT WORKPLACE UPDATES ---",
      summaries.join("\n\n---\n\n"),
      "",
      "Provide a detailed, severe, and constructive report. Grade my alignment out of 100.",
      `Output a complete markdown document. Do not include markdown code fences at the start or end. It MUST start directly with:`,
      `# Telos Alignment Audit - ${todayStr}`,
      "",
      "Include these sections:",
      "## Executive Summary",
      "Detail my overall grade/score out of 100, status, and brief high-level summary.",
      "## Alignments",
      "Which tasks or page edits directly move my Telos objectives forward?",
      "## Divergences & Risks",
      "Where did I drift? What tasks/pages spent time on represent drift or hidden distraction risks?",
      "## Realignment Roadmap",
      "List 3 concrete, actionable things I should prioritize next to get back on track.",
    ].join("\n");

    const apiUrl = `${getApiUrl(profile)}/v1/chat/completions`;
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getRemoteAuthHeader() },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({
        model: "hermes-agent",
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        success: false,
        error: `Gateway error ${res.status}: ${body.slice(0, 150)}`,
      };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = stripMarkdownFences(
      data?.choices?.[0]?.message?.content ?? "",
    );

    return {
      success: true,
      title: `Telos Audit - ${todayStr}`,
      markdown: content,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Alignment audit failed.",
    };
  }
}

export async function runPipingPattern(
  text: string,
  pattern: string,
  profile?: string,
): Promise<{ success: boolean; result?: string; error?: string }> {
  try {
    let systemPrompt = "You are a helpful assistant.";
    let userPrompt = text;

    switch (pattern) {
      case "wisdom":
        systemPrompt =
          "You are the Master of Wisdom. Extract key insights, principles, and actionable advice from the user's input.";
        userPrompt = `Extract the most important wisdom, key concepts, and actionable ideas from the following text. Present them as a clean, structured bulleted list in markdown:\n\n${text}`;
        break;
      case "redteam":
        systemPrompt =
          "You are an elite Red Team Auditor. Analyze inputs to discover flaws, assumptions, vulnerabilities, and risks.";
        userPrompt = `Perform a comprehensive Red Team analysis of this text. Identify hidden assumptions, logical vulnerabilities, security/business risks, and potential points of failure. Present your findings in clean markdown:\n\n${text}`;
        break;
      case "critique":
        systemPrompt =
          "You are a harsh but constructive critic. Analyze inputs and provide detailed, actionable feedback.";
        userPrompt = `Provide a severe, constructive critique of the following text. Evaluate its logic, clarity, tone, and persuasiveness. Offer specific suggestions to improve it. Present in clean markdown:\n\n${text}`;
        break;
      case "tldr":
        systemPrompt =
          "You are a summarizing assistant that writes very brief TL;DRs.";
        userPrompt = `Provide a brief, single-sentence TL;DR (Too Long; Didn't Read) summarizing the essence of the following text:\n\n${text}`;
        break;
      case "eli5":
        systemPrompt =
          "You explain complex concepts in simple terms suitable for a 5-year-old.";
        userPrompt = `Explain the core concepts and meaning of this text like I am 5 years old. Use simple language, analogies, and keep it very easy to understand:\n\n${text}`;
        break;
      case "summarize":
        systemPrompt =
          "You write clear, detailed, and structured summaries of texts.";
        userPrompt = `Create a detailed and structured markdown summary of the following text, highlighting main themes, major points, and supporting details:\n\n${text}`;
        break;
      case "rewrite":
        systemPrompt =
          "You rewrite and polish texts to improve readability, flow, and professional tone while keeping the original meaning.";
        userPrompt = `Rewrite the following text to improve its clarity, flow, style, and professional polish. Retain all original ideas and meaning:\n\n${text}`;
        break;
      case "voice_briefing":
        systemPrompt =
          "You are Louis, the principal mentor. Speak encouragingly but directly to the user.";
        userPrompt = `Write a spoken briefing summarizing my day in ~100-150 words. Speak as Louis, the principal mentor. Be encouraging but direct. Mention my daily focus, my mission, and my goals. Output ONLY the spoken briefing itself, no extra chat or meta-commentary.

Input context:
${text}`;
        break;
      default:
        return { success: false, error: `Unknown pattern: ${pattern}` };
    }

    const apiUrl = `${getApiUrl(profile)}/v1/chat/completions`;
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getRemoteAuthHeader() },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({
        model: "hermes-agent",
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        success: false,
        error: `Gateway error ${res.status}: ${body.slice(0, 150)}`,
      };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = stripMarkdownFences(
      data?.choices?.[0]?.message?.content ?? "",
    );

    return {
      success: true,
      result: content,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Piping execution failed.",
    };
  }
}
