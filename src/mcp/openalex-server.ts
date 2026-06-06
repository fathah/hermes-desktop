// openalex-server.ts — a standalone MCP (Model Context Protocol) stdio server
// that makes OpenAlex scholarly search callable by the Hermes AGENT in chat.
//
// It reuses the EXACT same normalization as the desktop UI (src/shared/openalex/
// core.ts) so the agent receives clean, abstract-reconstructed DTOs — not raw
// OpenAlex JSON. esbuild bundles this + the core + the SDK into a single
// resources/openalex-mcp.cjs, which the gateway spawns via the app's own Node
// runtime (ELECTRON_RUN_AS_NODE=1 on process.execPath — no node-on-PATH needed).
//
// Config (config.yaml mcp_servers.openalex.env): HERMES_OPENALEX_MAILTO opts into
// the polite pool; HERMES_OPENALEX_API_KEY raises the free daily allowance.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createOpenAlexClient, type FetchLike } from "../shared/openalex/core";

const OPENALEX_HOST = "api.openalex.org";

// The host is fixed (api.openalex.org), so a host allowlist is sufficient here —
// no user-controlled URL means no SSRF surface to pin against.
const pinnedFetch: FetchLike = async (url, init) => {
  if (new URL(url).hostname !== OPENALEX_HOST) {
    throw new Error(`refusing non-OpenAlex host: ${url}`);
  }
  const res = await fetch(url, {
    headers: init?.headers,
    signal: AbortSignal.timeout(10_000),
  });
  return res;
};

const client = createOpenAlexClient({
  fetchImpl: pinnedFetch,
  apiKey: process.env.HERMES_OPENALEX_API_KEY || undefined,
  mailto: process.env.HERMES_OPENALEX_MAILTO || undefined,
});

const server = new Server(
  { name: "openalex", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: "research_search",
    description:
      "Search OpenAlex (the open catalog of 250M+ scholarly works) for papers. " +
      "Returns clean summaries: title, authors, year, venue, citation count, " +
      "open-access PDF link, and topics. Use for 'find me papers on X'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search query." },
        filter: {
          type: "string",
          description:
            "Optional OpenAlex filter, e.g. 'publication_year:2024,is_oa:true'.",
        },
        perPage: {
          type: "number",
          description: "How many results (1–100, default 20).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "research_get",
    description:
      "Fetch one OpenAlex work by id (e.g. 'W2741809807'), including the full " +
      "reconstructed abstract, reference count, and related work ids.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "OpenAlex work id, e.g. W2741809807.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "research_landscape",
    description:
      "Aggregate the research landscape for a query WITHOUT downloading rows: " +
      "returns counts grouped by a dimension (e.g. publication_year for a trend, " +
      "or authorships.institutions.id for top institutions). The fastest way to " +
      "summarize a field.",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description:
            "OpenAlex filter scoping the works, e.g. 'title.search:graphene'.",
        },
        groupBy: {
          type: "string",
          description:
            "Dimension to group by, e.g. 'publication_year', " +
            "'authorships.institutions.id', 'authorships.author.id'.",
        },
      },
      required: ["filter", "groupBy"],
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
    let payload: unknown;
    if (name === "research_search") {
      payload = await client.searchWorks(String(a.query ?? ""), {
        filter: typeof a.filter === "string" ? a.filter : undefined,
        perPage: typeof a.perPage === "number" ? a.perPage : undefined,
      });
    } else if (name === "research_get") {
      payload = await client.getWork(String(a.id ?? ""));
    } else if (name === "research_landscape") {
      payload = await client.groupBy(
        String(a.filter ?? ""),
        String(a.groupBy ?? ""),
      );
    } else {
      throw new Error(`unknown tool: ${name}`);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `OpenAlex error: ${message}` }],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main();
