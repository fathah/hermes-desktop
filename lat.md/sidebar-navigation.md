# Sidebar recent sessions

The sidebar has no standalone "Sessions" nav item — the recent-chats list lives directly under the **Chat** nav item (ChatGPT-style), and the full session list opens in a modal via "Show more".

[[src/renderer/src/screens/Layout/Layout.tsx#Layout]] special-cases the `chat` entry of `NAV_ITEMS` to render the Chat button, a collapse chevron (state persisted under `hermes.sidebar.sessionsExpanded`), and [[src/renderer/src/screens/Layout/SidebarRecentSessions.tsx]] beneath it. There is no `sessions` view in the `View` union.

## Inline list and "Show more"

The inline list shows at most `RECENT_SESSIONS_LIMIT` (5) most-recent sessions; a plus-icon "Show more" button appears only when the profile has more than that.

[[src/renderer/src/screens/Layout/SidebarRecentSessions.tsx]] fetches one row over the limit (from the `sessions.json` cache, then a `state.db` sync) so a single query decides whether to render the button — it slices to 5 for display and sets `hasMore` from the raw length. Loading rows use a rotating lucide Loader icon; clicking "Show more" calls `onShowMore`, which opens the full-list modal.

## Full-list modal

"Show more" (and the Cmd/Ctrl+K menu action) open an 80%×80% modal that reuses the existing Sessions screen rather than a separate route.

The modal in [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] renders [[src/renderer/src/screens/Sessions/Sessions.tsx]] inside a `.sessions-modal` over the shared `.models-modal-overlay` backdrop. Resuming a session or starting a new chat from the modal closes it; Esc and a backdrop click also close it. Because the Sessions screen owns its own fetching gated on `visible`, it loads only while the modal is open.

## Profile switch and active chat

The footer profile switcher keeps the selected shell profile aligned with the visible chat run, while preserving older conversations under their original profiles.

[[src/renderer/src/screens/Layout/ProfileSwitcher.tsx#ProfileSwitcher]] persists the selected profile through main-process profile switching, then [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] applies [[src/renderer/src/screens/Layout/chatRuns.ts#selectProfileRunTransition]] before rendering Chat. If the active chat is blank, it is re-homed to the selected profile; if it already belongs to another profile, the shell activates an existing blank run for the selected profile or creates a fresh one. This prevents the footer, Settings, recent sessions, and chat transport from disagreeing about which agent is active.

Opening a sidebar session after switching profiles consumes that blank selected-profile run instead of appending beside it. [[src/renderer/src/screens/Layout/chatRuns.ts#openSessionRunTransition]] replaces the active scratch run when it belongs to the same profile as the resumed session, so the tab strip shows the previous session without an extra "New conversation" tab.

## Provisional fresh sessions

Fresh chat session ids are provisional until a turn produces output or completes successfully, so provider errors do not create visible recent-session rows.

The main-process transports still send a generated `X-Hermes-Session-Id` on fresh requests to avoid gateway fingerprint collisions, but [[src/main/hermes.ts#sendMessageViaApi]] and the runs transport announce that id to the renderer only after visible output, tool/reasoning activity, or successful completion. Resumed sessions are announced immediately because the renderer already knows they are existing conversations. This keeps [[src/renderer/src/screens/Chat/hooks/useChatIPC.ts#useChatIPC]] from binding a failed first turn to a new sidebar entry.
