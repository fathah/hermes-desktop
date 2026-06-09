// In-memory cache with a short TTL, shared across the config submodules
// (env-store, model-config, api-server-key). Invalidation is by key prefix,
// so a writer in one module can invalidate another module's cached read
// (e.g. setEnvValue / setConfigValue invalidating the "apiServerKey:" entry).

const CACHE_TTL = 5000; // 5 seconds
const _cache = new Map<string, { data: unknown; ts: number }>();

export function getCached<T>(key: string): T | undefined {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL) {
    _cache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

export function setCache(key: string, data: unknown): void {
  _cache.set(key, { data, ts: Date.now() });
}

export function invalidateCache(prefix: string): void {
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
}
