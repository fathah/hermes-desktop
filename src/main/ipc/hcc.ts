import { ipcMain } from "electron";
import {
  actOnHccOpportunity,
  approveHccOpportunityIntervention,
  appendHccLearningEvent,
  commitHccDecision,
  compareHccClonedApp,
  createHccDecision,
  createHccClonedApp,
  finalizeHccCloneLearning,
  linkHccCloneProject,
  recordHccCloneTaste,
  recordHccRelationshipInteraction,
  recordHccDecisionOutcome,
  recordHccOpportunityOutcome,
  rollbackHccProjectGenome,
  stageHccLearningPromotion,
  stageHccRelationshipFollowup,
  stageHccCapture,
  stageHccOpportunityIntervention,
  stageHccProjectGenomeProposal,
  createHccLearningTopic,
  createHccRelationshipCommitment,
  createHccRelationshipContact,
  createHccTimeBlock,
  cancelHccTimeBlock,
  decideHccLearningPromotion,
  decideHccRelationshipFollowup,
  decideHccTradeoff,
  stageHccRecoveryAction,
  decideHccInlineApproval,
  materializeHccClonedApp,
  promoteHccLearningRecommendation,
  createHccGraphEdge,
  createHccRegistryEntity,
  deleteHccGraphEdge,
  deleteHccRegistryEntity,
  fetchHccCaptures,
  fetchHccClonedApps,
  fetchHccConductorJobs,
  fetchHccContextInspector,
  fetchHccPluginProposals,
  fetchHccPluginInstallations,
  fetchHccPluginAudit,
  approveHccPluginProposal,
  installHccPluginProposal,
  uninstallHccPlugin,
  fetchHccNarrative,
  fetchHccPersonalApiContracts,
  fetchHccPersonalApiRuns,
  approveHccPersonalApiContract,
  runHccPersonalApiContract,
  fetchHccDomainCockpit,
  fetchHccDomainInterventions,
  stageHccDomainIntervention,
  decideHccDomainIntervention,
  fetchHccMemoryGovernance,
  createHccMemoryGovernanceCase,
  decideHccMemoryGovernanceCase,
  fetchHccInlineApprovals,
  fetchHccMissionCostAttribution,
  fetchHccMissionEvidencePack,
  fetchHccRunComparison,
  fetchHccRuns,
  fetchHccSwarmOverview,
  fetchHccDecisions,
  fetchHccDomainDetail,
  fetchHccDomains,
  fetchHccGraph,
  fetchHccGatewayCapabilityMap,
  fetchHccIntelligence,
  fetchHccExecutors,
  fetchHccExecutions,
  createHccCapture,
  createHccExecution,
  decideHccCaptureRoute,
  decideHccExecution,
  evaluateHccDecision,
  executeHccRecommendation,
  refreshHccExecution,
  retryHccExecution,
  rollbackHccExecution,
  decideHccRetrievalQualityProposal,
  stageHccRetrievalPolicyExecution,
  applyHccRetrievalPolicyExecution,
  verifyHccRetrievalPolicyExecution,
  rollbackHccRetrievalPolicyExecution,
  fetchHccMemoryCapsules,
  fetchHccMemoryPacket,
  fetchHccOpportunities,
  fetchHccLearning,
  decideHccProjectGenomeProposal,
  fetchHccProjectDetail,
  fetchHccProjectGenome,
  fetchHccProjects,
  fetchHccRegistryResource,
  fetchHccReality,
  fetchHccRelationships,
  fetchHccReviewCenter,
  fetchHccGovernanceProposals,
  actOnHccGovernanceProposal,
  stageHccReviewIntervention,
  fetchHccLearningIntelligence,
  fetchHccLifeDomainSummary,
  fetchHccWarRoomSummary,
  repairHccGraphIntegrity,
  spawnHccConductor,
  stageHccIntervention,
  stopHccConductor,
  syncHccGraph,
  transitionHccRelationshipCommitment,
  transitionHccProject,
  updateHccGraphEdge,
  updateHccOperatingProfile,
  updateHccRegistryEntity,
  type HccRegistryResource,
} from "../hcc";

