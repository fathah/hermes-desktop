import { createContext, useContext } from "react";

/** Optional callbacks supplied by whoever opens the profile modal. */
export interface OpenProfileOptions {
  /** Fired after any successful mutation so the opener can refresh its list. */
  onChanged?: () => void;
  /** Fired after the profile is deleted. */
  onDeleted?: (name: string) => void;
}

export interface ProfileModalContextValue {
  /** Open the global profile modal for `name`. */
  openProfile: (name: string, opts?: OpenProfileOptions) => void;
  /** Close the modal if open. */
  closeProfile: () => void;
}

export const ProfileModalContext =
  createContext<ProfileModalContextValue | null>(null);

/**
 * Access the global profile modal. Call `openProfile(name)` from anywhere
 * under the ProfileModalProvider (the sidebar, the Agents screen, …).
 */
export function useProfileModal(): ProfileModalContextValue {
  const ctx = useContext(ProfileModalContext);
  if (!ctx) {
    throw new Error(
      "useProfileModal must be used within a ProfileModalProvider",
    );
  }
  return ctx;
}
