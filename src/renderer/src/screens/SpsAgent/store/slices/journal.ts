// journal.ts — the calendar/diary slice.
//
// A journal entry is just a page flagged `journal: true` with `date`/`time`
// metadata (see PageMeta). That means entries reuse the entire page stack — the
// block editor, media blocks, markdown mirror, vault parity, search and the
// note-index — for free. This slice only adds: which day the calendar is
// focused on, and a one-call "new entry" action.
import type { StateCreator } from "zustand";
import { blk } from "../../lib/ids";
import { isoFromDate, hmFromDate } from "../../lib/journalDates";
import type { Store, JournalSlice } from "../storeTypes";

export const createJournalSlice: StateCreator<Store, [], [], JournalSlice> = (
  set,
  get,
) => ({
  journalDate: isoFromDate(new Date()),

  setJournalDate: (date) => set({ journalDate: date }),

  openJournal: (date) =>
    set((s) => ({
      surface: "journal",
      journalDate: date ?? s.journalDate,
    })),

  createJournalEntry: (date) => {
    const now = new Date();
    const day = date ?? get().journalDate ?? isoFromDate(now);
    const time = hmFromDate(now);
    const id = get().makePage(
      {
        icon: "📔",
        title: "Untitled entry",
        journal: true,
        date: day,
        time,
      },
      [blk("p", "")],
      null,
    );
    set({ page: id, surface: "doc", journalDate: day });
    get().flash("Journal entry created");
    return id;
  },

  setEntryMood: (id, mood) =>
    set((s) =>
      s.meta[id] ? { meta: { ...s.meta, [id]: { ...s.meta[id], mood } } } : {},
    ),
});
