// unfurl.ts — Vite dev middleware implementing GET /api/unfurl?url=…
// Fetches the target page server-side (browsers can't, due to CORS) and extracts
// OpenGraph/Twitter/title/description/favicon.
//
// SSRF hardening (a regex on the hostname string is NOT enough):
//   • We DNS-resolve the hostname and reject if ANY resolved address is in a
//     loopback/private/link-local/ULA/reserved/CGNAT range (parsed with ipaddr.js,
//     not regex — so 2130706433, 0x7f.., and ::ffff:127.0.0.1 are all caught).
//   • redirect: "manual" — every hop's Location is re-resolved + re-checked before
//     the next request, so a public URL can't 302 into the metadata endpoint.
//   • Hostname is normalized; IP literals are parsed with net.isIP / ipaddr.js.
// Residual risk: DNS rebinding between our lookup and fetch()'s own lookup. To fully
// close it in production, pin the validated IP via a custom undici dispatcher whose
// `connect` re-checks the socket's remote address.
//
// For production, port this same handler to an edge function / serverless route.
import dns from "node:dns";
import net from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import ipaddr from "ipaddr.js";
import type { Plugin } from "vite";

const BLOCKED_RANGES = new Set([
  "unspecified",
  "loopback",
  "linkLocal",
  "uniqueLocal",
  "private",
  "reserved",
  "broadcast",
  "carrierGradeNat",
]);

/** True if an IP literal falls in any non-public range (IPv4-mapped IPv6 unwrapped). */
function ipIsBlocked(addr: string): boolean {
  let ip: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    ip = ipaddr.parse(addr);
  } catch {
    return true; // unparseable → treat as unsafe
  }
  if (ip.kind() === "ipv6") {
    const v6 = ip as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) ip = v6.toIPv4Address();
  }
  return BLOCKED_RANGES.has(ip.range());
}

/** Reject the host unless every resolved (or literal) address is public. */
async function assertHostAllowed(hostname: string): Promise<void> {
  // normalize: lowercase, drop trailing dot, strip [..] brackets off IPv6 literals
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  if (!host) throw new Error("blocked host");
  if (net.isIP(host)) {
    if (ipIsBlocked(host)) throw new Error("blocked host");
    return;
  }
  const results = await dns.promises.lookup(host, { all: true });
  if (!results.length) throw new Error("unresolved host");
  for (const { address } of results) {
    if (ipIsBlocked(address)) throw new Error("blocked host");
  }
}

/** Fetch with manual redirect following, re-validating the host on every hop. */
async function safeFetch(start: URL): Promise<Response> {
  let url = start;
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:$/.test(url.protocol)) throw new Error("blocked scheme");
    await assertHostAllowed(url.hostname);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    let r: Response;
    try {
      r = await fetch(url.href, {
        signal: ctrl.signal,
        redirect: "manual",
        headers: { "User-Agent": "SPSAgentBot/1.0 (+link-preview)" },
      });
    } finally {
      clearTimeout(timer);
    }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) return r;
      url = new URL(loc, url.href);
      continue;
    }
    return r;
  }
  throw new Error("too many redirects");
}

function pick(html: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decodeEntities(m[1].trim());
  }
  return undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function absolute(base: string, ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  try {
    return new URL(ref, base).href;
  } catch {
    return undefined;
  }
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const reqUrl = new URL(req.url || "", "http://localhost");
  const raw = reqUrl.searchParams.get("url") || "";
  const json = (code: number, body: unknown) => {
    res.statusCode = code;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  };
  let target: URL;
  try {
    target = new URL(raw.startsWith("http") ? raw : "https://" + raw);
  } catch {
    return json(400, { error: "invalid url" });
  }
  if (!/^https?:$/.test(target.protocol)) {
    return json(400, { error: "blocked scheme" });
  }
  try {
    // safeFetch resolves + range-checks the host on every hop (incl. redirects).
    const r = await safeFetch(target);
    const html = (await r.text()).slice(0, 200_000);
    const host = target.hostname.replace("www.", "");
    const title =
      pick(html, [
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
        /<title[^>]*>([^<]+)<\/title>/i,
      ]) || host;
    const desc =
      pick(html, [
        /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
      ]) || "";
    const image = absolute(
      target.href,
      pick(html, [
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      ]),
    );
    const favicon =
      absolute(
        target.href,
        pick(html, [
          /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i,
        ]),
      ) || absolute(target.href, "/favicon.ico");
    return json(200, { url: target.href, title, desc, image, favicon });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    // guard rejections are client errors; everything else is an upstream failure
    const blocked = /blocked|unresolved|too many redirects/.test(msg);
    return json(blocked ? 400 : 502, { error: msg });
  }
}

export function unfurlPlugin(): Plugin {
  return {
    name: "sps-unfurl",
    configureServer(server) {
      server.middlewares.use("/api/unfurl", (req, res) => {
        handle(req, res).catch(() => {
          res.statusCode = 500;
          res.end('{"error":"internal"}');
        });
      });
    },
  };
}
