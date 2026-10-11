import { useCallback, useEffect, useRef, useState } from "react";
import type { ProfileEditorTarget } from "../../../shared/profile-editor-target";

export function useProfileEditorTarget(
  profile?: string,
  connectionId?: string,
): {
  target: ProfileEditorTarget | null;
  revision: number;
  error: string;
  isCurrent: (target: ProfileEditorTarget) => boolean;
} {
  const current = useRef<ProfileEditorTarget | null>(null);
  const generation = useRef(0);
  const [target, setTarget] = useState<ProfileEditorTarget | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const scope = `${connectionId || "active"}:${profile || "active"}`;
  const currentScope = useRef(scope);
  if (currentScope.current !== scope) {
    currentScope.current = scope;
    current.current = null;
  }
  useEffect(() => {
    let disposed = false;
    const reload = (): void => {
      const request = ++generation.current;
      current.current = null;
      setTarget(null);
      setError("");
      setRevision((value) => value + 1);
      void window.hermesAPI
        .getProfileEditorTarget(profile, connectionId)
        .then((next) => {
          if (disposed || generation.current !== request) return;
          current.current = next;
          setTarget(next);
        })
        .catch((reason) => {
          if (disposed || generation.current !== request) return;
          setError(reason instanceof Error ? reason.message : String(reason));
        });
    };
    const unsubscribe = window.hermesAPI.onConnectionConfigChanged(reload);
    reload();
    return () => {
      disposed = true;
      generation.current += 1;
      current.current = null;
      unsubscribe();
    };
  }, [profile, connectionId]);
  const isCurrent = useCallback(
    (snapshot: ProfileEditorTarget) => current.current === snapshot,
    [],
  );
  return {
    target: current.current === target ? target : null,
    revision,
    error,
    isCurrent,
  };
}
