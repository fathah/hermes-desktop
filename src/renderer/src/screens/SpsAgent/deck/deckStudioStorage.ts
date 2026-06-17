import type {
  DeckProject,
  DeckStudioVaultRow,
} from "../../../../../shared/deck-studio";

export function saveDeckProject(
  project: DeckProject,
  profile = "default",
): Promise<{ ok: boolean; rowId?: string }> {
  return window.hermesAPI.deckSave(project, profile);
}

export function listDeckProjects(
  profile = "default",
): Promise<DeckStudioVaultRow[]> {
  return window.hermesAPI.deckList(profile);
}

export function readDeckProject(
  rowId: string,
  profile = "default",
): Promise<DeckProject | null> {
  return window.hermesAPI.deckRead(rowId, profile);
}
