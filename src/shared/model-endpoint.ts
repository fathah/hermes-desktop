/**
 * Canonical form used when comparing model endpoint identities.
 *
 * URL schemes and host names are case-insensitive, while paths, queries, and
 * fragments may be case-sensitive and must be preserved. Trailing path slashes
 * are ignored so an endpoint remains idempotent when a form adds one.
 */
export function normalizeModelEndpointUrl(
  value: string | null | undefined,
): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    if (!parsed.hostname) return trimmed.replace(/\/+$/, "");
    const credentials =
      parsed.username || parsed.password
        ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@`
        : "";
    const lowerHostname = parsed.hostname.toLowerCase();
    const hostname =
      lowerHostname.includes(":") && !lowerHostname.startsWith("[")
        ? `[${lowerHostname}]`
        : lowerHostname;
    const port = parsed.port ? `:${parsed.port}` : "";
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol.toLowerCase()}//${credentials}${hostname}${port}${path}${parsed.search}${parsed.hash}`;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}
