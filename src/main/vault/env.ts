/** Round-trip-safe .env parse, merge, and serialize utilities. */

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isImportableEnvKey(key: string): boolean {
  return ENV_KEY_RE.test(key);
}

export function parseEnvLineValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed;
    }
  }
  if (
    trimmed.startsWith("'") &&
    trimmed.endsWith("'") &&
    trimmed.length >= 2
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseEnvFile(content: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1);
    if (isImportableEnvKey(key)) {
      result.set(key, parseEnvLineValue(rawValue));
    }
  }
  return result;
}

export function serializeEnvLine(key: string, value: string): string {
  if (/[\n\r#"'\\]/.test(value) || /^\s/.test(value)) {
    return `${key}=${JSON.stringify(value)}`;
  }
  if (!/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return `${key}=${JSON.stringify(value)}`;
  }
  return `${key}=${value}`;
}

export function mergeEnv(existing: string, managed: Map<string, string>): string {
  if (!existing.trim()) {
    const lines = [
      "# Managed by Hermes Workspace — do not edit manually",
      "# Secrets are encrypted in vault.db and synced on profile activation",
      "",
    ];
    for (const [key, value] of managed) {
      lines.push(serializeEnvLine(key, value));
    }
    return lines.join("\n").replace(/\n*$/, "\n");
  }

  const seen = new Set<string>();
  const out: string[] = [];

  for (const line of existing.replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match && managed.has(match[1])) {
      if (!seen.has(match[1])) {
        out.push(serializeEnvLine(match[1], managed.get(match[1])!));
        seen.add(match[1]);
      }
      continue;
    }
    out.push(line);
  }

  for (const [key, value] of managed) {
    if (!seen.has(key)) {
      out.push(serializeEnvLine(key, value));
    }
  }

  return out.join("\n").replace(/\n*$/, "\n");
}

export function stripManagedKeys(
  existing: string,
  keys: Iterable<string>,
): string {
  const remove = new Set(keys);
  const lines = existing
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
      return !(match && remove.has(match[1]));
    });
  const joined = lines.join("\n").replace(/\n*$/, "\n");
  return joined === "" ? "\n" : joined;
}
