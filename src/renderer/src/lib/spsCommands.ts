// spsCommands.ts — menu-command event bus.
//
// The Electron menu (⌘N "New Chat", ⌘K "Search") fires IPC that only the App
// root catches (once, always-mounted). App then re-dispatches the intent as a
// DOM event to the SPS workspace. This indirection keeps App from importing the
// SPS store internals, and fixes the old bug where the listeners lived in Layout
// and went dead whenever the overlay was closed. (The admin overlay no longer
// hosts a chat surface, so both ⌘N and ⌘K always target the SPS workspace.)

export const SPS_NEW_CHAT_EVENT = "sps:new-chat";
export const SPS_SEARCH_EVENT = "sps:search";
// Recovery action from a remote-mode block: ask App (which owns the screen
// state machine) to switch the connection back to local and re-run the check.
export const SWITCH_TO_LOCAL_EVENT = "hermes:switch-to-local";

declare global {
  interface WindowEventMap {
    [SPS_NEW_CHAT_EVENT]: CustomEvent;
    [SPS_SEARCH_EVENT]: CustomEvent;
    [SWITCH_TO_LOCAL_EVENT]: CustomEvent;
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

/** Ask App to switch the connection back to local mode. */
export function switchToLocal(): void {
  window.dispatchEvent(new CustomEvent(SWITCH_TO_LOCAL_EVENT));
}
