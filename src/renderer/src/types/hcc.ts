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

export interface HccProject extends HccWarRoomProject {
  purpose?: string;
  type?: string;
  dependency_health?: string;
  linked_tool_ids?: string[];
  milestones?: string[];
  outputs?: string[];
  review_cadence?: string;
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
  status: "new" | "captured" | "proposed" | "dismissed";
  lastRationale?: string;
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
  reality: {
    profile: {
      energyState: "high" | "normal" | "low" | "depleted";
      operatingMode: "normal" | "watch" | "overload" | "recovery" | "critical_only";
      maxActiveProjects: number;
    };
    capacity: {
      weeklyFocusMinutes: number;
      energyAdjustedMinutes: number;
      projectDemandMinutes: number;
      loadRatio: number;
      remainingMinutes: number;
    };
    antiChaos: {
      currentMode: string;
      recommendedMode: string;
      simplify: boolean;
    };
    conflicts: Array<{ id: string; severity: string; type: string; message: string }>;
    interventions: Array<{ id: string; label: string; reason: string; actionType: string; requiresApproval: boolean }>;
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
  };
}
