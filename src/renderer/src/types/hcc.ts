export interface HccWarRoomAction {
  type: string;
  project_id?: string;
  domain_id?: string;
  label?: string;
}

export interface HccWarRoomRecommendation {
  id: string;
  label: string;
  reason: string;
  action: HccWarRoomAction;
}

export interface HccWarRoomOpenLoop {
  type: string;
  label: string;
  project_id?: string;
  project_name?: string;
  domain_id?: string;
  domain_name?: string;
}

export interface HccWarRoomReview {
  scope_type: string;
  scope_id: string;
  label: string;
  review_cadence: string;
}

export interface HccWarRoomDomain {
  id: string;
  name: string;
  health_score: number;
  health_band: string;
  neglect_risk: string;
  open_loops: string[];
  baseRisk?: number;
  propagatedRisk?: number;
  dependencyCount?: number;
}

export interface HccDomain extends HccWarRoomDomain {
  slug?: string;
  description?: string;
  momentum_score?: number;
  priority_rank?: number;
  core_metrics?: string[];
  obligations?: string[];
  active_goals?: string[];
  linked_gateway_ids?: string[];
  review_cadence?: string;
  notes?: string;
  alert_thresholds?: Record<string, number>;
  linked_projects?: HccProject[];
  linked_gateways?: Array<{ id: string; name?: string; display_name?: string; displayName?: string; status?: string }>;
  memory_capsules?: HccMemoryCapsule[];
  relationship_summary?: {
    projects: number;
    gateways: number;
    memoryCapsules: number;
    openLoops: number;
  };
}

export interface HccWarRoomProject {
  id: string;
  name: string;
  description?: string;
  status: string;
  strategic_relevance?: string;
  momentum_score?: number;
  clarity_score?: number;
  risk_score?: number;
  blockers?: string[];
  linked_domain_ids?: string[];
  linked_gateway_ids?: string[];
  baseRisk?: number;
  propagatedRisk?: number;
  dependencyCount?: number;
}

export interface HccWarRoomExecutionSummary {
  queued: number;
  running: number;
  blocked: number;
  failed: number;
  completed: number;
  cancelled: number;
  [key: string]: number;
}

export interface HccWarRoomRun {
  id: string;
  status?: string;
  worker_id?: string;
  task_title?: string;
}

export interface HccProject extends HccWarRoomProject {
  purpose?: string;
  type?: string;
  dependency_health?: string;
  linked_tool_ids?: string[];
  milestones?: string[];
  outputs?: string[];
  review_cadence?: string;
  reference_ids?: string[];
  memory_capsule_ids?: string[];
  linked_domains?: Array<Pick<HccDomain, "id" | "name" | "health_score" | "neglect_risk">>;
  linked_gateways?: Array<{ id: string; name?: string; display_name?: string; displayName?: string; status?: string }>;
  linked_tools?: Array<{ id: string; name?: string; label?: string; description?: string }>;
  references?: Array<{ id: string; name?: string; title?: string; summary?: string; source_url?: string }>;
  memory_capsules?: HccMemoryCapsule[];
  relationship_summary?: {
    domains: number;
    gateways: number;
    tools: number;
    references: number;
    memoryCapsules: number;
  };
}

export interface HccMemoryCapsule {
  id: string;
  kind: string;
  summary: string;
  body: string;
  scope_type: string;
  scope_id?: string | null;
  domain_ids: string[];
  project_ids: string[];
  gateway_ids: string[];
  tool_ids: string[];
  importance: string;
  confidence: string;
  freshness: string;
  sensitivity: string;
  promotion_state: string;
  source_type: string;
  contradiction_state: string;
  linked_projects?: Array<Pick<HccProject, "id" | "name" | "status">>;
  linked_domains?: Array<Pick<HccDomain, "id" | "name" | "health_score" | "neglect_risk">>;
  linked_gateways?: Array<{ id: string; name?: string; display_name?: string; displayName?: string }>;
  linked_tools?: Array<{ id: string; name?: string; label?: string }>;
  created_at?: number | string | null;
  updated_at?: number | string | null;
}

