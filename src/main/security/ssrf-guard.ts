import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import ipaddr from "ipaddr.js";

// ───────────────────────── SSRF guard ─────────────────────────
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

export function ipIsBlocked(addr: string): boolean {
  let ip: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    ip = ipaddr.parse(addr);
  } catch {
    return true;
  }
  if (ip.kind() === "ipv6") {
    const v6 = ip as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) ip = v6.toIPv4Address();
  }
  return BLOCKED_RANGES.has(ip.range());
}

/**
 * undici connect `lookup`: resolve the hostname, reject if ANY resolved address
 * is non-public, and PIN the connection to the validated address. Because undici
 * re-invokes this for every connection — including each redirect hop — a public
 * URL cannot 302 into an internal address, and there is no second unguarded DNS
 * resolution for a rebinding attacker to win.
 */
export function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number,
  ) => void,
): void {
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  const pin = (addr: string): void => {
    const family = net.isIP(addr);
    if (!family || ipIsBlocked(addr)) {
      callback(new Error("blocked host"), "", 0);
      return;
    }
    if (options.all) {
      callback(null, [{ address: addr, family }]);
      return;
    }
    callback(null, addr, family);
  };
  if (net.isIP(host)) {
    pin(host);
    return;
  }
  dns.lookup(host, { all: true }, (err, addresses) => {
    if (err) {
      callback(err, "", 0);
      return;
    }
    if (!addresses.length) {
      callback(new Error("unresolved host"), "", 0);
      return;
    }
    if (addresses.some((a) => ipIsBlocked(a.address))) {
      callback(new Error("blocked host"), "", 0);
      return;
    }
    pin(addresses[0].address);
  });
}

// Exported so other main-process fetchers (e.g. src/main/openalex.ts) reuse the
// SAME IP-pinning dispatcher instead of cloning the SSRF guard — keeps the
// load-bearing audit surface single-sourced (see CLAUDE.md).
export const guardedAgent = new Agent({ connect: { lookup: guardedLookup } });

type FetchInput = Parameters<typeof undiciFetch>[0];
type FetchInit = NonNullable<Parameters<typeof undiciFetch>[1]>;

export function safeFetch(
  input: FetchInput,
  init: FetchInit = {},
): ReturnType<typeof undiciFetch> {
  return undiciFetch(input, {
    ...init,
    redirect: init.redirect ?? "follow",
    dispatcher: guardedAgent,
  });
}
