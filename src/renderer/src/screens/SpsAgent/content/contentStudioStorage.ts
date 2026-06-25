import {
  analyticsSnapshotToRow,
  contentEvidenceToRow,
  contentIdeaToRow,
  contentRunToRow,
  CONTENT_STUDIO_FOLDERS,
  draftVariantToRow,
  publishedPostToRow,
  type AnalyticsSnapshot,
  type ContentEvidence,
  type ContentIdea,
  type ContentRun,
  type ContentStudioRow,
  type ContentStudioVaultRow,
  type DraftVariant,
  type PublishedPost,
} from "../../../lib/content-studio";
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

export function saveContentEvidence(
  evidence: ContentEvidence,
  profile = "default",
): Promise<void> {
  return exportContentStudioRow(contentEvidenceToRow(evidence), profile);
}

export async function listContentStudioRows(
  folder: string,
  profile = "default",
): Promise<ContentStudioVaultRow[]> {
  const api = window.hermesAPI;
  if (!api?.spsIndexQuery) return [];
  const rows =
    profile && profile !== "default"
      ? await api.spsIndexQuery({ scope: folder }, profile)
      : await api.spsIndexQuery({ scope: folder });
  return rows as ContentStudioVaultRow[];
}

export async function readContentStudioDashboardRows(
  profile = "default",
): Promise<{
  ideas: ContentStudioVaultRow[];
  runs: ContentStudioVaultRow[];
  drafts: ContentStudioVaultRow[];
  published: ContentStudioVaultRow[];
  analytics: ContentStudioVaultRow[];
}> {
  const [ideas, runs, drafts, published, analytics] = await Promise.all([
    listContentStudioRows(CONTENT_STUDIO_FOLDERS.ideas, profile),
    listContentStudioRows(CONTENT_STUDIO_FOLDERS.runs, profile),
    listContentStudioRows(CONTENT_STUDIO_FOLDERS.drafts, profile),
    listContentStudioRows(CONTENT_STUDIO_FOLDERS.published, profile),
    listContentStudioRows(CONTENT_STUDIO_FOLDERS.analytics, profile),
  ]);
  return { ideas, runs, drafts, published, analytics };
}
