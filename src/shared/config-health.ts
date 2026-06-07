// Shared config-health IPC types — single source of truth for the diagnostics
// surface. Producer: src/main/config-health.ts. Contract: src/preload/index.d.ts.
// (The renderer Settings/ConfigHealth screens keep deliberately looser local
// copies — the tighter shared report is assignable to them.)

export type Severity = "error" | "warning" | "info";

export type IssueCode =
  | "API_SERVER_KEY_NON_CANONICAL"
  | "API_SERVER_KEY_MULTIPLE_VALUES"
  | "EMPTY_API_SERVER_KEY"
  | "MODEL_KEY_MISSING"
  | "UI_RUNTIME_ENVKEY_MISMATCH"
  | "NON_ASCII_CREDENTIAL"
  | "SIBLING_HERMES_HOME_DRIFT"
  | "LEGACY_TOOLSET_NAME";

export interface ConfigHealthIssue {
  code: IssueCode;
  severity: Severity;
  message: string;
  detail?: string;
  /** Filesystem paths involved — shown to the user verbatim. */
  locations: string[];
  autoFixable: boolean;
  fixDescription?: string;
  fixLocation?: "providers" | "models" | ".env" | "config.yaml" | "setup";
  /** Optional context for the auto-fix routine (e.g. which env var). */
  context?: Record<string, string>;
}

export interface ConfigHealthReport {
  ranAt: number;
  profile: string;
  issues: ConfigHealthIssue[];
  summary: { errors: number; warnings: number; infos: number };
}
