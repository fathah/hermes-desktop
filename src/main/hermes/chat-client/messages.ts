import { getHermesVersion } from "../../installer";
import type {
  ApprovalRequest,
  CheckpointEvent,
  DelegateProgress,
} from "../../sse-parser";
import { type Attachment, escapeXmlAttr } from "../../../shared/attachments";
import { resolveProfile } from "../gateway-process";

export interface ChatCallbacks {
  onChunk: (text: string) => void;
  onReasoningChunk?: (text: string) => void;
  onDone: (sessionId?: string) => void;
  onError: (error: string) => void;
  onToolProgress?: (tool: string) => void;
  onUsage?: (usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
    rateLimitRemaining?: number;
    rateLimitReset?: number;
    model?: string;
    sessionId?: string;
    cacheRead?: number;
    cacheWrite?: number;
  }) => void;
  onApprovalRequest?: (req: ApprovalRequest) => void;
  onCheckpoint?: (cp: CheckpointEvent) => void;
  onDelegateProgress?: (p: DelegateProgress) => void;
}

export interface ChatHandle {
  abort: () => void;
}

export type ChatContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

export function buildUserContent(
  text: string,
  attachments?: Attachment[],
): ChatContent {
  if (!attachments || attachments.length === 0) return text;

  const textFiles = attachments.filter((a) => a.kind === "text-file");
  const pathRefs = attachments.filter(
    (a) => a.kind === "path-ref" && typeof a.path === "string" && a.path,
  );
  const images = attachments.filter(
    (a) => a.kind === "image" && typeof a.dataUrl === "string" && a.dataUrl,
  );

  const parts: string[] = [];
  if (text.trim()) parts.push(text);
  for (const f of textFiles) {
    if (typeof f.text !== "string") continue;
    const name = escapeXmlAttr(f.name);
    const mime = escapeXmlAttr(f.mime || "text/plain");
    parts.push(`<file name="${name}" mime="${mime}">\n${f.text}\n</file>`);
  }
  if (pathRefs.length > 0) {
    const lines = pathRefs.map((f) => `[Attached file: ${f.path}]`);
    parts.push(lines.join("\n"));
  }
  const composedText = parts.join("\n\n");

  if (images.length === 0) return composedText;

  const imageParts = images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: img.dataUrl! },
  }));

  if (!composedText) return imageParts;

  return [{ type: "text" as const, text: composedText }, ...imageParts];
}

export function contextFolderSystemMessage(
  contextFolder?: string,
): { role: "system"; content: string } | null {
  const folder = contextFolder?.trim();
  if (!folder) return null;
  return {
    role: "system",
    content:
      `The working folder for this conversation is ${folder}. ` +
      `When the user asks you to read, create, modify, or run project ` +
      `files, use the file, terminal, and code-execution tools with ` +
      `absolute paths under this folder.`,
  };
}

export async function buildSelfAwarenessSystemMessage(
  profile?: string,
): Promise<{ role: "system"; content: string } | null> {
  try {
    const { getToolsets } = await import("../../tools");
    const { listInstalledSkills } = await import("../../skills");
    const { getSharedDb } = await import("../../db");
    const activeProfile = resolveProfile(profile) || "default";
    const enabledTools = getToolsets(profile)
      .filter((t) => t.enabled)
      .map((t) => t.key);
    const installedSkills = listInstalledSkills(profile).map((s) => s.name);
    const version = (await getHermesVersion()) || "Unknown Version";

    let registryCount = 0;
    try {
      const db = getSharedDb(true);
      if (db) {
        const tableCheck = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='skills_registry'",
          )
          .get();
        if (tableCheck) {
          const row = db
            .prepare("SELECT COUNT(*) as count FROM skills_registry")
            .get() as { count: number };
          registryCount = row.count;
        }
      }
    } catch {
      /* best-effort */
    }

    const sysMsg =
      `You are Hermes, a self-improving AI agent. ` +
      `You are running inside Hermes Desktop v${version} on the user's local machine. ` +
      `Active profile: "${activeProfile}".\n\n` +
      `Your active capabilities configuration:\n` +
      `- Enabled toolsets: [${enabledTools.join(", ")}]\n` +
      `- Installed skills (advanced agents you can delegate to): [${installedSkills.join(", ")}]\n` +
      `- Skills available in registry: ${registryCount} (use skills-registry-lookup to find or sync them)\n\n` +
      `Feel free to use your tools to achieve the user's goal.`;

    return { role: "system", content: sysMsg };
  } catch (err) {
    console.error(
      "[hermes] Failed to build self-awareness system message:",
      err,
    );
    return null;
  }
}
