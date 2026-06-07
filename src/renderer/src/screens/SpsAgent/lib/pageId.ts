// Canonical path → page/row id extractor for the SPS vault.
// Strips the folder prefix and the .md suffix from an index/vault path:
//   "Wiki/acme-corp.md" → "acme-corp"
// Consolidates four near-identical copies that lived in QueryDatabase / InboxSurface
// / HealthSurface / ReportLedger (rowIdOf / pageIdOf / slugOf).
export function pageIdFromPath(path: string): string {
  const basename = path.split("/").pop() ?? "";
  return basename.replace(/\.md$/, "");
}
