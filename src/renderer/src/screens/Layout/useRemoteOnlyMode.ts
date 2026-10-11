import { useEffect, useState } from "react";

interface ModeSnapshot {
  connectionId: string;
  remote: boolean;
}

/** Keep local mutation controls hidden while a new target's mode is unresolved. */
export function useRemoteOnlyMode(connectionId: string, view: string): boolean {
  const [snapshot, setSnapshot] = useState<ModeSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    const refresh = (invalidate = false): void => {
      const id = ++requestId;
      if (invalidate) setSnapshot(null);
      void window.hermesAPI.isRemoteOnlyMode().then(
        (remote) => {
          if (!cancelled && id === requestId) {
            setSnapshot({ connectionId, remote });
          }
        },
        () => {
          if (!cancelled && id === requestId) setSnapshot(null);
        },
      );
    };
    refresh();
    const unsubscribe = window.hermesAPI.onConnectionConfigChanged(() =>
      refresh(true),
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [connectionId, view]);

  return snapshot?.connectionId === connectionId ? snapshot.remote : true;
}
