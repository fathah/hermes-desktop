export interface SpsAutomationPrefs {
  autoApply: boolean;
  ingestIntervalMin: number;
  lintIntervalMin: number;
}

export type SpsAutomationPrefsPatch = Partial<SpsAutomationPrefs>;
