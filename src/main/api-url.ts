// Shared normalization for the Hermes One backend base URL, used both when
// resolving the endpoint from env (hermes-account.ts) and when reading the URL
// persisted in account.json (account-store.ts) — so a URL stored as http:// by
// an earlier login is corrected on read without forcing a re-login.

/**
 * Drop trailing slashes and upgrade a remote `http://` origin to `https://`.
 * Remote backends serve https and 301-redirect http→https; Node's fetch strips
 * the `Authorization` header across that cross-origin (scheme-change) redirect,
 * so authenticated calls (agent/wallet sync) would silently 401 even though
 * anonymous device login survives the redirect. Localhost stays http so the
 * Nitro dev server still works.
 */
export function normalizeApiUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(
      url.hostname,
    );
    if (url.protocol === "http:" && !isLocal) {
      url.protocol = "https:";
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    // Not a parseable URL — return the trimmed value untouched.
  }
  return trimmed;
}
