import type { BrowserWindow } from "electron";
import { safeHandle } from "../safe-handle";
import { requireLocalWorkspace } from "../connection-guards";
import {
  ackLiveNoteApplied,
  deleteLiveNote,
  dismissLiveNotePending,
  getLiveNoteByPageId,
  listLiveNotePending,
  listLiveNotes,
  runLiveNote,
  setLiveNoteActive,
  setLiveNotesWindowGetter,
  upsertLiveNote,
} from "../../live-notes";
import type { LiveNoteInput } from "../../../shared/liveNotes";

export function registerSpsLiveNotesIpc(
  getWindow: () => BrowserWindow | null,
): void {
  setLiveNotesWindowGetter(getWindow);

  safeHandle("sps-live-note-list", (_e, profile?: string) => {
    requireLocalWorkspace();
    return listLiveNotes(profile);
  });

  safeHandle("sps-live-note-get", (_e, pageId: string, profile?: string) => {
    requireLocalWorkspace();
    return getLiveNoteByPageId(pageId, profile);
  });

  safeHandle(
    "sps-live-note-upsert",
    (_e, input: LiveNoteInput, profile?: string) => {
      requireLocalWorkspace();
      return upsertLiveNote(input, profile);
    },
  );

  safeHandle(
    "sps-live-note-set-active",
    (_e, pageId: string, active: boolean, profile?: string) => {
      requireLocalWorkspace();
      return setLiveNoteActive(pageId, active, profile);
    },
  );

  safeHandle("sps-live-note-delete", (_e, pageId: string, profile?: string) => {
    requireLocalWorkspace();
    return deleteLiveNote(pageId, profile);
  });

  safeHandle("sps-live-note-run", (_e, pageId: string, profile?: string) => {
    requireLocalWorkspace();
    return runLiveNote(pageId, "manual", {
      profile,
      getWindow,
      bypassBackoff: true,
    });
  });

  safeHandle("sps-live-note-list-pending", (_e, profile?: string) => {
    requireLocalWorkspace();
    return listLiveNotePending(profile);
  });

  safeHandle(
    "sps-live-note-dismiss-pending",
    (_e, id: string, profile?: string) => {
      requireLocalWorkspace();
      return dismissLiveNotePending(id, profile);
    },
  );

  safeHandle(
    "sps-live-note-ack-applied",
    (
      _e,
      pendingId: string,
      liveNoteId: string,
      summary: string,
      profile?: string,
    ) => {
      requireLocalWorkspace();
      return ackLiveNoteApplied(pendingId, liveNoteId, summary, profile);
    },
  );
}
