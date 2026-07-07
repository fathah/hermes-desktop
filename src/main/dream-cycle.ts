import { join } from "path";
import { writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { getSpsNoteIndex, parseFrontmatter } from "./note-index";
import { resolveSpsVaultDir } from "./sps-storage";
import { chatCompletionOnce } from "./hermes/chat-client";
import { getActiveProfileNameSync } from "./utils";
import { buildDailyBriefMarkdown, dailyBriefFileName } from "./daily-brief";
import { deliverDailyBrief } from "./daily-brief-delivery";
import { formatLogError, log } from "./log";
import YAML from "yaml";

/**
 * Summarizes a note's raw markdown text using the local LLM.
 */
async function generateSummary(
  title: string,
  content: string,
  profile?: string,
): Promise<string> {
  const prompt = `You are a knowledge gardening assistant for an agent's memory system.
Please provide a 1-sentence summary of the following note content.
Do not include any introductory phrases like "Here is a summary". Just output the clean summary string.

Note Title: ${title}
Note Content:
${content}`;

  const res = await chatCompletionOnce(
    [{ role: "user", content: prompt }],
    profile,
  );
  if (res.error) {
    throw new Error(`Failed to generate summary: ${res.error}`);
  }
  return res.content.trim().replace(/^["']|["']$/g, ""); // strip quotes
}

/**
 * Runs the Dream Cycle knowledge gardening task.
 */
export async function runDreamCycle(profile?: string): Promise<void> {
  const activeProfile = profile ?? getActiveProfileNameSync();
  const vaultDir = resolveSpsVaultDir(activeProfile);
  log.info("dream-cycle", {
    msg: "starting Dream Cycle",
    vaultDir,
    profile: activeProfile,
  });

  try {
    const noteIndex = await getSpsNoteIndex(activeProfile);
    const notes = noteIndex.query({});

    // 1. Process and summarize notes
    const summarizedNotes: Array<{
      title: string;
      summary: string;
      path: string;
    }> = [];

    for (const note of notes) {
      const absPath = join(vaultDir, note.path);
      if (!existsSync(absPath)) continue;

      const raw = await readFile(absPath, "utf8");
      const { props, body } = parseFrontmatter(raw);

      // Summarize if summary does not exist or if note is very fresh
      let summary = props.summary as string | undefined;

      if (!summary) {
        log.info("dream-cycle", {
          msg: "summarizing note",
          path: note.path,
          profile: activeProfile,
        });
        try {
          summary = await generateSummary(note.title, body, activeProfile);
          props.summary = summary;

          // Serialize back to file
          const yamlStr = YAML.stringify(props).trim();
          const updatedContent = `---\n${yamlStr}\n---\n${body.startsWith("\n") ? body : "\n" + body}`;
          await writeFile(absPath, updatedContent, "utf8");
          log.info("dream-cycle", {
            msg: "saved summary to frontmatter",
            path: note.path,
            profile: activeProfile,
          });
        } catch (err) {
          log.error("dream-cycle", {
            msg: "failed to summarize note",
            path: note.path,
            profile: activeProfile,
            error: formatLogError(err),
          });
        }
      }

      if (summary) {
        summarizedNotes.push({
          title: note.title,
          summary,
          path: note.path,
        });
      }
    }

    // 2. Fetch Gaps & Orphans
    const lintReport = noteIndex.lint();
    const missing = lintReport.brokenLinks
      .map((b) => `${b.source} -> [[${b.target}]] (${b.type})`)
      .join("\n");
    const orphans = lintReport.orphans.join("\n");

    const noteSummariesText = summarizedNotes
      .map((n) => `- **${n.title}** (${n.path}): ${n.summary}`)
      .join("\n");

    log.info("dream-cycle", {
      msg: "compiling Daily Brief",
      profile: activeProfile,
    });

    // 3. Generate Daily Brief via LLM
    const reportPrompt = `You are an AI Mentor gardening the agent's knowledge graph.
Analyze the following notes, missing pages, and orphans from the system, and generate a concise, review-first "Daily Brief" in Markdown format.

Active Notes & Summaries:
${noteSummariesText || "No active notes"}

Missing Notes (Linked but don't exist):
${missing || "None"}

Orphaned Notes (No incoming/outgoing links):
${orphans || "None"}

Generate a beautiful Markdown report containing:
1. **Daily Brief**: A short synthesis of today's workspace state.
2. **Changed or Active Pages**: Pages that look active, with one-line summaries.
3. **Open Loops**: Broken links, orphan notes, deadlines, or action items to review.
4. **Suggested Context**: Context the user may choose to opt into future assistant runs.

The generated page frontmatter will default to context: review. Do not imply it has been injected automatically.

Do not include any extra text outside the Markdown content.`;

    const res = await chatCompletionOnce(
      [{ role: "user", content: reportPrompt }],
      activeProfile,
    );
    if (res.error) {
      throw new Error(`Failed to compile report: ${res.error}`);
    }

    const today = new Date();
    const reportName = dailyBriefFileName(today);
    const reportPath = join(vaultDir, reportName);
    const briefMarkdown = buildDailyBriefMarkdown({
      date: today,
      body: res.content,
    });

    await writeFile(reportPath, briefMarkdown, "utf8");
    log.info("dream-cycle", {
      msg: "daily Brief saved",
      path: reportPath,
      profile: activeProfile,
    });

    // Trigger index rebuild to pick up the new Daily Brief note
    await noteIndex.rebuild();
    try {
      await deliverDailyBrief(briefMarkdown, today, activeProfile);
    } catch (err) {
      log.error("dream-cycle", {
        msg: "daily brief owner delivery failed",
        profile: activeProfile,
        error: formatLogError(err),
      });
    }
  } catch (err) {
    log.error("dream-cycle", {
      msg: "error in dream cycle run",
      profile: activeProfile,
      error: formatLogError(err),
    });
  }
}
