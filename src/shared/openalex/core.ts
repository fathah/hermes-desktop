// core.ts — Electron-free, dependency-injected OpenAlex client + normalization.
//
// OpenAlex (https://openalex.org) is an open, CC0-licensed catalog of the global
// research system. This module turns its dense JSON into small, plain DTOs and is
// shared by TWO hosts that must NOT share a dispatcher:
//   • src/main/openalex.ts        — wraps `fetchImpl` with the SSRF-hardened
//                                    `guardedAgent` + per-profile config + cache.
//   • src/mcp/openalex-server.ts  — wraps `fetchImpl` with a host-pinned undici
//                                    agent, exposed to the Hermes agent over MCP.
//
// So it stays PURE: no electron/node imports, fetch is injected. `FetchLike` is a
// structural subset (not lib.dom's `fetch`) so vitest can mock it trivially and
// undici's Response satisfies it without a DOM lib.

export const OPENALEX_BASE = "https://api.openalex.org";

// ── normalized DTOs (the only shapes that cross a boundary) ──
export interface WorkSummary {
  id: string; // bare OpenAlex id, e.g. "W2741809807"
  title: string;
  year?: number;
  authors: string[];
  venue?: string;
  citedByCount: number;
  isOA: boolean;
  oaUrl?: string;
  topics: string[];
  doi?: string;
}

export interface WorkDetail extends WorkSummary {
  abstract: string;
  referencedCount: number;
  relatedIds: string[];
}

export interface GroupBucket {
  key: string;
  keyDisplayName: string;
  count: number;
}

export interface AutocompleteItem {
  id: string;
  label: string;
  hint?: string;
}

export interface SearchOpts {
  perPage?: number;
  filter?: string;
  sort?: string;
}

// Minimal structural fetch — main injects undici(+guardedAgent), MCP injects
// undici(+host-pin), tests inject a stub. We only touch ok/status/json().
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface OpenAlexClientOpts {
  fetchImpl: FetchLike;
  apiKey?: string;
  mailto?: string;
}

export interface OpenAlexClient {
  searchWorks(q: string, opts?: SearchOpts): Promise<WorkSummary[]>;
  getWork(id: string): Promise<WorkDetail>;
  groupBy(filter: string, groupBy: string): Promise<GroupBucket[]>;
  autocomplete(entity: string, q: string): Promise<AutocompleteItem[]>;
  /** Exposed for testing the URL/param/auth construction in isolation. */
  buildUrl(
    path: string,
    params: Record<string, string | number | undefined>,
  ): string;
}

// Trim the payload to just what the DTOs need — never pull the multi-KB record.
const WORK_FIELDS = [
  "id",
  "display_name",
  "publication_year",
  "authorships",
  "primary_location",
  "best_oa_location",
  "open_access",
  "cited_by_count",
  "topics",
  "doi",
];
const WORK_SELECT = WORK_FIELDS.join(",");
const WORK_DETAIL_SELECT = [
  ...WORK_FIELDS,
  "abstract_inverted_index",
  "referenced_works",
  "related_works",
].join(",");

/**
 * Reconstruct plain abstract text from OpenAlex's `abstract_inverted_index`
 * (token → [positions]). Pure + heavily unit-tested: this is the one genuinely
 * fiddly transform in the integration. Missing positions become gaps; the
 * resulting whitespace is collapsed. Empty/malformed input → "".
 */
export function reconstructAbstract(
  inv?: Record<string, number[]> | null,
): string {
  if (!inv || typeof inv !== "object") return "";
  const slots: string[] = [];
  for (const [token, positions] of Object.entries(inv)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === "number" && pos >= 0) slots[pos] = token;
    }
  }
  const filled = Array.from(slots, (t) => t ?? "");
  return filled.join(" ").replace(/\s+/g, " ").trim();
}

// ── raw OpenAlex shapes (only the fields we read) ──
interface OAAuthorship {
  author?: { display_name?: string } | null;
  raw_author_name?: string;
}
interface OAWork {
  id?: string;
  display_name?: string;
  publication_year?: number;
  authorships?: OAAuthorship[];
  primary_location?: { source?: { display_name?: string } | null } | null;
  best_oa_location?: {
    pdf_url?: string | null;
    landing_page_url?: string | null;
  } | null;
  open_access?: { is_oa?: boolean; oa_url?: string | null } | null;
  cited_by_count?: number;
  topics?: { display_name?: string }[];
  doi?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  referenced_works?: string[];
  related_works?: string[];
}

