import { safeHandle } from "./safe-handle";
import {
  listSessions,
  getSessionMessages,
  searchSessions,
  deleteSession,
} from "../sessions";
import {
  syncSessionCache,
  listCachedSessions,
  updateSessionTitle,
} from "../session-cache";
import {
  sshListSessions,
  sshGetSessionMessages,
  sshSearchSessions,
  sshListCachedSessions,
} from "../ssh-remote";
import { registerDualHandler } from "./utility";
import { formatLogError, log } from "../log";

export function registerSessionsIpc(): void {
  // Sessions
  registerDualHandler("list-sessions", listSessions, sshListSessions);
  registerDualHandler(
    "get-session-messages",
    getSessionMessages,
    sshGetSessionMessages,
  );
  safeHandle("delete-session", (_event, sessionId: string) => {
    return deleteSession(sessionId);
  });
  registerDualHandler("search-sessions", searchSessions, sshSearchSessions);

  // Cached Sessions
  registerDualHandler(
    "list-cached-sessions",
    listCachedSessions,
    sshListCachedSessions,
  );
  registerDualHandler(
    "sync-session-cache",
    () => {
      try {
        return syncSessionCache();
      } catch (error) {
        log.error("sessions", {
          msg: "sync-session-cache failed; using local cache",
          error: formatLogError(error),
        });
        return listCachedSessions(50);
      }
    },
    async (ssh) => sshListCachedSessions(ssh, 50),
  );
  safeHandle(
    "update-session-title",
    (_event, sessionId: string, title: string) =>
      updateSessionTitle(sessionId, title),
  );
}
