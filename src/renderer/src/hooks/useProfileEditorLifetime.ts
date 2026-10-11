import { useCallback, useEffect, useRef } from "react";
import type { ProfileEditorTarget } from "../../../shared/profile-editor-target";

export interface ProfileEditorScope {
  target?: ProfileEditorTarget;
  isCurrent?: (target: ProfileEditorTarget) => boolean;
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