/** "https://openalex.org/W123" / a DOI URL → the trailing bare id. */
function bareId(id?: string | null): string {
  if (!id) return "";
  const slash = id.lastIndexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id;
}

function toSummary(w: OAWork): WorkSummary {
  const authors = (w.authorships ?? [])
    .map((a) => a.author?.display_name || a.raw_author_name || "")
    .filter(Boolean);
  const venue = w.primary_location?.source?.display_name || undefined;
  const oaUrl =
    w.best_oa_location?.pdf_url ||
    w.best_oa_location?.landing_page_url ||
    w.open_access?.oa_url ||
    undefined;
  const topics = (w.topics ?? [])
    .map((t) => t.display_name || "")
    .filter(Boolean);
  const doi = w.doi
    ? w.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    : undefined;
  return {
    id: bareId(w.id),
    title: w.display_name || "Untitled",
    year: w.publication_year,
    authors,
    venue,
    citedByCount: w.cited_by_count ?? 0,
    isOA: !!w.open_access?.is_oa,
    oaUrl: oaUrl || undefined,
    topics,
    doi,
  };
}

function toDetail(w: OAWork): WorkDetail {
  return {
    ...toSummary(w),
    abstract: reconstructAbstract(w.abstract_inverted_index),
    referencedCount: (w.referenced_works ?? []).length,
    relatedIds: (w.related_works ?? []).map(bareId).filter(Boolean),
  };
}

function userAgent(mailto?: string): string {
  return mailto
    ? `HermesDesktop/1.0 (mailto:${mailto})`
    : "HermesDesktop/1.0 (+https://github.com/NousResearch/hermes-agent)";
}

export function createOpenAlexClient(opts: OpenAlexClientOpts): OpenAlexClient {
  const { fetchImpl, apiKey, mailto } = opts;

  function buildUrl(
    path: string,
    params: Record<string, string | number | undefined>,
  ): string {
    const url = new URL(OPENALEX_BASE + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    // `mailto` opts into OpenAlex's faster "polite pool"; `api_key` raises the
    // free daily allowance. Both are optional query params, not auth headers.
    if (mailto) url.searchParams.set("mailto", mailto);
    if (apiKey) url.searchParams.set("api_key", apiKey);
    return url.toString();
  }

  async function getJson(url: string): Promise<unknown> {
    const res = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": userAgent(mailto) },
    });
    if (!res.ok) throw new Error(`OpenAlex request failed: ${res.status}`);
    return res.json();
  }

  async function searchWorks(
    q: string,
    o: SearchOpts = {},
  ): Promise<WorkSummary[]> {
    const url = buildUrl("/works", {
      search: q,
      per_page: Math.min(Math.max(o.perPage ?? 20, 1), 100),
      filter: o.filter,
      sort: o.sort,
      select: WORK_SELECT,
    });
    const data = (await getJson(url)) as { results?: OAWork[] };
    return (data.results ?? []).map(toSummary);
  }

  async function getWork(id: string): Promise<WorkDetail> {
    const url = buildUrl(`/works/${encodeURIComponent(bareId(id))}`, {
      select: WORK_DETAIL_SELECT,
    });
    const data = (await getJson(url)) as OAWork;
    return toDetail(data);
  }

  async function groupBy(
    filter: string,
    group: string,
  ): Promise<GroupBucket[]> {
    const url = buildUrl("/works", {
      filter,
      group_by: group,
      per_page: 1, // we only want meta.group_by; minimize the results payload
    });
    const data = (await getJson(url)) as {
      group_by?: { key: string; key_display_name?: string; count: number }[];
    };
    return (data.group_by ?? []).map((g) => ({
      key: g.key,
      keyDisplayName: g.key_display_name ?? g.key,
      count: g.count,
    }));
  }

  async function autocomplete(
    entity: string,
    q: string,
  ): Promise<AutocompleteItem[]> {
    const url = buildUrl(`/autocomplete/${encodeURIComponent(entity)}`, { q });
    const data = (await getJson(url)) as {
      results?: { id?: string; display_name?: string; hint?: string }[];
    };
    return (data.results ?? []).map((r) => ({
      id: bareId(r.id),
      label: r.display_name ?? "",
      hint: r.hint || undefined,
    }));
  }

  return { searchWorks, getWork, groupBy, autocomplete, buildUrl };
}
