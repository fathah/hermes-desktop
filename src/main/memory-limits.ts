import { getYamlPath } from "./yaml-path";

export const DEFAULT_MEMORY_CHAR_LIMIT = 2200;
export const DEFAULT_USER_CHAR_LIMIT = 1375;

export interface MemoryLimits {
  memoryCharLimit: number;
  userCharLimit: number;
}

function parsePositiveInteger(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

export function parseMemoryLimitsConfig(content: string): MemoryLimits {
  return {
    memoryCharLimit:
      parsePositiveInteger(getYamlPath(content, "memory.memory_char_limit")) ??
      DEFAULT_MEMORY_CHAR_LIMIT,
    userCharLimit:
      parsePositiveInteger(getYamlPath(content, "memory.user_char_limit")) ??
      DEFAULT_USER_CHAR_LIMIT,
  };
}
