// Shared skills-registry IPC type — single source of truth for the autopoietic
// skills registry row. Producer: src/main/skills-registry.ts. Contract:
// src/preload/index.d.ts. Consumer: the renderer Skills screen.

export interface SkillEntry {
  id?: number;
  name: string;
  description: string;
  keywords: string;
  status: string;
  entrypoint: string;
  dependencies: string;
  created_at?: string;
}
