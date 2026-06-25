import { safeHandle } from "../safe-handle";
import {
  createAssistantRecipe,
  deleteAssistantRecipe,
  listAssistantRecipeRuns,
  listAssistantRecipes,
  runAssistantRecipe,
  saveAssistantRecipeRun,
  updateAssistantRecipe,
} from "../../assistant-recipes";
import {
  exportLocalExpertPack,
  getLocalExpertPack,
  importLocalExpertPack,
  installLocalExpertPack,
  listLocalExpertPacks,
  previewLocalExpertPack,
  uninstallLocalExpertPack,
} from "../../local-experts";
import {
  enableLocalExpertChecks,
  runLocalExpertChecks,
} from "../../local-experts/macos-checks";
import type {
  AssistantRecipePatch,
  CreateAssistantRecipeInput,
} from "../../../shared/assistant-recipes";

export function registerSpsLearningIpc(): void {
  safeHandle("sps-list-assistant-recipes", (_event, profile?: string) =>
    listAssistantRecipes(profile),
  );
  safeHandle(
    "sps-create-assistant-recipe",
    (_event, input: CreateAssistantRecipeInput, profile?: string) =>
      createAssistantRecipe(input, profile),
  );
  safeHandle(
    "sps-update-assistant-recipe",
    (_event, id: string, patch: AssistantRecipePatch, profile?: string) =>
      updateAssistantRecipe(id, patch, profile),
  );
  safeHandle(
    "sps-delete-assistant-recipe",
    (_event, id: string, profile?: string) =>
      deleteAssistantRecipe(id, profile),
  );
  safeHandle(
    "sps-run-assistant-recipe",
    (_event, id: string, userInput?: string, profile?: string) =>
      runAssistantRecipe(id, userInput, profile),
  );
  safeHandle(
    "sps-list-assistant-recipe-runs",
    (_event, recipeId?: string, profile?: string) =>
      listAssistantRecipeRuns(recipeId, profile),
  );
  safeHandle(
    "sps-save-assistant-recipe-run",
    (_event, runId: string, profile?: string) =>
      saveAssistantRecipeRun(runId, profile),
  );
  safeHandle("sps-list-local-experts", (_event, profile?: string) =>
    listLocalExpertPacks(profile),
  );
  safeHandle(
    "sps-get-local-expert",
    (_event, packId: string, profile?: string) =>
      getLocalExpertPack(packId, profile),
  );
  safeHandle(
    "sps-install-local-expert",
    (_event, packId: string, profile?: string) =>
      installLocalExpertPack(packId, profile),
  );
  safeHandle(
    "sps-uninstall-local-expert",
    (_event, packId: string, profile?: string) =>
      uninstallLocalExpertPack(packId, profile),
  );
  safeHandle(
    "sps-preview-local-expert-pack",
    (_event, filePath: string, profile?: string) =>
      previewLocalExpertPack(filePath, profile),
  );
  safeHandle(
    "sps-import-local-expert-pack",
    (_event, filePath: string, profile?: string) =>
      importLocalExpertPack(filePath, profile),
  );
  safeHandle(
    "sps-export-local-expert-pack",
    (_event, packId: string, targetPath: string, profile?: string) =>
      exportLocalExpertPack(packId, targetPath, profile),
  );
  safeHandle(
    "sps-enable-local-expert-checks",
    (_event, packId: string, profile?: string) =>
      enableLocalExpertChecks(packId, profile),
  );
  safeHandle(
    "sps-run-local-expert-checks",
    (_event, packId: string, profile?: string) =>
      runLocalExpertChecks(packId, profile),
  );
}