export interface HccMemoryPacket {
  packet_type: string;
  summary: {
    count: number;
    availableMatches: number;
    elapsedMs: number;
  };
  items: Array<{
    id: string;
    kind: string;
    summary: string;
    importance: string;
    promotion_state: string;
  }>;
}

export interface HccReviewItem {
  id: string;
  scope_type: "domain" | "project";
  scope_id: string;
  label: string;
  review_cadence: string;
  urgency: "high" | "medium" | "low";
  health_score?: number;
  risk_score?: number;
  momentum_score?: number;
  open_loop_count?: number;
  blocker_count?: number;
  base_risk: number;
  propagated_risk: number;
  dependency_count: number;
  dependency_priority: number;
  prompts: string[];
}

export interface HccReviewIntervention {
  id: string;
  severity: string;
  label: string;
  reason: string;
  dependency_priority: number;
  propagated_risk: number;
  action: HccWarRoomAction;
}

export interface HccReviewCenter {
  hero: { title: string; subtitle: string };
  reviewItems: HccReviewItem[];
  interventions: HccReviewIntervention[];
  memoryPacket: HccMemoryPacket;
  summary: {
    total: number;
    highUrgency: number;
    domainReviews: number;
    projectReviews: number;
    interventions: number;
    graphEdgeCount: number;
    elevatedDependencyRisk: number;
  };
}

export interface HccProjectGenomeContract {
  purpose: string;
  strategicThesis: string;
  definitionOfDone: string;
  principles: string[];
  nonNegotiables: string[];
  successMetrics: string[];
  constraints: string[];
  riskBoundaries: string[];
  preferredPatterns: string[];
  rejectedPatterns: string[];
  referenceIds: string[];
  decisionRecords: Array<Record<string, unknown>>;
  skillGrowth: Record<string, unknown>;
  executionHeuristics: string[];
  verifiedOutcomes: Array<Record<string, unknown>>;
  failureLessons: Array<Record<string, unknown>>;
}

export interface HccProjectGenomeProposal {
  id: string;
  projectId: string;
  baseVersion: number;
  mode: string;
  status: "pending_approval" | "approved" | "rejected";
  patch: Partial<HccProjectGenomeContract>;
  evidence: Record<string, unknown>;
  rationale: string;
  diff: { changeCount: number; changedFields: string[]; changes: Array<{ field: string; before: unknown; after: unknown }> };
}

export interface HccProjectGenomeCenter {
  projectId: string;
  currentVersion: number;
  contentHash: string;
  genome: HccProjectGenomeContract;
  source: string;
  versions: Array<{ version: number; contentHash: string; source: string; actor: string; createdAt: number; genome: HccProjectGenomeContract }>;
  proposals: HccProjectGenomeProposal[];
  alignments: Array<{ id: string; executionId: string; genomeVersion: number; genomeHash: string; overallScore: number; dimensions: Record<string, number>; evidence: Record<string, unknown> }>;
  latestAlignment?: { overallScore: number; executionId: string } | null;
  summary: { versionCount: number; pendingProposals: number; alignmentCount: number };
}

export interface HccOpportunityEvidence {
  signal: string;
  value: unknown;
}

export interface HccOpportunityCandidate {
  id: string;
  category: "domain_recovery" | "project_acceleration" | "reference_leverage";
  title: string;
  summary: string;
  target: { type: "domain" | "project" | "reference"; id: string };
  sourceRefs: Array<{ type: string; id: string }>;
  evidence: HccOpportunityEvidence[];
  strategicFit: number;
  urgency: number;
  confidence: number;
  effort: number;
  risk: number;
  score: number;
  recommendedAction: string;
  whyNow: string;
  expectedUpside: string;
  opportunityCost: string;
  executionReadiness: number;
  linkedDomainIds: string[];
  linkedProjectIds: string[];
  status: "new" | "captured" | "deferred" | "proposed" | "activated" | "measured" | "dismissed";
  lastRationale?: string;
}

