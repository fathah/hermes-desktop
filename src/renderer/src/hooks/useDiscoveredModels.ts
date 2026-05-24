import { useEffect, useRef, useState } from "react";

export type DiscoveryStatus =
  | "idle"
  | "loading"
  | "ok"
  | "no-key"
  | "unsupported"
  | "unknown-host"
  | "error";

export interface UseDiscoveredModelsArgs {
  provider: string;
  baseUrl?: string;
  // Explicit API key override.  When absent the main process falls back to
  // reading the matching <NAME>_API_KEY from the profile's .env.
  apiKey?: string;
  profile?: string;
  // When true the hook is paused — used so the Providers page only fires
  // after the user has finished switching providers, and so the Models
  // modal doesn't fire before it's even open.
  enabled?: boolean;
  // Bump to force a manual refetch (cache-busting).  Pair with a refresh
  // button in the UI.
  refreshToken?: number;
}

export interface UseDiscoveredModelsResult {
  models: string[];
  status: DiscoveryStatus;
  cached: boolean;
}

/**
 * Fetch the provider's advertised model list via the main-process IPC
 * and re-fetch whenever provider/baseUrl change, after a 400 ms debounce
 * (avoids hammering when the user is mid-typing in the BaseUrl field).
 */
export function useDiscoveredModels(
  args: UseDiscoveredModelsArgs,
): UseDiscoveredModelsResult {
  const {
    provider,
    baseUrl,
    apiKey,
    profile,
    enabled = true,
    refreshToken,
  } = args;
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<DiscoveryStatus>("idle");
  const [cached, setCached] = useState(false);
  const cancelRef = useRef(0);

  useEffect(() => {
    if (!enabled || !provider) {
      setStatus("idle");
      setModels([]);
      setCached(false);
      return;
    }
    const seq = ++cancelRef.current;
    setStatus("loading");
    const handle = setTimeout(async () => {
      try {
        const result = await window.hermesAPI.discoverProviderModels(
          provider,
          baseUrl,
          apiKey,
          profile,
        );
        if (seq !== cancelRef.current) return; // a later call superseded us
        setModels(result.models);
        setCached(result.cached);
        setStatus(result.status);
      } catch {
        if (seq !== cancelRef.current) return;
        setStatus("error");
        setModels([]);
        setCached(false);
      }
    }, 400);
    return (): void => {
      clearTimeout(handle);
    };
  }, [enabled, provider, baseUrl, apiKey, profile, refreshToken]);

  return { models, status, cached };
}