export function registerHccIpcHandlers(): void {
  ipcMain.handle("get-hcc-gateway-capability-map", () => fetchHccGatewayCapabilityMap());
  ipcMain.handle("get-hcc-intelligence", (_event, contextPackId?: string, tokenBudget?: number) => fetchHccIntelligence(contextPackId, tokenBudget));
  ipcMain.handle("execute-hcc-recommendation", (_event, label: string, action: Record<string, unknown>, actor?: string) => executeHccRecommendation(label, action, actor));
  ipcMain.handle("get-hcc-executors", () => fetchHccExecutors());
  ipcMain.handle("get-hcc-executions", (_event, status?: string, limit?: number) => fetchHccExecutions(status, limit));
  ipcMain.handle("create-hcc-execution", (_event, payload: Record<string, unknown>) => createHccExecution(payload));
  ipcMain.handle("decide-hcc-execution", (_event, executionId: string, decision: "approve" | "deny", actor?: string, note?: string) => decideHccExecution(executionId, decision, actor, note));
  ipcMain.handle("refresh-hcc-execution", (_event, executionId: string, actor?: string) => refreshHccExecution(executionId, actor));
  ipcMain.handle("retry-hcc-execution", (_event, executionId: string, actor?: string) => retryHccExecution(executionId, actor));
  ipcMain.handle("rollback-hcc-execution", (_event, executionId: string, actor?: string, note?: string) => rollbackHccExecution(executionId, actor, note));
  ipcMain.handle("decide-hcc-retrieval-quality-proposal", (_event, proposalId: string, decision: "approved" | "rejected", actor?: string, note?: string) => decideHccRetrievalQualityProposal(proposalId, decision, actor, note));
  ipcMain.handle("stage-hcc-retrieval-policy-execution", (_event, proposalId: string, actor?: string) => stageHccRetrievalPolicyExecution(proposalId, actor));
  ipcMain.handle("apply-hcc-retrieval-policy-execution", (_event, executionId: string, actor?: string, note?: string) => applyHccRetrievalPolicyExecution(executionId, actor, note));
  ipcMain.handle("verify-hcc-retrieval-policy-execution", (_event, executionId: string, actor?: string) => verifyHccRetrievalPolicyExecution(executionId, actor));
  ipcMain.handle("rollback-hcc-retrieval-policy-execution", (_event, executionId: string, actor?: string, note?: string) => rollbackHccRetrievalPolicyExecution(executionId, actor, note));
  ipcMain.handle("get-hcc-war-room-summary", () => fetchHccWarRoomSummary());
  ipcMain.handle("get-hcc-reality", () => fetchHccReality());
  ipcMain.handle("update-hcc-operating-profile", (_event, payload: unknown) => updateHccOperatingProfile(payload));
  ipcMain.handle("create-hcc-time-block", (_event, payload: Record<string, unknown>) => createHccTimeBlock(payload));
  ipcMain.handle("cancel-hcc-time-block", (_event, blockId: string) => cancelHccTimeBlock(blockId));
  ipcMain.handle("decide-hcc-tradeoff", (_event, conflictId: string, optionId: string, rationale: string) => decideHccTradeoff(conflictId, optionId, rationale));
  ipcMain.handle("stage-hcc-recovery-action", (_event, actionId: string) => stageHccRecoveryAction(actionId));
  ipcMain.handle("stage-hcc-intervention", (_event, interventionId: string, actor?: string) =>
    stageHccIntervention(interventionId, actor),
  );
  ipcMain.handle("get-hcc-relationships", () => fetchHccRelationships());
  ipcMain.handle("create-hcc-relationship-contact", (_event, payload: Record<string, unknown>) => createHccRelationshipContact(payload));
  ipcMain.handle("record-hcc-relationship-interaction", (_event, contactId: string, payload: Record<string, unknown>) => recordHccRelationshipInteraction(contactId, payload));
  ipcMain.handle("create-hcc-relationship-commitment", (_event, contactId: string, payload: Record<string, unknown>) => createHccRelationshipCommitment(contactId, payload));
  ipcMain.handle("transition-hcc-relationship-commitment", (_event, commitmentId: string, status: string, evidence: Array<Record<string, unknown>>) => transitionHccRelationshipCommitment(commitmentId, status, evidence));
  ipcMain.handle("stage-hcc-relationship-followup", (_event, contactId: string, payload: Record<string, unknown>) => stageHccRelationshipFollowup(contactId, payload));
  ipcMain.handle("decide-hcc-relationship-followup", (_event, followupId: string, decision: "approve" | "reject", note?: string) => decideHccRelationshipFollowup(followupId, decision, note));
  ipcMain.handle("get-hcc-decisions", () => fetchHccDecisions());
  ipcMain.handle("create-hcc-decision", (_event, payload: Record<string, unknown>) => createHccDecision(payload));
  ipcMain.handle("evaluate-hcc-decision", (_event, decisionId: string) => evaluateHccDecision(decisionId));
  ipcMain.handle("commit-hcc-decision", (_event, decisionId: string, optionId: string, rationale: string, overrideRationale?: string) => commitHccDecision(decisionId, optionId, rationale, overrideRationale));
  ipcMain.handle("record-hcc-decision-outcome", (_event, decisionId: string, payload: Record<string, unknown>) => recordHccDecisionOutcome(decisionId, payload));
  ipcMain.handle("get-hcc-captures", () => fetchHccCaptures());
  ipcMain.handle("create-hcc-capture", (_event, payload: Record<string, unknown>) => createHccCapture(payload));
  ipcMain.handle("stage-hcc-capture", (_event, captureId: string, targetType?: string, targetId?: string) => stageHccCapture(captureId, targetType, targetId));
  ipcMain.handle("decide-hcc-capture-route", (_event, routeId: string, decision: "approve" | "reject", note?: string) => decideHccCaptureRoute(routeId, decision, note));
  ipcMain.handle("get-hcc-projects", () => fetchHccProjects());
  ipcMain.handle("get-hcc-project-detail", (_event, projectId: string) => fetchHccProjectDetail(projectId));
  ipcMain.handle("get-hcc-project-genome", (_event, projectId: string) => fetchHccProjectGenome(projectId));
  ipcMain.handle("stage-hcc-project-genome-proposal", (_event, projectId: string, payload: Record<string, unknown>) => stageHccProjectGenomeProposal(projectId, payload));
  ipcMain.handle("decide-hcc-project-genome-proposal", (_event, projectId: string, proposalId: string, decision: "approve" | "reject", note?: string) => decideHccProjectGenomeProposal(projectId, proposalId, decision, note));
  ipcMain.handle("rollback-hcc-project-genome", (_event, projectId: string, targetVersion: number, rationale: string) => rollbackHccProjectGenome(projectId, targetVersion, rationale));
  ipcMain.handle("transition-hcc-project", (_event, projectId: string, toStatus: string, note?: string) =>
    transitionHccProject(projectId, toStatus, note),
  );
  ipcMain.handle("get-hcc-cloned-apps", () => fetchHccClonedApps());
  ipcMain.handle("create-hcc-cloned-app", (_event, payload: Record<string, unknown>) => createHccClonedApp(payload));
  ipcMain.handle("compare-hcc-cloned-app", (_event, appId: string, payload: Record<string, unknown>) => compareHccClonedApp(appId, payload));
  ipcMain.handle("materialize-hcc-cloned-app", (_event, appId: string) => materializeHccClonedApp(appId));
  ipcMain.handle("record-hcc-clone-taste", (_event, appId: string, signals: Array<Record<string, unknown>>) => recordHccCloneTaste(appId, signals));
  ipcMain.handle("link-hcc-clone-project", (_event, appId: string, payload: Record<string, unknown>) => linkHccCloneProject(appId, payload));
  ipcMain.handle("finalize-hcc-clone-learning", (_event, appId: string) => finalizeHccCloneLearning(appId));
  ipcMain.handle("get-hcc-domains", () => fetchHccDomains());
  ipcMain.handle("get-hcc-life-domain-summary", () => fetchHccLifeDomainSummary());
  ipcMain.handle("get-hcc-domain-detail", (_event, domainId: string) => fetchHccDomainDetail(domainId));
  ipcMain.handle("get-hcc-memory-capsules", () => fetchHccMemoryCapsules());
  ipcMain.handle("get-hcc-memory-packet", (_event, packetType: string) => fetchHccMemoryPacket(packetType));
  ipcMain.handle("get-hcc-review-center", () => fetchHccReviewCenter());
  ipcMain.handle("get-hcc-opportunities", (_event, includeDismissed?: boolean) =>
    fetchHccOpportunities(Boolean(includeDismissed)),
  );
  ipcMain.handle(
    "act-hcc-opportunity",
    (_event, candidateId: string, action: "capture" | "dismiss" | "defer" | "promote", rationale?: string) =>
      actOnHccOpportunity(candidateId, action, rationale),
  );
  ipcMain.handle(
    "stage-hcc-opportunity-intervention",
    (_event, candidateId: string, mode: "convert_project" | "create_tasks" | "stage_execution", rationale?: string, payload?: Record<string, unknown>) =>
      stageHccOpportunityIntervention(candidateId, mode, rationale, payload),
  );
  ipcMain.handle("approve-hcc-opportunity-intervention", (_event, interventionId: string) =>
    approveHccOpportunityIntervention(interventionId),
  );
  ipcMain.handle(
    "record-hcc-opportunity-outcome",
    (_event, interventionId: string, status: "positive" | "neutral" | "negative", metrics: Record<string, unknown>, evidence: Record<string, unknown>) =>
      recordHccOpportunityOutcome(interventionId, status, metrics, evidence),
  );
  ipcMain.handle("get-hcc-learning-intelligence", () => fetchHccLearningIntelligence());
  ipcMain.handle("stage-hcc-learning-promotion", (_event, payload: Record<string, unknown>) => stageHccLearningPromotion(payload));
  ipcMain.handle("decide-hcc-learning-promotion", (_event, promotionId: string, decision: "approve" | "reject", note?: string) => decideHccLearningPromotion(promotionId, decision, note));
  ipcMain.handle("get-hcc-learning", () => fetchHccLearning());
  ipcMain.handle("get-hcc-conductor-jobs", () => fetchHccConductorJobs());
  ipcMain.handle("spawn-hcc-conductor", (_event, goal: string, maxParallel?: number, supervised?: boolean) =>
    spawnHccConductor(goal, maxParallel, supervised),
  );
  ipcMain.handle("stop-hcc-conductor", (_event, taskId: string) => stopHccConductor(taskId));
  ipcMain.handle("get-hcc-mission-evidence-pack", (_event, jobId: string) => fetchHccMissionEvidencePack(jobId));
  ipcMain.handle("get-hcc-inline-approvals", (_event, jobId: string) => fetchHccInlineApprovals(jobId));
  ipcMain.handle("get-hcc-mission-cost-attribution", (_event, jobId: string) => fetchHccMissionCostAttribution(jobId));
  ipcMain.handle("decide-hcc-inline-approval", (_event, jobId: string, approvalDomain: string, approvalId: string, decision: "approve" | "reject", actor?: string, note?: string) =>
    decideHccInlineApproval(jobId, approvalDomain, approvalId, decision, actor, note),
  );
  ipcMain.handle("get-hcc-plugin-proposals", () => fetchHccPluginProposals());
  ipcMain.handle("get-hcc-plugin-installations", () => fetchHccPluginInstallations());
  ipcMain.handle("get-hcc-plugin-audit", () => fetchHccPluginAudit());
  ipcMain.handle("approve-hcc-plugin-proposal", (_event,id:string,note?:string) => approveHccPluginProposal(id,note));
  ipcMain.handle("install-hcc-plugin-proposal", (_event,id:string) => installHccPluginProposal(id));
  ipcMain.handle("uninstall-hcc-plugin", (_event,id:string) => uninstallHccPlugin(id));
  ipcMain.handle("get-hcc-narrative", (_event,cadence?:string) => fetchHccNarrative(cadence));
  ipcMain.handle("get-hcc-personal-api-contracts", () => fetchHccPersonalApiContracts());
  ipcMain.handle("get-hcc-personal-api-runs", () => fetchHccPersonalApiRuns());
  ipcMain.handle("approve-hcc-personal-api-contract", (_event,id:string,note?:string) => approveHccPersonalApiContract(id,note));
  ipcMain.handle("run-hcc-personal-api-contract", (_event,id:string,dryRun:boolean) => runHccPersonalApiContract(id,dryRun));
  ipcMain.handle("get-hcc-domain-cockpit", (_event, domain: "health" | "finance") => fetchHccDomainCockpit(domain));
  ipcMain.handle("get-hcc-domain-interventions", (_event, domain?: string) => fetchHccDomainInterventions(domain));
  ipcMain.handle("stage-hcc-domain-intervention", (_event, domain: string, payload: Record<string, unknown>) => stageHccDomainIntervention(domain, payload));
  ipcMain.handle("decide-hcc-domain-intervention", (_event, id: string, decision: "approve" | "reject", note?: string) => decideHccDomainIntervention(id, decision, note));
  ipcMain.handle("get-hcc-memory-governance", () => fetchHccMemoryGovernance());
  ipcMain.handle("create-hcc-memory-governance-case", (_event, payload: Record<string, unknown>) => createHccMemoryGovernanceCase(payload));
  ipcMain.handle("decide-hcc-memory-governance-case", (_event, caseId: string, decision: string, note?: string) => decideHccMemoryGovernanceCase(caseId, decision, note));
  ipcMain.handle("get-hcc-context-inspector", (_event, entityType: string, entityId: string, readerScope?: string) =>
    fetchHccContextInspector(entityType, entityId, readerScope),
  );
  ipcMain.handle("get-hcc-runs", () => fetchHccRuns());
  ipcMain.handle("get-hcc-run-comparison", (_event, leftRunId: string, rightRunId: string) =>
    fetchHccRunComparison(leftRunId, rightRunId),
  );
  ipcMain.handle("get-hcc-swarm-overview", () => fetchHccSwarmOverview());
  ipcMain.handle("create-hcc-learning-topic", (_event, payload: Record<string, unknown>) =>
    createHccLearningTopic(payload),
  );
  ipcMain.handle(
    "append-hcc-learning-event",
    (_event, topicId: string, eventType: string, payload: Record<string, unknown>) =>
      appendHccLearningEvent(topicId, eventType, payload),
  );
  ipcMain.handle("promote-hcc-learning-recommendation", (_event, recommendationId: string) =>
    promoteHccLearningRecommendation(recommendationId),
  );
  ipcMain.handle("get-hcc-governance-proposals", (_event, status?: string) => fetchHccGovernanceProposals(status));
  ipcMain.handle("act-hcc-governance-proposal", (_event, proposalId: string, action: "approve" | "apply" | "reject" | "rollback", actor?: string) => actOnHccGovernanceProposal(proposalId, action, actor));
  ipcMain.handle("stage-hcc-review-intervention", (_event, interventionId: string, actor?: string) => stageHccReviewIntervention(interventionId, actor));
  ipcMain.handle("get-hcc-registry-resource", (_event, resource: HccRegistryResource) => fetchHccRegistryResource(resource));
  ipcMain.handle("create-hcc-registry-entity", (_event, resource: HccRegistryResource, payload: unknown) =>
    createHccRegistryEntity(resource, payload),
  );
  ipcMain.handle("update-hcc-registry-entity", (_event, resource: HccRegistryResource, entityId: string, payload: unknown) =>
    updateHccRegistryEntity(resource, entityId, payload),
  );
  ipcMain.handle("delete-hcc-registry-entity", (_event, resource: HccRegistryResource, entityId: string) =>
    deleteHccRegistryEntity(resource, entityId),
  );
  ipcMain.handle("get-hcc-graph", () => fetchHccGraph());
  ipcMain.handle("create-hcc-graph-edge", (_event, payload: unknown) => createHccGraphEdge(payload));
  ipcMain.handle("update-hcc-graph-edge", (_event, edgeId: string, payload: unknown) => updateHccGraphEdge(edgeId, payload));
  ipcMain.handle("delete-hcc-graph-edge", (_event, edgeId: string) => deleteHccGraphEdge(edgeId));
  ipcMain.handle("sync-hcc-graph", () => syncHccGraph());
  ipcMain.handle("repair-hcc-graph-integrity", () => repairHccGraphIntegrity());
}
