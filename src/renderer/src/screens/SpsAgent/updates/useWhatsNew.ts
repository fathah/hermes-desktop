import { useEffect, useMemo, useState } from "react";
import {
  RELEASE_AFFORDANCES,
  releaseAffordancesSince,
  type ReleaseAffordance,
  type ReleasePlatform,
} from "../../../../../shared/update-affordances";

const LAST_SEEN_KEY = "hermes-desktop-last-seen-version";

function readLastSeen(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function writeLastSeen(version: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, version);
  } catch {
    /* localStorage may be unavailable in sandboxed renderers */
  }
}

export function useWhatsNew(): {
  currentVersion: string | null;
  items: ReleaseAffordance[];
  dismiss: () => void;
} {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [lastSeen, setLastSeen] = useState<string | null>(() => readLastSeen());

  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .getAppVersion()
      .then((version) => {
        if (cancelled) return;
        setCurrentVersion(version);
        if (!readLastSeen()) {
          writeLastSeen(version);
          setLastSeen(version);
        }
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
    return releaseAffordancesSince(
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
  }, [currentVersion, lastSeen]);

  return {
    currentVersion,
    items,
    dismiss: () => {
      if (!currentVersion) return;
      writeLastSeen(currentVersion);
      setLastSeen(currentVersion);
    },
  };
}
