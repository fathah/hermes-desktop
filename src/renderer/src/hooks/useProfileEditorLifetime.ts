import { useCallback, useEffect, useRef } from "react";
import type { ProfileEditorTarget } from "../../../shared/profile-editor-target";

export interface ProfileEditorScope {
  target?: ProfileEditorTarget;
  isCurrent?: (target: ProfileEditorTarget) => boolean;
}

interface MemoryMutationScope {
  revision: number;
  pending: Promise<void> | null;
}

// Opaque target identity survives editor remounts; these transient revisions
// prevent a still-mounted sibling from writing positions from an older read.
const memoryScopes = new Map<string, MemoryMutationScope>();
function memoryScope(target: ProfileEditorTarget): MemoryMutationScope {
  let scope = memoryScopes.get(target.scopeToken);
  if (!scope) {
    scope = { revision: 0, pending: null };
    memoryScopes.set(target.scopeToken, scope);
  }
  return scope;
}
export function profileMemoryRevision(target: ProfileEditorTarget): number {
  return memoryScope(target).revision;
}
export async function waitForProfileMemoryMutations(
  target: ProfileEditorTarget,
): Promise<number> {
  const scope = memoryScope(target);
  while (scope.pending) await scope.pending;
  return scope.revision;
}
export function beginProfileMemoryMutation(
  target: ProfileEditorTarget,
  readRevision: number,
): (() => void) | null {
  const scope = memoryScope(target);
  if (scope.pending || scope.revision !== readRevision) return null;
  let settle!: () => void;
  const pending = new Promise<void>((resolve) => {
    settle = resolve;
  });
  scope.revision += 1;
  scope.pending = pending;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    if (scope.pending === pending) scope.pending = null;
    settle();
  };
}

export function useProfileEditorLifetime({
  target,
  isCurrent,
}: ProfileEditorScope): () => boolean {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(
    () => mounted.current && (!target || !!isCurrent?.(target)),
    [target, isCurrent],
  );
}
