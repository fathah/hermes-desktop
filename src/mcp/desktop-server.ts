import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Discover control server details
function getControlServerConfig(): { port: number; token: string } {
  const desktopJsonPath = join(homedir(), ".hermes", "desktop.json");
  if (!existsSync(desktopJsonPath)) {
    throw new Error(`Hermes config file not found at ${desktopJsonPath}`);
  }
  try {
    const config = JSON.parse(readFileSync(desktopJsonPath, "utf-8"));
    const port = config.controlServerPort;
    const token = config.controlServerToken;
    if (!port || !token) {
      throw new Error(
        "Missing controlServerPort or controlServerToken in desktop.json",
      );
    }
    return { port: Number(port), token: String(token) };
  } catch (err) {
    throw new Error(
      `Failed to parse Hermes config: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const server = new Server(
  { name: "desktop", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: "create_cron_job",
    description:
      "Create a scheduled automation / cron task in Hermes to run code or prompts on a regular interval. " +
      "Takes a standard cron expression or schedule and registers a job on the local control server.",
    inputSchema: {
      type: "object",
      properties: {
        schedule: {
          type: "string",
          description:
            "Cron schedule expression (e.g. '0 9 * * 1' for every Monday at 9 AM) or interval.",
        },
        prompt: {
          type: "string",
          description:
            "The prompt or message for the LLM advisor to run when the schedule triggers.",
        },
        name: {
          type: "string",
          description:
            "Human-readable name for the cron job (e.g. 'Audit weekly ticker XYZ').",
        },
        deliver: {
          type: "string",
          description:
            "Target location/channel to deliver results (e.g. a specific note page ID, or 'chat').",
        },
      },
      required: ["schedule", "prompt", "name"],
    },
  },
  {
    name: "build_context_pack",
    description:
      "Build a deterministic Markdown context pack from the local SPS/Obsidian vault for another AI agent. " +
      "Includes the selected note, backlinks, linked sources, related tasks, unresolved questions, and provenance.",
    inputSchema: {
      type: "object",
      properties: {
        pageId: {
          type: "string",
          description: "SPS page id or Markdown path to package.",
        },
        maxBytes: {
          type: "number",
          description: "Maximum UTF-8 bytes in the returned pack.",
        },
        save: {
          type: "boolean",
          description:
            "When true, also save the pack under vault/_context-packs/.",
        },
      },
      required: ["pageId"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const a = args as Record<string, unknown>;

  try {
    if (name === "create_cron_job") {
      const { port, token } = getControlServerConfig();
      const response = await fetch(`http://127.0.0.1:${port}/cron/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          schedule: a.schedule,
          prompt: a.prompt,
          name: a.name,
          deliver: a.deliver,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(
          `Control server returned status ${response.status}: ${errText}`,
        );
      }

      const payload = await response.json();
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    } else if (name === "build_context_pack") {
      const { port, token } = getControlServerConfig();
      const response = await fetch(
        `http://127.0.0.1:${port}/sps/context-pack`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            pageId: a.pageId,
            maxBytes: a.maxBytes,
            save: a.save,
          }),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(
          `Control server returned status ${response.status}: ${errText}`,
        );
      }

      const payload = await response.json();
      return {
        content: [
          {
            type: "text",
            text:
              typeof payload.markdown === "string"
                ? payload.markdown
                : JSON.stringify(payload, null, 2),
          },
        ],
      };
    } else {
      throw new Error(`unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Desktop MCP error: ${message}` }],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main();
