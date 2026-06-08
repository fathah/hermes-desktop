import { join } from "path";
import { readFile } from "fs/promises";
import { getSpsNoteIndex, type NoteSearchHit } from "../note-index";

const GROUNDING_HITS = 5;
const GROUNDING_EXCERPT_CHARS = 1500;

const GROUNDING_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "so",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "to",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your",
]);

export function groundingTerms(message: string): string[] {
  const tokens = message
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const tok of tokens) {
    if (tok.length < 3 || GROUNDING_STOPWORDS.has(tok) || seen.has(tok))
      continue;
    seen.add(tok);
    terms.push(tok);
  }
  return terms;
}

export interface GroundingSource {
  title: string;
  relPath: string;
  absPath: string;
  excerpt: string;
}

function excerptForGrounding(markdown: string): string {
  const withoutFm = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const trimmed = withoutFm.trim();
  if (trimmed.length <= GROUNDING_EXCERPT_CHARS) return trimmed;
  return `${trimmed.slice(0, GROUNDING_EXCERPT_CHARS)}…`;
}

export function formatRetrievalSystemMessage(
  sources: GroundingSource[],
): { role: "system"; content: string } | null {
  if (sources.length === 0) return null;
  const blocks = sources.map(
    (s) =>
      `[${s.title} · ${s.relPath}] (full file: ${s.absPath})\n${s.excerpt}`,
  );
  return {
    role: "system",
    content:
      `The following excerpts are from the user's workspace and are the ` +
      `most relevant to their message. Ground your answer in them and cite ` +
      `the source path in brackets. If an excerpt is insufficient, read the ` +
      `full file at its absolute path with the file tool. If none are ` +
      `relevant, say so and answer normally.\n\n${blocks.join("\n\n")}`,
  };
}

const QUERY_EXPANSION_VARIANTS = 3;
const QUERY_EXPANSION_TIMEOUT_MS = 12000;

export function parseQueryVariants(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const cleaned = line.replace(/^[\s\-*•\d.)]+/, "").trim();
    const key = cleaned.toLowerCase();
    if (cleaned.length > 2 && !seen.has(key)) {
      seen.add(key);
      out.push(cleaned);
    }
  }
  return out;
}

export function fuseRankings(lists: string[][], k = 60): string[] {
  const score = new Map<string, number>();
  for (const list of lists) {
    list.forEach((path, i) => {
      score.set(path, (score.get(path) ?? 0) + 1 / (k + i + 1));
    });
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([path]) => path);
}

async function expandQueryVariants(
  message: string,
  profile?: string,
): Promise<string[]> {
  const prompt =
    `Rewrite the question below as ${QUERY_EXPANSION_VARIANTS} short full-text ` +
    `search queries that use SYNONYMS and alternate phrasings for its key nouns ` +
    `(e.g. "vacation" → "holiday annual leave"; "access code" → "combination ` +
    `lock"). Keywords only, one query per line, no numbering or commentary.\n\n` +
    `Question: ${message}`;
  try {
    const timeout = new Promise<{ content: string }>((resolve) =>
      setTimeout(() => resolve({ content: "" }), QUERY_EXPANSION_TIMEOUT_MS),
    );
    // Lazy load chatCompletionOnce to resolve circular dependency
    const { chatCompletionOnce } = require("./chat-client");
    const res = await Promise.race([
      chatCompletionOnce([{ role: "user", content: prompt }], profile),
      timeout,
    ]);
    if (!("content" in res) || !res.content) return [];
    return parseQueryVariants(res.content).slice(0, QUERY_EXPANSION_VARIANTS);
  } catch {
    return [];
  }
}

export async function buildRetrievalSystemMessage(
  message: string,
  profile?: string,
  opts: { expandQuery?: boolean } = {},
): Promise<{ role: "system"; content: string } | null> {
  try {
    const terms = groundingTerms(message);
    if (terms.length === 0) return null;
    const index = await getSpsNoteIndex(profile);

    const queries = [terms.join(" ")];
    if (opts.expandQuery !== false) {
      for (const variant of await expandQueryVariants(message, profile)) {
        const variantTerms = groundingTerms(variant);
        if (variantTerms.length > 0) queries.push(variantTerms.join(" "));
      }
    }

    const perQuery = queries.map((q) => index.search(q, GROUNDING_HITS, "any"));
    const hitByPath = new Map<string, NoteSearchHit>();
    for (const list of perQuery) {
      for (const hit of list) {
        if (!hitByPath.has(hit.path)) hitByPath.set(hit.path, hit);
      }
    }
    const fused = fuseRankings(perQuery.map((list) => list.map((h) => h.path)));
    const topPaths = fused.slice(0, GROUNDING_HITS);
    if (topPaths.length === 0) return null;

    const root = index.status().root;
    const sources: GroundingSource[] = [];
    for (const path of topPaths) {
      const hit = hitByPath.get(path);
      if (!hit) continue;
      const absPath = join(root, path);
      try {
        const raw = await readFile(absPath, "utf-8");
        sources.push({
          title: hit.title || path,
          relPath: path,
          absPath,
          excerpt: excerptForGrounding(raw),
        });
      } catch {
        /* skip an unreadable hit */
      }
    }
    return formatRetrievalSystemMessage(sources);
  } catch {
    return null;
  }
}
