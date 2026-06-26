export interface ActionReceiptRef {
  kind: string;
  id: string;
}

export interface ActionReceipt {
  ts: number;
  source: string;
  action: string;
  outcome: string;
  profile?: string;
  summary?: string;
  counts?: Record<string, number>;
  refs?: ActionReceiptRef[];
}

type ReceiptInput = Record<string, unknown>;

const MAX_TEXT_CHARS = 180;
const SAFE_KEY_RE = /^[a-z][a-z0-9-]{0,39}$/;
const URL_RE = /\bhttps?:\/\/[^\s)]+/gi;
const SECRET_RE =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35})\b/g;
const SECRET_ASSIGNMENT_RE =
  /\b((?:api[-_]?key|apikey|secret|token|password|passwd|pwd|access[-_]?key|auth[-_]?token|bearer)[A-Za-z0-9_-]*)(["']?\s*[:=]\s*["']?)([A-Za-z0-9_\-./+=]{8,})/gi;
const FORBIDDEN_COUNT_KEYS = new Set([
  "apikey",
  "api-key",
  "api_key",
  "token",
  "secret",
  "password",
  "query",
  "snippet",
  "url",
  "href",
  "content",
  "raw",
  "text",
  "command",
]);

function cleanKey(value: unknown, fallback: string): string {
  const raw =
    typeof value === "string"
      ? value.trim().toLowerCase()
      : String(value ?? "");
  const slug = raw.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return SAFE_KEY_RE.test(slug) ? slug : fallback;
}

export function redactLedgerText(value: unknown): string {
  const raw = typeof value === "string" ? value : String(value ?? "");
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const redacted = collapsed
    .replace(URL_RE, "[redacted-url]")
    .replace(SECRET_RE, "[redacted]")
    .replace(
      SECRET_ASSIGNMENT_RE,
      (_match, key: string, sep: string) => `${key}${sep}[redacted]`,
    )
    .replace(/\|/g, "/");
  const clean = redacted || "(no summary)";
  return clean.length <= MAX_TEXT_CHARS
    ? clean
    : `${clean.slice(0, MAX_TEXT_CHARS).trimEnd()}...`;
}

function cleanCounts(input: unknown): Record<string, number> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(input)) {
    const safeKey = cleanKey(key, "");
    if (!safeKey || FORBIDDEN_COUNT_KEYS.has(safeKey)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    out[safeKey] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanRefs(input: unknown): ActionReceiptRef[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const refs: ActionReceiptRef[] = [];
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

export function normalizeActionReceipt(
  input: ReceiptInput,
  now: () => number = Date.now,
): ActionReceipt {
  const ts =
    typeof input.ts === "number" && Number.isFinite(input.ts)
      ? input.ts
      : now();
  const receipt: ActionReceipt = {
    ts,
    source: cleanKey(input.source, "system"),
    action: cleanKey(input.action, "action"),
    outcome: cleanKey(input.outcome, "recorded"),
  };

  if (typeof input.profile === "string" && input.profile.trim()) {
    receipt.profile = redactLedgerText(input.profile);
  }
  receipt.summary = redactLedgerText(input.summary);

  const counts = cleanCounts(input.counts);
  if (counts) receipt.counts = counts;

  const refs = cleanRefs(input.refs);
  if (refs) receipt.refs = refs;

  return receipt;
}

export function serializeActionReceipt(receipt: ActionReceipt): string {
  return `${JSON.stringify(receipt)}\n`;
}
