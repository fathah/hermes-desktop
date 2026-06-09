// Barrel for the desktop config layer. The implementation lives in focused
// modules under ./config/ (one per concern: secrets, the desktop.json store,
// connection config, the .env store, config.yaml access, model config, the
// API-server-key resolver, the config-fix log, platform toggles, and the
// credential pool). This file preserves the historical `from "./config"`
// import surface so callers did not have to change when the module was split.
//
// The shared 5s TTL cache (./config/cache) is an internal detail of the
// env-store / model-config / api-server-key modules and is intentionally NOT
// re-exported here.

export * from "./config/secrets";
export * from "./config/desktop-store";
export * from "./config/connection-config";
export * from "./config/env-store";
export * from "./config/yaml-config";
export * from "./config/model-config";
export * from "./config/api-server-key";
export * from "./config/fix-log";
export * from "./config/platforms";
export * from "./config/credential-pool";
