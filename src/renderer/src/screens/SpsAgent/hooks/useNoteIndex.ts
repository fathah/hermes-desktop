// useNoteIndex.ts — renderer hooks over the SPS-vault note index (S3). The index
// is the derived SQLite layer over the mirrored markdown; these hooks let UI read
// it (backlinks, full-text search) without touching the JSON store. All are
// best-effort: they return empty when the gateway/index is unavailable.
import { useEffect, useRef, useState } from "react";

const MD_SUFFIX = /\.md$/;

/** Page ids that [[wikilink]] to the given page (derived from the vault graph). */
export function useVaultBacklinks(pageId: string | null): string[] {
  const [backlinks, setBacklinks] = useState<string[]>([]);
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
  }, [pageId]);
  return backlinks;
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
  }, [query]);
  return hits;
}
