// pendingDrain.ts — apply Live Note pending proposals through ingestCommitPage.
import { commitChangeset } from "../inbox/ingestApply";
import type { LiveNotePending } from "../../../../../shared/liveNotes";

export type DrainContext = {
  profile?: string;
  /** Active page id (skip autoApply when dirty on that page). */
  activePageId?: string;
  isDirty?: boolean;
  commitPage: (page: {
    op: "create" | "update";
    pageId: string;
    title: string;
    markdown: string;
  }) => void;
};

/**
 * Drain live-note pending files. autoApply items apply unless the open page
 * is dirty; non-auto items are left for manual accept (returned in leftover).
 */
export async function drainLiveNotePending(
  ctx: DrainContext,
): Promise<{ applied: number; leftover: LiveNotePending[] }> {
  const api = window.hermesAPI;
  if (!api?.spsLiveNoteListPending) {
    return { applied: 0, leftover: [] };
  }
  const pending = await api.spsLiveNoteListPending(ctx.profile);
  const leftover: LiveNotePending[] = [];
  let applied = 0;

  for (const item of pending) {
    const dirtyBlock =
      item.autoApply &&
      ctx.isDirty === true &&
      ctx.activePageId === item.pageId;
    if (!item.autoApply || dirtyBlock) {
      leftover.push(item);
      continue;
    }
    await commitChangeset(
      {
        summary: item.summary,
        pages: [
          {
            op: "update",
            pageId: item.pageId,
            title: item.title,
            markdown: item.proposedBody,
          },
        ],
        captures: [],
        memory: [],
      },
      ctx.commitPage,
      { profile: ctx.profile },
    );
    await api.spsLiveNoteAckApplied?.(
      item.id,
      item.liveNoteId,
      item.summary,
      ctx.profile,
    );
    applied += 1;
  }

  return { applied, leftover };
}

export async function applyLiveNotePending(
  item: LiveNotePending,
  ctx: DrainContext,
): Promise<boolean> {
  const api = window.hermesAPI;
  if (!api?.spsLiveNoteAckApplied) return false;
  await commitChangeset(
    {
      summary: item.summary,
      pages: [
        {
          op: "update",
          pageId: item.pageId,
          title: item.title,
          markdown: item.proposedBody,
        },
      ],
      captures: [],
      memory: [],
    },
    ctx.commitPage,
    { profile: ctx.profile },
  );
  await api.spsLiveNoteAckApplied(
    item.id,
    item.liveNoteId,
    item.summary,
    ctx.profile,
  );
  return true;
}
