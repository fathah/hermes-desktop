/**
 * Shape of a credential-pool entry as the upstream engine expects
 * (issue #367). Old entries written by the renderer with just
 * `{key, label}` are still readable via the optional `key` field.
 * New entries written from the UI use the canonical shape.
 *
 * Canonical home for this type. Previously duplicated verbatim in
 * src/preload/index.ts, src/preload/index.d.ts, and Providers.tsx because
 * the two tsconfig projects don't share the preload .d.ts (#367). Both
 * projects compile src/shared, so this single source resolves the seam.
 */
export interface CredentialPoolEntry {
  id?: string;
  label?: string;
  auth_type?: "api_key" | "oauth_device_code" | string;
  priority?: number;
  source?: string;
  access_token?: string;
  refresh_token?: string;
  api_key?: string;
  base_url?: string;
  request_count?: number;
  /** Legacy field for backward compat with old auth.json shapes. */
  key?: string;
}
