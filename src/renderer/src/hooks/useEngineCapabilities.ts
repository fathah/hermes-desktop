import { useCallback, useEffect, useState } from "react";
import type { EngineCapabilityState } from "../../../shared/engine-capabilities";

export interface UseEngineCapabilitiesResult {
  state: EngineCapabilityState | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useEngineCapabilities(
  profile?: string,
  enabled = true,
): UseEngineCapabilitiesResult {
  const [state, setState] = useState<EngineCapabilityState | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setLoading(false);
      setState(null);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    window.hermesAPI
      .getEngineCapabilities(profile)
      .then((next) => {
        if (cancelled) return;
        setState(next);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, profile]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await window.hermesAPI.refreshEngineCapabilities(profile);
      setState(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [profile]);

  return { state, loading, refreshing, error, refresh };
}