export interface HccOpportunityIntervention {
  id: string;
  candidateId: string;
  mode: "convert_project" | "create_tasks" | "stage_execution";
  status: "pending_approval" | "approved" | "measured";
  actor: string;
  plan: { requiresApproval: boolean; mutationPreview: string; rollbackHint: string; rationale?: string };
  projectId?: string | null;
  executionId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface HccOpportunityRadar {
  hero: { title: string; subtitle: string };
  items: HccOpportunityCandidate[];
  summary: {
    total: number;
    new: number;
    captured: number;
    proposed: number;
    dismissedIncluded: number;
    highConfidence: number;
  };
  methodology: {
    version: string;
    formula: string;
    sources: string[];
    mutationPolicy: "proposal_only";
  };
}

export type HccLearningStage = "discovered" | "studying" | "applying" | "demonstrated";

export interface HccMissionLearning {
  category: "success" | "failure" | "optimization";
  text: string;
  demonstratesOutcome: boolean;
  missionRef: { type: "conductor_job"; id: string; title: string; status?: string };
  runRef?: { type: "run"; id: string } | null;
  projectId?: string | null;
  artifactRefs: Array<{ type: string; id: string }>;
}

export interface HccLearningTopic {
  id: string;
  title: string;
  summary: string;
  targetOutcome: string;
  stage: HccLearningStage;
  projectIds: string[];
  domainIds: string[];
  sourceCount: number;
  synthesisCount: number;
  evidenceCount: number;
  missionLearningCount: number;
  missionLearnings: HccMissionLearning[];
  synthesisDebt: number;
  progressScore: number;
}

export interface HccLearningRecommendation {
  id: string;
  topicId: string;
  type: string;
  title: string;
  rationale: string;
  score: number;
  evidence: Array<{ signal: string; value: unknown }>;
}

export interface HccLearningDashboard {
  hero: { title: string; subtitle: string };
  items: HccLearningTopic[];
  recommendations: HccLearningRecommendation[];
  summary: { topics: number; synthesisDebt: number; applying: number; demonstrated: number };
  methodology: {
    version: string;
    progression: HccLearningStage[];
    mutationPolicy: "append_only_proposal_gated";
  };
}

export interface HccMission {
  id: string;
  name: string;
  description?: string;
  goal?: string;
  status: string;
  workers: string[];
  kanban_board?: string;
  created_at?: number;
  updated_at?: number;
  completed_at?: number;
}

export interface HccMissionEvidencePack {
  schemaVersion: string;
  generatedAt: number;
  mission: { id: string; name: string; description?: string; goal?: string; status: string; projectId?: string };
  sections: Record<string, { status?: string; items?: unknown[]; summary?: Record<string, number> }>;
  provenance: { sourceRefs: Array<{ type: string; id: string }>; topicIds: string[]; policy: string };
}

export type HccInspectorTabName = "evidence" | "artifacts" | "files" | "memory" | "skills" | "logs" | "approvals";

export interface HccInspectorTab {
  status: "recorded" | "not_recorded" | string;
  count: number;
  items: Array<Record<string, unknown>>;
}

export interface HccContextInspector {
  schemaVersion: "context-inspector-v1" | "context-inspector-v2";
  generatedAt: number;
  context: { entityType: string; entityId: string; title: string; status: string };
  tabs: Record<HccInspectorTabName, HccInspectorTab>;
  provenance: { sourceRefs: Array<{ type: string; id: string }>; topicIds?: string[]; policy: string; readerScope?: string; omissions?: Array<{ id: string; reason: string; sensitivity?: string }> };
}

export interface HccInlineApprovalItem {
  id: string;
  approvalDomain: "governance_proposal" | "run_request";
  status: string;
  title: string;
  actionType?: string;
  targetId?: string;
  runId?: string;
  reason?: string;
  riskLevel?: string;
  requestedAt?: number;
  resolutionMode: "approve_stages_only" | "approve_executes_guarded_action";
  allowedDecisions: Array<"approve" | "reject">;
  requiresApproval: boolean;
  appliedAt?: number | null;
}

export interface HccInlineApprovals {
  schemaVersion: "inline-approvals-v1";
  context: { missionId: string; title: string; status: string };
  summary: { total: number; pending: number; approved: number; rejected: number };
  items: HccInlineApprovalItem[];
  provenance: { sourceRefs: Array<{ type: string; id: string }>; policy: string };
}

export interface HccMissionUsageMetric {
  status: "recorded" | "not_recorded";
  input: number | null;
  output: number | null;
  total: number | null;
}

export interface HccMissionCostMetric {
  status: "recorded" | "not_recorded";
  value: number | null;
  currency: "USD";
}

export interface HccMissionCostBreakdown {
  runCount: number;
  tokens: HccMissionUsageMetric;
  cost: HccMissionCostMetric;
  verifiedOutcomeCount: number;
  costPerVerifiedOutcome: HccMissionCostMetric & { denominator: number };
}

export interface HccMissionCostAttribution {
  schemaVersion: "mission-cost-attribution-v1";
  mission: { id: string; name: string; status: string; projectId?: string | null };
  summary: {
    linkedRunCount: number;
    usageRecordedRunCount: number;
    tokens: HccMissionUsageMetric;
    cost: HccMissionCostMetric;
    outcomeQuality: { status: "recorded" | "not_recorded"; average: number | null; recordedRunCount: number };
    verifiedOutcomeCount: number;
    costPerVerifiedOutcome: HccMissionCostMetric & { denominator: number };
    evidence: { artifactCount: number; verificationStepCount: number };
  };
  breakdowns: {
    runs: Array<{
      runId: string;
      title?: string;
      status: string;
      workerId?: string;
      tokens?: HccMissionUsageMetric;
      cost?: HccMissionCostMetric;
      outcomeQuality?: { status: string; value: number | null };
      evidence?: { artifactCount: number; verificationStepCount: number };
      verifiedOutcome?: boolean;
      reason?: string;
    }>;
    workers: Array<HccMissionCostBreakdown & { workerId: string }>;
    models: Array<HccMissionCostBreakdown & { provider: string; model: string }>;
  };
  budget: {
    status: "configured" | "not_configured";
    state: "within" | "alert" | "exceeded" | "not_recorded" | "not_configured";
    limitTokens?: number | null;
    limitCost?: number | null;
    alertThreshold?: number;
    utilization?: number | null;
    requiresApproval: boolean;
    policy?: string;
  };
  provenance: { sourceRefs: Array<{ type: string; id: string }>; sources: string[]; runLinkPolicy: string; policy: string };
}

export interface HccRunSummary {
  id: string;
  title: string;
  status: string;
  outcome?: string | null;
  summary?: string;
  project_id?: string | null;
  worker_id?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
}

export interface HccRecordedMetric {
  status: "recorded" | "not_recorded";
  value: number | null;
  unit?: string;
  currency?: string;
}

export interface HccRunComparisonSnapshot {
  id: string;
  title: string;
  status: string;
  outcome?: string | null;
  projectId?: string | null;
  workerId?: string | null;
  metrics: {
    duration: HccRecordedMetric;
    tokens: { status: string; input: number | null; output: number | null; total: number | null };
    cost: HccRecordedMetric;
    retries: HccRecordedMetric;
    outcomeQuality: HccRecordedMetric;
    evidence: { status: string; artifactCount: number; verificationStepCount: number };
    governanceInterventions: HccRecordedMetric;
  };
}

export interface HccRunComparison {
  schemaVersion: "run-comparison-v1";
  runs: [HccRunComparisonSnapshot, HccRunComparisonSnapshot];
  deltas: Record<string, { status: string; value: number | null }>;
  provenance: { sourceRefs: Array<{ type: string; id: string }>; sources: string[]; policy: string };
}

export interface HccSwarmWorker {
  id: string;
  profile?: string;
  role?: string;
  status?: string;
  current_task_id?: string | null;
  last_active?: string | null;
}

export interface HccSwarmRun {
  id: string;
  task_id?: string;
  task_title?: string;
  profile?: string;
  status?: string;
  outcome?: string | null;
  summary?: string | null;
  started?: string | null;
}

export interface HccControlPlaneData {
  missions: HccMission[];
  swarm: {
    status: { status?: string; active?: boolean; active_runs?: number; total_workers?: number; total_tasks?: number };
    workers: { workers: HccSwarmWorker[] };
    runs: { runs: HccSwarmRun[] };
    activity: { activity: Array<Record<string, unknown>> };
  };
}

export interface HccWarRoomSummary {
  hero: {
    title: string;
    subtitle: string;
    activeProjectCount: number;
    domainCount: number;
    toolCount: number;
  };
  priorities: HccWarRoomProject[];
  riskyDomains: HccWarRoomDomain[];
  dueReviews: HccWarRoomReview[];
  openLoops: HccWarRoomOpenLoop[];
  memoryPackets: {
    tiny: HccMemoryPacket;
    review: HccMemoryPacket;
  };
  execution: {
    summary: HccWarRoomExecutionSummary;
    blockedRuns: HccWarRoomRun[];
    workers: Array<{ worker_id: string; runCount: number }>;
  };
  reality: {
    profile: {
      energyState: "high" | "normal" | "low" | "depleted";
      operatingMode: "normal" | "watch" | "overload" | "recovery" | "critical_only";
      maxActiveProjects: number;
      dailyCapacityMinutes?: number;
      weeklyFocusMinutes?: number;
      weeklyRecoveryMinutes?: number;
      values?: string[];
      principles?: string[];
      antiGoals?: string[];
      currentSeason?: string;
      riskTolerance?: "conservative" | "balanced" | "aggressive";
      strategicPriorityOrder?: string[];
      ambitionHorizon?: string;
      hardConstraints?: Array<string | Record<string, unknown>>;
      softPreferences?: Array<string | Record<string, unknown>>;
    };
    capacity: {
      weeklyFocusMinutes: number;
      energyAdjustedMinutes: number;
      projectDemandMinutes: number;
      scheduledMinutes: number;
      loadRatio: number;
      remainingMinutes: number;
    };
    schedule: {
      horizonDays: number;
      scheduledMinutes: number;
      blocks: Array<{
        id: string;
        title: string;
        projectId?: string | null;
        domainId?: string | null;
        energyRequirement: "high" | "normal" | "low" | "depleted";
        startAt: number;
        endAt: number;
        durationMinutes: number;
        status: string;
      }>;
    };
    antiChaos: {
      currentMode: string;
      recommendedMode: string;
      simplify: boolean;
    };
    conflicts: Array<{ id: string; severity: string; type: string; message: string }>;
    interventions: Array<{ id: string; label: string; reason: string; actionType: string; requiresApproval: boolean }>;
  };
  tradeoffs: Array<{
    id: string;
    conflict: { id: string; severity: string; type: string; message: string };
    options: Array<{ id: string; label: string; benefit: number; feasibility: number; risk: number; score: number }>;
    recommendedOption: string;
    recommendedScore: number;
    status: string;
  }>;
  recovery: {
    degraded: boolean;
    recommendedMode: string;
    currentMode: string;
    signals: { critical: number; high: number; energy: string };
    actions: Array<{ id: string; actionType: string; label: string; reason: string; requiresApproval: boolean }>;
  };
  observability: {
    schemaVersion: "hcc-observability-v1";
    generatedAt: number;
    status: "healthy" | "degraded" | "critical";
    signals: { critical: number; warning: number; conflicts: number; interventions: number };
    domains: { total: number; stable: number; atRisk: number; averageHealth: number };
    projects: { total: number; active: number; blocked: number; completed: number; throughputRate: number };
    execution: { ledgerCount: number; pendingApproval: number; active: number; failed: number; runs: Record<string, number> };
    capacity: {
      weeklyFocusMinutes: number;
      weeklyRecoveryMinutes: number;
      energyAdjustedMinutes: number;
      projectDemandMinutes: number;
      scheduledMinutes: number;
      loadRatio: number;
      remainingMinutes: number;
      currentMode: string;
      recommendedMode: string;
      energyState: string;
    };
    memory: { status: string; healthScore: number; pendingReviews: number; sensitiveWarnings: number; sensitiveBlocked: number; snapshotAgeHours: number | null };
    reviews: Record<string, number>;
    gateways: { total: number; running: number; unavailable: number };
    privacy: { policyCount: number; retentionPolicyCount: number; accessDeniedCount: number; auditEventCount: number };
  };
  recommendations: HccWarRoomRecommendation[];
  integrity: {
    health: "healthy" | "warning" | "critical";
    summary: {
      issueCount: number;
      orphanEdgeCount: number;
      invalidRelationshipCount: number;
      invalidNodeTypeCount: number;
      invalidRelationshipPairCount: number;
      semanticDuplicateCount: number;
    };
  };
  summary: {
    priorityCount: number;
    riskyDomainCount: number;
    dueReviewCount: number;
    openLoopCount: number;
    graphEdgeCount: number;
    elevatedDependencyRiskCount: number;
    integrityIssueCount: number;
    integrityHealth: "healthy" | "warning" | "critical";
    blockedRunCount: number;
    runCount: number;
  };
}

export interface HccGatewayCapabilityEvidence {
  profileExists: boolean;
  pidFileExists: boolean;
  pid: number | null;
  pidAlive: boolean;
  configExists: boolean;
  pidObservedAt: number | null;
}

export interface HccGatewayCapability {
  id: string;
  displayName: string;
  runtimeStatus: "running" | "stopped" | "unavailable" | string;
  health: "active" | "degraded" | "unavailable" | string;
  stale: boolean;
  missingManifest: boolean;
  manifestStatus: "present" | "missing" | string;
  capabilityStatus: "declared" | "undocumented" | string;
  platform: string | null;
  profiles: string[];
  capabilities: string[];
  linkedApps: string[];
  eventTypes: string[];
  controlActions: string[];
  degradedReason: string | null;
  confidence: string;
  evidence: HccGatewayCapabilityEvidence;
  counts: { capabilities: number; linkedApps: number; eventTypes: number; controlActions: number };
}

export interface HccGatewayCapabilityMap {
  schemaVersion: "gateway-capability-map-v1";
  generatedAt: number;
  gateways: HccGatewayCapability[];
  summary: {
    total: number;
    running: number;
    degraded: number;
    unavailable: number;
    missingManifests: number;
    staleDeclarations: number;
    capabilities: number;
    linkedApps: number;
  };
  provenance: {
    manifestSource: string;
    runtimeSource: string;
    healthPolicy: string;
    mutationPolicy: "inspection_only" | string;
  };
}

export type HccExecutionStatus = "pending_approval" | "approved" | "dispatching" | "running" | "succeeded" | "failed" | "denied" | "rolled_back" | "rollback_not_applicable" | "cancelled";

export interface HccExecutionAuditEvent {
  id: string;
  event_type: string;
  actor: string;
  note: string;
  payload: Record<string, unknown>;
  created_at: number;
}

export interface HccExecutionArtifact {
  id: string;
  kind: string;
  name: string;
  content: Record<string, unknown>;
  created_at: number;
}

export interface HccExecution {
  id: string;
  kind: string;
  action: string;
  sourceGateway: string | null;
  targetGateway: string;
  requestedBy: string;
  approvedBy: string | null;
  riskLevel: "low" | "medium" | "high";
  requiresApproval: boolean;
  status: HccExecutionStatus;
  transport: string;
  endpoint: string;
  remoteRunId: string | null;
  idempotencyKey: string;
  attemptCount: number;
  maxAttempts: number;
  linkedCommandId: string | null;
  linkedHandoffId: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  audit: HccExecutionAuditEvent[];
  artifacts: HccExecutionArtifact[];
}

export interface HccExecutionList {
  items: HccExecution[];
  count: number;
  pendingApproval: number;
  active: number;
  failed: number;
}

export interface HccExecutor {
  gatewayId: string;
  displayName: string;
  endpoint: string | null;
  transport: string;
  controlActions: string[];
  available: boolean;
}
