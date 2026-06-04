/**
 * Shared types for the "Discover" community marketplace. The catalog is served
 * from the hermes-registry GitHub repo and consumed by both the main process
 * (fetch + install) and the renderer (browse UI).
 */

export type RegistryKind = "skills" | "mcps" | "agents" | "workflows";

export interface RegistryItem {
  /** Stable identifier, unique within its kind. */
  id: string;
  name: string;
  description: string;
  author?: string;
  category?: string;
  tags?: string[];
  homepage?: string;
  version?: string;
  license?: string;
  platforms?: string[];
  /** Folder for this entry within the registry repo (e.g. "skills/apple/apple-notes"). */
  path?: string;
  /** Bundled skills only: install identifier for `hermes skills install`. */
  source?: string;
}

export interface RegistryCatalog {
  skills: RegistryItem[];
  mcps: RegistryItem[];
  agents: RegistryItem[];
  workflows: RegistryItem[];
}

export interface InstalledRegistry {
  skills: string[];
  mcps: string[];
  workflows: string[];
}

/** One labeled row in a structured (non-prose) detail view. */
export interface RegistryDetailRow {
  label: string;
  /** Plain or monospace value. */
  value?: string;
  mono?: boolean;
  /** Pill chips (e.g. tags, env keys, permissions). */
  chips?: string[];
}

/**
 * Detail shown in the item modal: either a prose doc (markdown) or a
 * structured spec (lead paragraph + labeled rows) for manifest-only entries.
 */
export interface RegistryDetail {
  markdown?: string;
  description?: string;
  rows?: RegistryDetailRow[];
}
