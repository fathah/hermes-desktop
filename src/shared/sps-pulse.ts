import { redactLedgerText } from "./action-receipts";

export interface SpsPulseRef {
  kind: string;
  id: string;
}

export interface SpsPulse {
  ts: string;
  source: string;
  kind: string;
  summary: string;
  refs?: SpsPulseRef[];
}

type PulseInput = Record<string, unknown>;

const SAFE_KEY_RE = /^[a-z][a-z0-9-]{0,39}$/;

function cleanKey(value: unknown, fallback: string): string {
  const raw =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : String(value ?? "");
  const slug = raw.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return SAFE_KEY_RE.test(slug) ? slug : fallback;
}

function cleanTs(value: unknown, now: () => string): string {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return now();
}

function cleanRefs(input: unknown): SpsPulseRef[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const refs: SpsPulseRef[] = [];
  for (const ref of input) {
    if (!ref || typeof ref !== "object") continue;
    const row = ref as Record<string, unknown>;
    const kind = cleanKey(row.kind, "");
    const id = redactLedgerText(row.id).slice(0, 96);
    if (!kind || !id || id === "(no summary)") continue;
    refs.push({ kind, id });
    if (refs.length >= 8) break;
  }
  return refs.length ? refs : undefined;
}

export function normalizeSpsPulse(
  input: PulseInput,
  now: () => string = () => new Date().toISOString(),
): SpsPulse {
  const pulse: SpsPulse = {
    ts: cleanTs(input.ts, now),
    source: cleanKey(input.source, "system"),
    kind: cleanKey(input.kind, "event"),
    summary: redactLedgerText(input.summary),
  };
  const refs = cleanRefs(input.refs);
  if (refs) pulse.refs = refs;
  return pulse;
}

export function formatSpsPulseLine(pulse: SpsPulse): string {
  const refs = pulse.refs?.length
    ? ` | refs: ${pulse.refs.map((ref) => `${ref.kind}:${ref.id}`).join(", ")}`
    : "";
  return `- ${pulse.ts} | ${pulse.source}/${pulse.kind} | ${pulse.summary}${refs}`;
}

export function parseSpsPulseLine(line: string): SpsPulse | null {
  const match = line.match(
    /^-\s+([^|]+)\s+\|\s+([^/|]+)\/([^|]+)\s+\|\s+([^|]+?)(?:\s+\|\s+refs:\s+(.+))?$/,
  );
  if (!match) return null;
  const refs =
    match[5]
      ?.split(",")
      .map((part) => part.trim())
      .map((part) => {
        const [kind, ...rest] = part.split(":");
        return { kind: kind ?? "", id: rest.join(":") };
      })
      .filter((ref) => ref.kind && ref.id) ?? undefined;
  return normalizeSpsPulse({
    ts: match[1]?.trim(),
    source: match[2]?.trim(),
    kind: match[3]?.trim(),
    summary: match[4]?.trim(),
    refs,
  });
}
