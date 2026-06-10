// useNoteIndex.ts — renderer hooks over the SPS-vault note index (S3/S4). The
// index is the derived SQLite layer over the mirrored markdown; these hooks let
// UI read it (backlinks, search, database queries) without touching the JSON
// store. All are best-effort: empty when the gateway/index is unavailable.
import { useCallback, useEffect, useRef, useState } from "react";

const MD_SUFFIX = /\.md$/;

/** Phase 1.7 — a counter that bumps whenever the main process rebuilds the note
 *  index. Including it in a data hook's effect deps makes that hook refetch on
 *  rebuild, so search / graph / backlinks stop showing stale results. */
function useIndexRebuildVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const api = window.hermesAPI;
    if (!api?.onSpsIndexRebuilt) return;
    const unsubscribe = api.onSpsIndexRebuilt(() => {
      setVersion((v) => v + 1);
    });
    return unsubscribe;
  }, []);
  return version;
}

export interface VaultRow {
  path: string;
  title: string;
  props: Record<string, unknown>;
  mtime: number;
}

export interface VaultFilter {
  prop: string;
  op: "eq" | "neq" | "contains" | "exists";
  value?: unknown;
}

/** Rows of a folder-backed database (S4), with a manual refetch after writes. */
export function useVaultQuery(
  scope: string | undefined,
  filters?: VaultFilter[],
  sort?: { prop: string; dir: "asc" | "desc" },
): { rows: VaultRow[]; refetch: () => void } {
  const [rows, setRows] = useState<VaultRow[]>([]);
  const rebuildVersion = useIndexRebuildVersion();
  // Serialize the query so the effect only re-runs on a real change.
  const key = JSON.stringify({ scope, filters, sort });
  const refetch = useCallback(() => {
    if (!scope) {
      setRows([]);
      return;
    }
    const api = window.hermesAPI;
    if (!api?.spsIndexQuery) return;
    api
      .spsIndexQuery({ scope, filters, sort })
      .then((r) => setRows(r as VaultRow[]))
      .catch(() => setRows([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    refetch();
  }, [refetch, rebuildVersion]);
  return { rows, refetch };
}

/** Page ids that [[wikilink]] to the given page (derived from the vault graph). */
export function useVaultBacklinks(pageId: string | null): string[] {
  const [backlinks, setBacklinks] = useState<string[]>([]);
  const rebuildVersion = useIndexRebuildVersion();
  useEffect(() => {
    let cancelled = false;
    setBacklinks([]);
    if (!pageId) return;
    const api = window.hermesAPI;
    if (!api?.spsIndexBacklinks) return;
    api
      .spsIndexBacklinks(`${pageId}.md`)
      .then((rows) => {
        if (!cancelled) setBacklinks(rows.map((p) => p.replace(MD_SUFFIX, "")));
      })
      .catch(() => {
        if (!cancelled) setBacklinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pageId, rebuildVersion]);
  return backlinks;
}

export interface VaultEdge {
  source: string;
  target: string;
  type?: string;
}

/** All [[wikilink]] edges between pages (pageIds, .md stripped) for the graph
 *  view (F4). Best-effort: empty when the gateway/index is unavailable. */
export function useVaultGraph(): { edges: VaultEdge[]; refetch: () => void } {
  const [edges, setEdges] = useState<VaultEdge[]>([]);
  const rebuildVersion = useIndexRebuildVersion();
  const refetch = useCallback(() => {
    const api = window.hermesAPI;
    if (!api?.spsIndexLinks) return;
    api
      .spsIndexLinks()
      .then((rows) =>
        setEdges(
          rows.map((e) => ({
            source: e.source.replace(MD_SUFFIX, ""),
            target: e.target.replace(MD_SUFFIX, ""),
            type: e.type,
          })),
        ),
      )
      .catch(() => setEdges([]));
  }, []);
  useEffect(() => {
    refetch();
  }, [refetch, rebuildVersion]);
  return { edges, refetch };
}

export interface VaultHit {
  pageId: string;
  title: string;
  snippet: string;
}

/** Debounced full-text search across the mirrored SPS pages on disk. */
export function useVaultSearch(query: string): VaultHit[] {
  const [hits, setHits] = useState<VaultHit[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rebuildVersion = useIndexRebuildVersion();
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    const api = window.hermesAPI;
    if (!api?.spsIndexSearch) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api
        .spsIndexSearch(q, 6)
        .then((rows) =>
          setHits(
            rows.map((r) => ({
              pageId: r.path.replace(MD_SUFFIX, ""),
              title: r.title,
              snippet: r.snippet,
            })),
          ),
        )
        .catch(() => setHits([]));
    }, 180);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, rebuildVersion]);
  return hits;
}
