export type EngineContractKind = "cli" | "http" | "config-key" | "json-file";
export type EngineContractTier = "fail" | "warn";

export interface EngineContractEntry {
  id: string;
  kind: EngineContractKind;
  value: string;
  flags?: string[];
  fields?: string[];
  usedBy: string[];
  upstreamPaths: string[];
  tier: EngineContractTier;
}

export type EngineContractFindingVerdict =
  | "passed"
  | "broken"
  | "unknown"
  | "warn";

export type EngineContractVerificationStatus = "passed" | "broken" | "unknown";

export interface EngineContractFinding {
  entryId: string;
  kind: EngineContractKind;
  value: string;
  tier: EngineContractTier;
  verdict: EngineContractFindingVerdict;
  detail: string;
}

export interface EngineContractVerificationResult {
  checkedAt: string;
  status: EngineContractVerificationStatus;
  findings: EngineContractFinding[];
}

export const ENGINE_CONTRACT = [
  {
    id: "cli-help",
    kind: "cli",
    value: "--help",
    usedBy: ["src/main/engine-contract-verify.ts"],
    upstreamPaths: ["hermes_cli/_parser.py"],
    tier: "fail",
  },
  {
    id: "cli-version",
    kind: "cli",
    value: "--version",
    usedBy: ["src/main/installer.ts"],
    upstreamPaths: ["hermes_cli/_parser.py"],
    tier: "fail",
  },
  {
    id: "cli-doctor",
    kind: "cli",
    value: "doctor",
    usedBy: ["src/main/installer.ts"],
    upstreamPaths: ["hermes_cli/_parser.py", "hermes_cli/doctor.py"],
    tier: "fail",
  },
  {
    id: "cli-update",
    kind: "cli",
    value: "update",
    usedBy: ["src/main/installer.ts", "src/main/ssh-remote/platforms.ts"],
    upstreamPaths: ["hermes_cli/_parser.py", "hermes_cli/update.py"],
    tier: "fail",
  },
  {
    id: "cli-dump",
    kind: "cli",
    value: "dump",
    usedBy: ["src/main/installer.ts", "src/main/ssh-remote/platforms.ts"],
    upstreamPaths: ["hermes_cli/_parser.py"],
    tier: "fail",
  },
  {
    id: "cli-gateway-run",
    kind: "cli",
    value: "gateway run",
    usedBy: ["src/main/hermes/gateway-process.ts"],
    upstreamPaths: ["hermes_cli/_parser.py", "gateway/"],
    tier: "fail",
  },
  {
    id: "cli-security-audit",
    kind: "cli",
    value: "security audit",
    usedBy: ["src/main/installer.ts"],
    upstreamPaths: ["hermes_cli/_parser.py", "hermes_cli/security.py"],
    tier: "fail",
  },
  {
    id: "cli-prompt-size",
    kind: "cli",
    value: "prompt-size",
    flags: ["--json"],
    usedBy: ["src/main/installer.ts"],
    upstreamPaths: ["hermes_cli/_parser.py"],
    tier: "fail",
  },
  {
    id: "cli-profile-create",
    kind: "cli",
    value: "profile create",
    flags: ["--clone"],
    usedBy: ["src/main/profiles.ts"],
    upstreamPaths: ["hermes_cli/_parser.py", "hermes_cli/profiles.py"],
    tier: "fail",
  },
  {
    id: "cli-profile-delete",
    kind: "cli",
    value: "profile delete",
    flags: ["--yes"],
    usedBy: ["src/main/profiles.ts"],
    upstreamPaths: ["hermes_cli/_parser.py", "hermes_cli/profiles.py"],
    tier: "fail",
  },
  {
    id: "cli-profile-use",
    kind: "cli",
    value: "profile use",
    usedBy: ["src/main/profiles.ts"],
    upstreamPaths: ["hermes_cli/_parser.py", "hermes_cli/profiles.py"],
    tier: "fail",
  },
  {
    id: "cli-pairing-list",
    kind: "cli",
    value: "pairing list",
    usedBy: ["src/main/pairing.ts"],
    upstreamPaths: ["hermes_cli/_parser.py"],
    tier: "fail",
  },
  {
    id: "cli-pairing-approve",
    kind: "cli",
    value: "pairing approve",
    usedBy: ["src/main/pairing.ts"],
    upstreamPaths: ["hermes_cli/_parser.py"],
    tier: "fail",
  },
  {
    id: "cli-pairing-revoke",
    kind: "cli",
    value: "pairing revoke",
    usedBy: ["src/main/pairing.ts"],
    upstreamPaths: ["hermes_cli/_parser.py"],
    tier: "fail",
  },
  {
    id: "cli-pairing-clear-pending",
    kind: "cli",
    value: "pairing clear-pending",
    usedBy: ["src/main/pairing.ts"],
    upstreamPaths: ["hermes_cli/_parser.py"],
    tier: "fail",
  },
  {
    id: "cli-checkpoints-status",
    kind: "cli",
    value: "checkpoints status",
    usedBy: ["src/main/checkpoints.ts"],
    upstreamPaths: ["hermes_cli/_parser.py"],
    tier: "fail",
  },
  {
    id: "cli-checkpoints-prune",
    kind: "cli",
    value: "checkpoints prune",
    usedBy: ["src/main/checkpoints.ts"],
    upstreamPaths: ["hermes_cli/_parser.py"],
    tier: "fail",
  },
  {
    id: "cli-checkpoints-clear",
    kind: "cli",
    value: "checkpoints clear",
    usedBy: ["src/main/checkpoints.ts"],
    upstreamPaths: ["hermes_cli/_parser.py"],
    tier: "fail",
  },
  {
    id: "cli-mcp",
    kind: "cli",
    value: "mcp",
    usedBy: ["src/main/mcp-servers.ts"],
    upstreamPaths: ["hermes_cli/_parser.py", "hermes_cli/mcp.py"],
    tier: "fail",
  },
  {
    id: "cli-skills-search",
    kind: "cli",
    value: "skills search",
    flags: ["--json", "--limit"],
    usedBy: ["src/main/skills.ts", "src/main/ssh-remote/skills.ts"],
    upstreamPaths: ["hermes_cli/_parser.py", "hermes_cli/skills.py"],
    tier: "fail",
  },
  {
    id: "cli-skills-install",
    kind: "cli",
    value: "skills install",
    flags: ["--yes"],
    usedBy: ["src/main/skills.ts"],
    upstreamPaths: ["hermes_cli/_parser.py", "hermes_cli/skills.py"],
    tier: "fail",
  },
  {
    id: "cli-skills-uninstall",
    kind: "cli",
    value: "skills uninstall",
    usedBy: ["src/main/skills.ts"],
    upstreamPaths: ["hermes_cli/_parser.py", "hermes_cli/skills.py"],
    tier: "fail",
  },
  {
    id: "cli-computer-use-status",
    kind: "cli",
    value: "computer-use status",
    usedBy: ["src/main/installer/computer-use.ts"],
    upstreamPaths: ["hermes_cli/_parser.py"],
    tier: "fail",
  },
  {
    id: "cli-computer-use-install",
    kind: "cli",
    value: "computer-use install",
    usedBy: ["src/main/installer/computer-use.ts"],
    upstreamPaths: ["hermes_cli/_parser.py"],
    tier: "fail",
  },
  {
    id: "cli-auth-add",
    kind: "cli",
    value: "auth add",
    flags: ["--type"],
    usedBy: ["src/main/hermes-auth.ts"],
    upstreamPaths: ["hermes_cli/_parser.py", "hermes_cli/auth.py"],
    tier: "fail",
  },
  {
    id: "cli-cron",
    kind: "cli",
    value: "cron",
    usedBy: ["src/main/cronjobs.ts"],
    upstreamPaths: ["hermes_cli/_parser.py", "cron/"],
    tier: "fail",
  },
  {
    id: "cli-curator",
    kind: "cli",
    value: "curator",
    usedBy: ["src/main/cronjobs.ts"],
    upstreamPaths: ["hermes_cli/_parser.py", "cron/"],
    tier: "fail",
  },
  {
    id: "cli-kanban",
    kind: "cli",
    value: "kanban",
    usedBy: ["src/main/kanban.ts"],
    upstreamPaths: ["hermes_cli/_parser.py", "kanban/"],
    tier: "fail",
  },
  {
    id: "http-health",
    kind: "http",
    value: "/health",
    usedBy: [
      "src/main/hermes/gateway-process.ts",
      "src/main/cronjobs.ts",
      "src/main/ssh-tunnel.ts",
    ],
    upstreamPaths: ["gateway/platforms/api_server.py"],
    tier: "fail",
  },
  {
    id: "http-openapi",
    kind: "http",
    value: "/openapi.json",
    usedBy: ["src/main/hermes/chat-client/api.ts"],
    upstreamPaths: ["gateway/platforms/api_server.py"],
    tier: "warn",
  },
  {
    id: "http-capabilities",
    kind: "http",
    value: "/v1/capabilities",
    usedBy: [
      "src/main/engine-capabilities.ts",
      "src/main/hermes/chat-client/api.ts",
    ],
    upstreamPaths: ["gateway/platforms/api_server.py"],
    tier: "fail",
  },
  {
    id: "http-v1-chat",
    kind: "http",
    value: "/v1/chat/completions",
    usedBy: [
      "src/main/gateway-chat.ts",
      "src/main/hermes/chat-client/api.ts",
      "src/main/hermes/chat-client/completion.ts",
      "src/main/sps-agent.ts",
    ],
    upstreamPaths: ["gateway/platforms/api_server.py"],
    tier: "fail",
  },
  {
    id: "http-api-chat",
    kind: "http",
    value: "/api/chat/completions",
    usedBy: ["src/main/hermes/chat-client/api.ts"],
    upstreamPaths: ["gateway/platforms/api_server.py"],
    tier: "warn",
  },
  {
    id: "http-run-approval",
    kind: "http",
    value: "/v1/runs/{id}/approval",
    usedBy: ["src/main/hermes/chat-client/api.ts"],
    upstreamPaths: ["gateway/platforms/api_server.py"],
    tier: "fail",
  },
  {
    id: "http-jobs",
    kind: "http",
    value: "/api/jobs",
    usedBy: ["src/main/cronjobs.ts"],
    upstreamPaths: ["gateway/platforms/api_server.py", "cron/"],
    tier: "warn",
  },
  {
    id: "http-job-by-id",
    kind: "http",
    value: "/api/jobs/{id}",
    usedBy: ["src/main/cronjobs.ts"],
    upstreamPaths: ["gateway/platforms/api_server.py", "cron/"],
    tier: "warn",
  },
  {
    id: "config-model",
    kind: "config-key",
    value: "model.*",
    usedBy: ["src/main/config/model-config.ts", "src/main/config.ts"],
    upstreamPaths: ["hermes_cli/config.py", "cli-config.yaml.example"],
    tier: "warn",
  },
  {
    id: "config-providers",
    kind: "config-key",
    value: "providers.*",
    usedBy: ["src/main/config/model-config.ts", "src/main/config.ts"],
    upstreamPaths: ["hermes_cli/config.py", "providers/"],
    tier: "warn",
  },
  {
    id: "config-api-server",
    kind: "config-key",
    value: "api_server.*",
    usedBy: ["src/main/hermes/gateway-process.ts", "src/main/config.ts"],
    upstreamPaths: ["gateway/platforms/api_server.py", "hermes_cli/config.py"],
    tier: "warn",
  },
  {
    id: "config-memory-provider",
    kind: "config-key",
    value: "memory.provider",
    usedBy: ["src/main/memory.ts", "src/main/installer.ts"],
    upstreamPaths: ["memory/", "hermes_cli/config.py"],
    tier: "warn",
  },
  {
    id: "config-mcp-servers",
    kind: "config-key",
    value: "mcp_servers",
    usedBy: ["src/main/mcp-servers.ts"],
    upstreamPaths: ["hermes_cli/config.py", "mcp/"],
    tier: "warn",
  },
  {
    id: "json-cron-jobs",
    kind: "json-file",
    value: "cron/jobs.json",
    fields: ["id", "name", "schedule", "command", "enabled", "last_run"],
    usedBy: ["src/main/cronjobs.ts"],
    upstreamPaths: ["cron/"],
    tier: "warn",
  },
  {
    id: "json-models",
    kind: "json-file",
    value: "models.json",
    usedBy: ["src/main/models.ts", "src/main/model-discovery.ts"],
    upstreamPaths: ["hermes_cli/models.py", "providers/"],
    tier: "warn",
  },
  {
    id: "json-auth",
    kind: "json-file",
    value: "auth.json",
    usedBy: [
      "src/main/config/credential-pool.ts",
      "src/main/config/env-store.ts",
    ],
    upstreamPaths: ["hermes_cli/auth.py"],
    tier: "warn",
  },
] as const satisfies readonly EngineContractEntry[];

export function engineContractEntriesByKind(
  kind: EngineContractKind,
): EngineContractEntry[] {
  return ENGINE_CONTRACT.filter((entry) => entry.kind === kind);
}
