import { useEffect, useMemo, useState } from "react";
import {
  RELEASE_AFFORDANCES,
  engineAffordancesForRange,
  releaseAffordancesSince,
  type EngineAvailableUpdate,
  type ReleasePlatform,
  type WhatsNewAffordance,
} from "../../../../../shared/update-affordances";

const LAST_SEEN_KEY = "hermes-desktop-last-seen-version";
const ENGINE_LAST_SEEN_KEY = "hermes-engine-last-seen-update-range";

function readStoredValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage may be unavailable in sandboxed renderers */
  }
}

export function useWhatsNew(): {
  currentVersion: string | null;
  items: WhatsNewAffordance[];
  dismiss: () => void;
} {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [lastSeen, setLastSeen] = useState<string | null>(() =>
    readStoredValue(LAST_SEEN_KEY),
  );
  const [lastSeenEngineRange, setLastSeenEngineRange] = useState<string | null>(
    () => readStoredValue(ENGINE_LAST_SEEN_KEY),
  );
  const [availableEngineUpdate, setAvailableEngineUpdate] =
    useState<EngineAvailableUpdate | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .getAppVersion()
      .then((version) => {
        if (cancelled) return;
        setCurrentVersion(version);
        if (!readStoredValue(LAST_SEEN_KEY)) {
          writeStoredValue(LAST_SEEN_KEY, version);
          setLastSeen(version);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .getHermesUpstreamWatchState()
      .then((state) => {
        if (cancelled) return;
        setAvailableEngineUpdate(state.availableUpdate ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo(() => {
    if (!currentVersion) return [];
    const platform = window.electron?.process?.platform as
      | ReleasePlatform
      | undefined;
    const releaseItems = releaseAffordancesSince(
      lastSeen,
      currentVersion,
      RELEASE_AFFORDANCES,
    ).filter((item) => {
      if (item.platforms && platform && !item.platforms.includes(platform)) {
        return false;
      }
      if (item.requiresApi && !(item.requiresApi in window.hermesAPI)) {
        return false;
      }
      return true;
    });
    const engineItems = engineAffordancesForRange(
      availableEngineUpdate,
      lastSeenEngineRange,
    );
    return [...releaseItems, ...engineItems];
  }, [availableEngineUpdate, currentVersion, lastSeen, lastSeenEngineRange]);

  const visibleEngineRange = useMemo(() => {
    const range = availableEngineUpdate?.range;
    if (!range) return null;
    return items.some((item) => "source" in item && item.source === "engine")
      ? range
      : null;
  }, [availableEngineUpdate?.range, items]);

  return {
    currentVersion,
    items,
    dismiss: () => {
      if (currentVersion) {
        writeStoredValue(LAST_SEEN_KEY, currentVersion);
        setLastSeen(currentVersion);
      }
      if (visibleEngineRange) {
        writeStoredValue(ENGINE_LAST_SEEN_KEY, visibleEngineRange);
        setLastSeenEngineRange(visibleEngineRange);
      }
    },
  };
}
