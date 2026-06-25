import type * as Api from "../api-types";

export interface SourceIntakeBridgeApi {
  sourceIntakeStatus: () => Promise<Api.SourceIntakeStatus>;

  sourceIntakePreviewUrl: (url: string) => Promise<Api.SourceIntakeResult>;

  sourceIntakeInstallInstructions: () => Promise<string>;
}
