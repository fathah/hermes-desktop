import { useCallback, useEffect, useRef, useState } from "react";

interface UseFastModeResult {
  fastMode: boolean;
  toggle: () => Promise<void>;
  /** Set fast mode without round-tripping through config (still persists). */
  set: (next: boolean) => Promise<void>;
}

function isFastTier(val: unknown): boolean {
  return val === "fast" || val === "priority";
}

export function useFastMode(profile?: string): UseFastModeResult {
  const [fastMode, setFastMode] = useState(false);

  const revisionRef = useRef(0);
  useEffect(() => {
    const revision = ++revisionRef.current;
    let cancelled = false;
    setFastMode(false);
    window.hermesAPI
      .getConfig("agent.service_tier", profile)
      .then((val) => {
        if (!cancelled && revision === revisionRef.current)
          setFastMode(isFastTier(val));
      })
      .catch(() => {
        if (!cancelled && revision === revisionRef.current) setFastMode(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [profile]);

  const set = useCallback(
    async (next: boolean): Promise<void> => {
      ++revisionRef.current;
      setFastMode(next);
      await window.hermesAPI.setConfig(
        "agent.service_tier",
        next ? "fast" : "normal",
        profile,
      );
    },
    [profile],
  );

  const toggle = useCallback(async (): Promise<void> => {
    await set(!fastMode);
  }, [fastMode, set]);

  return { fastMode, toggle, set };
}
