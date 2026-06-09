// spsCommands.ts — menu-command event bus.
//
// The Electron menu (⌘N "New Chat", ⌘K "Search") fires IPC that only the App
// root catches (once, always-mounted). App then re-dispatches the intent as a
// DOM event to whichever surface is active — the SPS workspace when the admin
// overlay is closed, the admin Layout when it's open. This indirection keeps App
// from importing the SPS store or Layout internals, and fixes the old bug where
// the listeners lived in Layout and went dead whenever the overlay was closed.

export const SPS_NEW_CHAT_EVENT = "sps:new-chat";
export const SPS_SEARCH_EVENT = "sps:search";
export const ADMIN_NEW_CHAT_EVENT = "hermes:admin-new-chat";

declare global {
  interface WindowEventMap {
    [SPS_NEW_CHAT_EVENT]: CustomEvent;
    [SPS_SEARCH_EVENT]: CustomEvent;
    [ADMIN_NEW_CHAT_EVENT]: CustomEvent;
  }
}

/** Start a new chat in the SPS workspace. */
export function spsNewChat(): void {
  window.dispatchEvent(new CustomEvent(SPS_NEW_CHAT_EVENT));
}

/** Open the SPS command palette (universal search). */
export function spsSearch(): void {
  window.dispatchEvent(new CustomEvent(SPS_SEARCH_EVENT));
}

/** Start a new chat in the admin overlay's Chat view. */
export function adminNewChat(): void {
  window.dispatchEvent(new CustomEvent(ADMIN_NEW_CHAT_EVENT));
}
