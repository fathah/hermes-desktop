import { useCallback, useEffect, useMemo, useRef } from "react";
import { useI18n } from "../../../components/useI18n";
import { SLASH_COMMANDS } from "../slashCommands";
import type { UsageState } from "../types";

interface UseLocalCommandsArgs {
  profile?: string;
  usage: UsageState | null;
  setFastMode: (next: boolean) => Promise<void>;
  onNewChat?: () => void;
  onClear: () => void;
  addAgentMessage: (content: string) => void;
}

interface UseLocalCommandsResult {
  /** Returns true if the text was handled locally and should not be sent to the backend. */
  executeLocal: (text: string) => Promise<boolean>;
  /** Synchronously checks whether a slash command would be handled locally. */
  isLocal: (text: string) => boolean;
}

function isLocallyHandled(text: string): boolean {
  if (!text.startsWith("/")) return false;
  const cmd = text.split(/\s+/)[0].toLowerCase();
  return SLASH_COMMANDS.some(
    (c) => c.name === cmd && (c.local || c.category === "info"),
  );
}

/**
 * Encapsulates slash commands that the desktop app handles without talking to
 * the agent. Captures `usage` via a ref so the returned callback stays stable
 * across streaming updates (avoids re-rendering memoized children).
 */
export function useLocalCommands({
  profile,
  usage,
  setFastMode,
  onNewChat,
  onClear,
  addAgentMessage,
}: UseLocalCommandsArgs): UseLocalCommandsResult {
  const { t } = useI18n();
  const usageRef = useRef(usage);
  useEffect(() => {
    usageRef.current = usage;
  });

  const executeLocal = useCallback(
    async (cmdText: string): Promise<boolean> => {
      const cmd = cmdText.trim().split(/\s+/)[0].toLowerCase();

      switch (cmd) {
        case "/new":
          onNewChat?.();
          return true;

        case "/clear":
          onClear();
          return true;

        case "/memory": {
          const mem = await window.hermesAPI.readMemory(profile);
          const lines: string[] = ["**Agent Memory**\n"];
          if (mem.memory.exists && mem.memory.content.trim()) {
            lines.push(mem.memory.content.trim());
          } else {
            lines.push(t("memory.noMemoryEntries"));
          }
          lines.push(
            `\n**Stats:** ${mem.stats.totalSessions} sessions, ${mem.stats.totalMessages} messages`,
          );
          addAgentMessage(lines.join("\n"));
          return true;
        }

        case "/tools": {
          const tools = await window.hermesAPI.getToolsets(profile);
          if (!tools.length) {
            addAgentMessage(t("memory.noToolsetsFound"));
          } else {
            const rows = tools
              .map(
                (tool) =>
                  `- **${tool.label}** — ${tool.description} ${tool.enabled ? "*(enabled)*" : "*(disabled)*"}`,
              )
              .join("\n");
            addAgentMessage(`**Available Toolsets**\n\n${rows}`);
          }
          return true;
        }

        case "/skills": {
          const skills = await window.hermesAPI.listInstalledSkills(profile);
          if (!skills.length) {
            addAgentMessage("No skills installed.");
          } else {
            const rows = skills
              .map((s) => `- **${s.name}** (${s.category}) — ${s.description}`)
              .join("\n");
            addAgentMessage(`**Installed Skills**\n\n${rows}`);
          }
          return true;
        }

        case "/persona": {
          const soul = await window.hermesAPI.readSoul(profile);
          addAgentMessage(
            soul.trim()
              ? `**Current Persona**\n\n${soul.trim()}`
              : "_No persona configured._",
          );
          return true;
        }

        case "/version": {
          const [hermesVer, appVer] = await Promise.all([
            window.hermesAPI.getHermesVersion(),
            window.hermesAPI.getAppVersion(),
          ]);
          addAgentMessage(
            `**Hermes Agent:** ${hermesVer || "unknown"}\n**Hermes One:** v${appVer}`,
          );
          return true;
        }

        case "/fast": {
          const current = await window.hermesAPI.getConfig(
            "agent.service_tier",
            profile,
          );
          const isOn = current === "fast" || current === "priority";
          const next = !isOn;
          await setFastMode(next);
          return true;
        }

        case "/usage": {
          const u = usageRef.current;
          if (u) {
            const lines = [
              `**Token Usage**\n`,
              `- **Prompt:** ${u.promptTokens.toLocaleString()} tokens`,
              `- **Completion:** ${u.completionTokens.toLocaleString()} tokens`,
              `- **Total:** ${u.totalTokens.toLocaleString()} tokens`,
            ];
            if (u.cost != null) lines.push(`- **Cost:** $${u.cost.toFixed(4)}`);
            addAgentMessage(lines.join("\n"));
          } else {
            addAgentMessage(t("chat.noUsageData"));
          }
          return true;
        }

        case "/help": {
          const categoryLabels: Record<string, string> = {
            chat: t("chat.categoryChat"),
            agent: t("chat.categoryAgent"),
            tools: t("chat.categoryTools"),
            info: t("chat.categoryInfo"),
          };
          const grouped = new Map<string, typeof SLASH_COMMANDS>();
          for (const c of SLASH_COMMANDS) {
            const arr = grouped.get(c.category) ?? [];
            arr.push(c);
            grouped.set(c.category, arr);
          }
          let md = `**${t("chat.availableCommands")}**\n`;
          for (const cat of ["chat", "agent", "tools", "info"] as const) {
            const cmds = grouped.get(cat);
            if (!cmds) continue;
            md += `\n**${categoryLabels[cat]}**\n`;
            for (const c of cmds) md += `\`${c.name}\` — ${c.description}\n`;
          }
          addAgentMessage(md);
          return true;
        }

        default:
          return false;
      }
    },
    [profile, t, setFastMode, onNewChat, onClear, addAgentMessage],
  );

  return useMemo(
    () => ({ executeLocal, isLocal: isLocallyHandled }),
    [executeLocal],
  );
}
