import { useCallback, useMemo, useState } from "react";
import SettingsModal from "./SettingsModal";
import {
  SettingsModalContext,
  type OpenSettingsOptions,
} from "./SettingsModalContext";

interface OpenState {
  /** Nav item to land on (resolved by SettingsModal). */
  section?: string;
  profile?: string;
}

/**
 * Mounts the single global settings modal at the app root and exposes
 * `openSettings` / `closeSettings` via context (see `useSettingsModal`). Only
 * one settings modal is open at a time; opening again replaces the target.
 */
export function SettingsModalProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState<OpenState | null>(null);
  const [visible, setVisible] = useState(false);

  const openSettings = useCallback(
    (section?: string, opts?: OpenSettingsOptions) => {
      setOpen({ section, profile: opts?.profile });
      setVisible(true);
    },
    [],
  );
  const closeSettings = useCallback(() => setVisible(false), []);
  const clearSettings = useCallback(() => {
    if (!visible) setOpen(null);
  }, [visible]);

  const value = useMemo(
    () => ({ openSettings, closeSettings }),
    [openSettings, closeSettings],
  );

  return (
    <SettingsModalContext.Provider value={value}>
      {children}
      {open && (
        <SettingsModal
          profile={open.profile}
          initialSection={open.section}
          open={visible}
          onClose={closeSettings}
          onExited={clearSettings}
        />
      )}
    </SettingsModalContext.Provider>
  );
}
