// openalex.ts — main-process backend for the Research (OpenAlex) integration.
//
// Wraps the Electron-free shared client (src/shared/openalex/core.ts) with the
// three things only the main process can supply:
//   • the SSRF-hardened `safeFetch` wrapper from security/ssrf-guard.ts, so a redirect cannot pivot to an internal address;
//   • per-machine config (polite-pool `mailto` + optional `api_key`) read from
//     desktop.json — these are read by OUR code, never the Hermes gateway, so
//     they don't belong in config.yaml;
//   • a read-through disk cache to stay within OpenAlex's free daily allowance.
import { join } from "path";
import {
  createOpenAlexClient,
  type FetchLike,
  type OpenAlexClient,
  type SearchOpts,
  type WorkSummary,
  type WorkDetail,
} from "../shared/openalex/core";
import { safeFetch } from "./security/ssrf-guard";
import { profileHome, getActiveProfileNameSync } from "./utils";
import { readDesktopConfig, writeDesktopConfig } from "./config";
import {
  cacheGet,
  cacheSet,
  SEARCH_TTL_MS,
  WORK_TTL_MS,
} from "./research-cache";

const REQUEST_TIMEOUT_MS = 10_000;

// ── config (desktop.json — read by us, not the gateway) ──
interface ResearchConfig {
  mailto: string;
  apiKey: string;
}

export function getResearchConfig(): ResearchConfig {
  const d = readDesktopConfig();
  return {
    mailto: typeof d.openalexMailto === "string" ? d.openalexMailto : "",
    apiKey: typeof d.openalexApiKey === "string" ? d.openalexApiKey : "",
  };
}

/** Renderer-safe view: never hands the key back to the renderer. */
export function getPublicResearchConfig(): {
  mailto: string;
  hasApiKey: boolean;
} {
  const c = getResearchConfig();
  return { mailto: c.mailto, hasApiKey: c.apiKey.length > 0 };
}

export function setResearchConfig(mailto: string, apiKey?: string): void {
  const d = readDesktopConfig();
  d.openalexMailto = mailto;
  if (apiKey !== undefined) d.openalexApiKey = apiKey;
  writeDesktopConfig(d);
}

// ── client (IP-pinned fetch + current config) ──
const guardedFetch: FetchLike = (url, init) =>
  safeFetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: init?.headers,
  });

function client(): OpenAlexClient {
  const { apiKey, mailto } = getResearchConfig();
  return createOpenAlexClient({
    fetchImpl: guardedFetch,
    apiKey: apiKey || undefined,
    mailto: mailto || undefined,
  });
}

function cacheDir(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "sps-agent",
    "research-cache",
  );
}

// ── public API (called by the IPC handlers) ──
export async function oaSearchWorks(
  q: string,
  opts: SearchOpts = {},
  profile?: string,
): Promise<WorkSummary[]> {
  const key = `works:search:${q}:${opts.perPage ?? ""}:${opts.filter ?? ""}:${opts.sort ?? ""}`;
  const dir = cacheDir(profile);
  const hit = await cacheGet<WorkSummary[]>(dir, key, SEARCH_TTL_MS);
  if (hit) return hit;
  const results = await client().searchWorks(q, opts);
  await cacheSet(dir, key, results);
  return results;
}

export async function oaGetWork(
  id: string,
  profile?: string,
): Promise<WorkDetail> {
  const key = `works:get:${id}`;
  const dir = cacheDir(profile);
  const hit = await cacheGet<WorkDetail>(dir, key, WORK_TTL_MS);
  if (hit) return hit;
  const work = await client().getWork(id);
  await cacheSet(dir, key, work);
  return work;
}
