import {
  analyticsSnapshotToRow,
  contentIdeaToRow,
  contentRunToRow,
  draftVariantToRow,
  publishedPostToRow,
  type AnalyticsSnapshot,
  type ContentIdea,
  type ContentRun,
  type ContentStudioRow,
  type DraftVariant,
  type PublishedPost,
} from "../../../../../shared/content-studio";
import { rowToMarkdown } from "../editor/rowMarkdown";

export async function exportContentStudioRow(
  row: ContentStudioRow,
  profile = "default",
): Promise<void> {
  const markdown = rowToMarkdown(row.props, row.body);
  if (profile && profile !== "default") {
    await window.hermesAPI.spsExportRow?.(
      row.folder,
      row.rowId,
      markdown,
      profile,
    );
    return;
  }
  await window.hermesAPI.spsExportRow?.(row.folder, row.rowId, markdown);
}

export function contentStudioRowMarkdown(row: ContentStudioRow): string {
  return rowToMarkdown(row.props, row.body);
}

export function saveContentIdea(
  idea: ContentIdea,
  profile = "default",
): Promise<void> {
  return exportContentStudioRow(contentIdeaToRow(idea), profile);
}

export function saveContentRun(
  run: ContentRun,
  profile = "default",
): Promise<void> {
  return exportContentStudioRow(contentRunToRow(run), profile);
}

export function saveDraftVariant(
  variant: DraftVariant,
  profile = "default",
): Promise<void> {
  return exportContentStudioRow(draftVariantToRow(variant), profile);
}

export function saveAnalyticsSnapshot(
  snapshot: AnalyticsSnapshot,
  profile = "default",
): Promise<void> {
  return exportContentStudioRow(analyticsSnapshotToRow(snapshot), profile);
}

export function savePublishedPost(
  post: PublishedPost,
  profile = "default",
): Promise<void> {
  return exportContentStudioRow(publishedPostToRow(post), profile);
}
