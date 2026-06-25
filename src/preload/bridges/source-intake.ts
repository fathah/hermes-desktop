import { ipcRenderer } from "electron";
import type {
  SourceIntakeResult,
  SourceIntakeStatus,
} from "../../shared/source-intake";
import type { SourceIntakeBridgeApi } from "./source-intake.types";

export const sourceIntakeBridge = {
  sourceIntakeStatus: (): Promise<SourceIntakeStatus> =>
    ipcRenderer.invoke("source-intake-status"),
  sourceIntakePreviewUrl: (url: string): Promise<SourceIntakeResult> =>
    ipcRenderer.invoke("source-intake-preview-url", url),
  sourceIntakeInstallInstructions: (): Promise<string> =>
    ipcRenderer.invoke("source-intake-install-instructions"),
} satisfies SourceIntakeBridgeApi;
