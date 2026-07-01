import net from "node:net";
import ipaddr from "ipaddr.js";
import { safeFetch } from "./ssrf-guard";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type FetchResult = ReturnType<typeof fetch>;

const LOCAL_PROVIDER_RANGES = new Set([
  "loopback",
  "private",
  "uniqueLocal",
  "linkLocal",
  "unspecified",
  "carrierGradeNat",
]);

function urlString(input: FetchInput): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (
    typeof Request !== "undefined" &&
    input instanceof Request &&
    typeof input.url === "string"
  ) {
    return input.url;
  }
  return null;
}

export function isExplicitLocalOrPrivateUrl(input: FetchInput): boolean {
  const raw = urlString(input);
  if (!raw) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost") return true;

  const family = net.isIP(host);
  if (!family) return false;

  try {
    let ip = ipaddr.parse(host);
    if (ip.kind() === "ipv6") {
      const v6 = ip as ipaddr.IPv6;
      if (v6.isIPv4MappedAddress()) ip = v6.toIPv4Address();
    }
    return LOCAL_PROVIDER_RANGES.has(ip.range());
  } catch {
    return false;
  }
}

export function publicFetch(input: FetchInput, init?: FetchInit): FetchResult {
  return safeFetch(
    input as Parameters<typeof safeFetch>[0],
    init as Parameters<typeof safeFetch>[1],
  ) as unknown as FetchResult;
}

export function providerFetch(
  input: FetchInput,
  init?: FetchInit,
): FetchResult {
  if (isExplicitLocalOrPrivateUrl(input)) {
    return fetch(input, init);
  }
  return publicFetch(input, init);
}

export const gatewayFetch = providerFetch;
