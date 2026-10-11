import { useCallback, useEffect, useRef } from "react";
import type { ProfileEditorTarget } from "../../../shared/profile-editor-target";

export interface ProfileEditorScope {
  target?: ProfileEditorTarget;
  isCurrent?: (target: ProfileEditorTarget) => boolean;
}

interface MemoryMutationScope {
  revision: number;
  pending: Promise<void> | null;
  credentialWrite: Promise<void> | null;
}

// Opaque target identity survives editor remounts; these transient revisions
// prevent a still-mounted sibling from writing positions from an older read.
const memoryScopes = new Map<string, MemoryMutationScope>();
function memoryScope(target: ProfileEditorTarget): MemoryMutationScope {
  let scope = memoryScopes.get(target.scopeToken);
  if (!scope) {
    scope = { revision: 0, pending: null, credentialWrite: null };
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

// Credential writes share target ownership, but never lock positional controls.
// Keep a failed save until a replacement write confirms the credential instead.
export function queueProfileMemoryCredential(
  target: ProfileEditorTarget,
  write: () => Promise<void>,
): Promise<void> {
  const scope = memoryScope(target);
  const previous = scope.credentialWrite;
  const pending = (async (): Promise<void> => {
    if (previous) await previous.catch(() => undefined);
    await write();
  })();
  scope.credentialWrite = pending;
  void pending.then(
    () => {
      if (scope.credentialWrite === pending) scope.credentialWrite = null;
    },
    () => {},
  );
  return pending;
}

export async function waitForProfileMemoryCredentials(
  target: ProfileEditorTarget,
  requireSuccess = true,
): Promise<void> {
  const scope = memoryScope(target);
  while (scope.credentialWrite) {
    const pending = scope.credentialWrite;
    // Turning a provider off only needs ordering, not valid credentials. Keep
    // a rejected save in the queue so activation still requires a replacement.
    if (requireSuccess) await pending;
    else await pending.catch(() => undefined);
    if (scope.credentialWrite === pending) return;
  }
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
