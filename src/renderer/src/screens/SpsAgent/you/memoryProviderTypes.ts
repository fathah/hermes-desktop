// Provider descriptor for the optional external memory backend, surfaced in the
// "Memory provider" section of the You surface. Mirrors what
// `discoverMemoryProviders` returns. (Relocated from the deleted admin Memory
// screen's types.ts when memory management moved into SPS You.)
export interface MemoryProviderInfo {
  name: string;
  description: string;
  installed: boolean;
  active: boolean;
  envVars: string[];
}
