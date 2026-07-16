import { getConnectionConfig } from "./config";

function getApiBaseUrl(): string {
  const envUrl = process.env.HCC_API_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  const conn = getConnectionConfig();
  if (conn.mode === "remote" && conn.remoteUrl) {
    return conn.remoteUrl.replace(/\/+$/, "");
  }
  return "http://127.0.0.1:9201";
}

function getAuthHeaders(): Record<string, string> {
  const conn = getConnectionConfig();
  if (conn.mode === "remote" && conn.apiKey) {
    return { Authorization: `Bearer ${conn.apiKey}` };
  }
  return {};
}

async function fetchJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...getAuthHeaders(),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`HCC request failed (${response.status}): ${detail}`);
  }
  return response.json();
}

export async function fetchHccWarRoomSummary(): Promise<unknown> {
  return fetchJson("/api/hcc/war-room/summary");
}

export async function fetchHccReality(): Promise<unknown> {
  return fetchJson("/api/hcc/reality");
}

export async function updateHccOperatingProfile(payload: unknown): Promise<unknown> {
  return fetchJson("/api/hcc/reality/profile", { method: "PUT", body: JSON.stringify(payload) });
}

export async function stageHccIntervention(interventionId: string, actor = "operator"): Promise<unknown> {
  return fetchJson(`/api/hcc/reality/interventions/${encodeURIComponent(interventionId)}/stage`, {
    method: "POST",
    body: JSON.stringify({ actor }),
  });
}

export async function fetchHccProjects(): Promise<unknown> {
  return fetchJson("/api/hcc/projects");
}

export async function fetchHccProjectDetail(projectId: string): Promise<unknown> {
  return fetchJson(`/api/hcc/projects/${encodeURIComponent(projectId)}`);
}

export async function transitionHccProject(
  projectId: string,
  toStatus: string,
  note?: string,
): Promise<unknown> {
  return fetchJson(`/api/hcc/projects/${encodeURIComponent(projectId)}/transition`, {
    method: "POST",
    body: JSON.stringify({ toStatus, actor: "hermes-desktop", note: note || null }),
  });
}

export async function fetchHccClonedApps(): Promise<unknown> {
  return fetchJson("/api/cloned-apps");
}

export async function createHccClonedApp(payload: Record<string, unknown>): Promise<unknown> {
  return fetchJson("/api/cloned-apps", { method: "POST", body: JSON.stringify(payload) });
}

export async function materializeHccClonedApp(appId: string): Promise<unknown> {
  return fetchJson(`/api/cloned-apps/${encodeURIComponent(appId)}/materialize`, { method: "POST" });
}

export async function compareHccClonedApp(appId: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  return fetchJson(`/api/cloned-apps/${encodeURIComponent(appId)}/compare`, {
    method: "POST",
    body: JSON.stringify({ note: "Compared from native Clone & Remix Studio", ...payload }),
  });
}

export async function fetchHccDomains(): Promise<unknown> {
  return fetchJson("/api/hcc/domains");
}

export async function fetchHccLifeDomainSummary(): Promise<unknown> {
  return fetchJson("/api/hcc/life/domains/summary");
}

export async function fetchHccDomainDetail(domainId: string): Promise<unknown> {
  return fetchJson(`/api/hcc/domains/${domainId}`);
}

export async function fetchHccMemoryCapsules(): Promise<unknown> {
  return fetchJson("/api/hcc/memory/capsules");
}

export async function fetchHccMemoryPacket(packetType: string): Promise<unknown> {
  return fetchJson(`/api/hcc/memory/packets?packet_type=${encodeURIComponent(packetType)}`);
}

export async function fetchHccReviewCenter(): Promise<unknown> {
  return fetchJson("/api/hcc/reviews/center");
}

export async function fetchHccOpportunities(includeDismissed = false): Promise<unknown> {
  return fetchJson(`/api/hcc/opportunities?includeDismissed=${includeDismissed}`);
}

export async function actOnHccOpportunity(
  candidateId: string,
  action: "capture" | "dismiss" | "promote",
  rationale = "",
): Promise<unknown> {
  return fetchJson(`/api/hcc/opportunities/${encodeURIComponent(candidateId)}/actions`, {
    method: "POST",
    body: JSON.stringify({ action, actor: "hermes-desktop", rationale }),
  });
}

export async function fetchHccLearning(): Promise<unknown> {
  return fetchJson("/api/hcc/learning");
}

export async function createHccLearningTopic(payload: Record<string, unknown>): Promise<unknown> {
  return fetchJson("/api/hcc/learning/topics", {
    method: "POST",
    body: JSON.stringify({ ...payload, actor: "hermes-desktop" }),
  });
}

export async function appendHccLearningEvent(
  topicId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return fetchJson(`/api/hcc/learning/topics/${encodeURIComponent(topicId)}/events`, {
    method: "POST",
    body: JSON.stringify({ eventType, payload, actor: "hermes-desktop" }),
  });
}

export async function promoteHccLearningRecommendation(recommendationId: string): Promise<unknown> {
  return fetchJson(`/api/hcc/learning/recommendations/${encodeURIComponent(recommendationId)}/promote`, {
    method: "POST",
    body: JSON.stringify({ actor: "hermes-desktop", rationale: "Promoted from native Learning Engine" }),
  });
}

export async function stageHccReviewIntervention(interventionId: string, actor = "operator"): Promise<unknown> {
  return fetchJson(`/api/hcc/reviews/interventions/${encodeURIComponent(interventionId)}/stage`, {
    method: "POST",
    body: JSON.stringify({ actor }),
  });
}

export async function fetchHccGovernanceProposals(status = "proposed"): Promise<unknown> {
  return fetchJson(`/api/os/retrieval-governance-proposals?status=${encodeURIComponent(status)}`);
}

export async function actOnHccGovernanceProposal(proposalId: string, action: "approve" | "apply" | "reject" | "rollback", actor = "operator"): Promise<unknown> {
  return fetchJson(`/api/os/retrieval-governance-proposals/${encodeURIComponent(proposalId)}/${action}`, {
    method: "POST",
    body: JSON.stringify({ actor }),
  });
}

export type HccRegistryResource = "domains" | "tools" | "references";

export async function fetchHccRegistryResource(resource: HccRegistryResource): Promise<unknown> {
  return fetchJson(`/api/hcc/${resource}`);
}

export async function createHccRegistryEntity(resource: HccRegistryResource, payload: unknown): Promise<unknown> {
  return fetchJson(`/api/hcc/${resource}`, { method: "POST", body: JSON.stringify(payload) });
}

export async function updateHccRegistryEntity(resource: HccRegistryResource, entityId: string, payload: unknown): Promise<unknown> {
  return fetchJson(`/api/hcc/${resource}/${encodeURIComponent(entityId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteHccRegistryEntity(resource: HccRegistryResource, entityId: string): Promise<unknown> {
  return fetchJson(`/api/hcc/${resource}/${encodeURIComponent(entityId)}`, { method: "DELETE" });
}

export async function fetchHccGraph(): Promise<unknown> {
  return fetchJson("/api/hcc/graph");
}

export async function createHccGraphEdge(payload: unknown): Promise<unknown> {
  return fetchJson("/api/hcc/graph/edges", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateHccGraphEdge(edgeId: string, payload: unknown): Promise<unknown> {
  return fetchJson(`/api/hcc/graph/edges/${encodeURIComponent(edgeId)}`, { method: "PUT", body: JSON.stringify(payload) });
}

export async function deleteHccGraphEdge(edgeId: string): Promise<unknown> {
  return fetchJson(`/api/hcc/graph/edges/${encodeURIComponent(edgeId)}`, { method: "DELETE" });
}

export async function syncHccGraph(): Promise<unknown> {
  return fetchJson("/api/hcc/graph/sync", { method: "POST" });
}

export async function repairHccGraphIntegrity(): Promise<unknown> {
  return fetchJson("/api/hcc/graph/integrity/repair", { method: "POST" });
}

export async function fetchHccConductorJobs(): Promise<unknown> {
  return fetchJson("/api/conductor/jobs");
}

export async function spawnHccConductor(goal: string, maxParallel = 3, supervised = true): Promise<unknown> {
  return fetchJson("/api/conductor-spawn", {
    method: "POST",
    body: JSON.stringify({ goal, maxParallel, supervised }),
  });
}

export async function stopHccConductor(taskId: string): Promise<unknown> {
  return fetchJson("/api/conductor-stop", {
    method: "POST",
    body: JSON.stringify({ taskId }),
  });
}

export async function fetchHccMissionEvidencePack(jobId: string): Promise<unknown> {
  return fetchJson(`/api/conductor/jobs/${encodeURIComponent(jobId)}/evidence-pack`);
}

export async function fetchHccInlineApprovals(jobId: string): Promise<unknown> {
  return fetchJson(`/api/conductor/jobs/${encodeURIComponent(jobId)}/inline-approvals`);
}

export async function decideHccInlineApproval(
  jobId: string,
  approvalDomain: string,
  approvalId: string,
  decision: "approve" | "reject",
  actor = "desktop-operator",
  note = "",
): Promise<unknown> {
  return fetchJson(
    `/api/conductor/jobs/${encodeURIComponent(jobId)}/inline-approvals/${encodeURIComponent(approvalDomain)}/${encodeURIComponent(approvalId)}/decision`,
    { method: "POST", body: JSON.stringify({ decision, actor, note }) },
  );
}

export async function fetchHccContextInspector(entityType: string, entityId: string): Promise<unknown> {
  const query = new URLSearchParams({ entityType, entityId });
  return fetchJson(`/api/hcc/context/inspect?${query.toString()}`);
}

export async function fetchHccRuns(): Promise<unknown> {
  return fetchJson("/api/runs");
}

export async function fetchHccRunComparison(leftRunId: string, rightRunId: string): Promise<unknown> {
  const query = new URLSearchParams({ leftRunId, rightRunId });
  return fetchJson(`/api/runs/compare?${query.toString()}`);
}

export async function fetchHccSwarmOverview(): Promise<unknown> {
  const safeFetch = async (path: string, fallback: unknown): Promise<unknown> => {
    try {
      return await fetchJson(path);
    } catch {
      return fallback;
    }
  };
  const [status, workers, runs, activity] = await Promise.all([
    safeFetch("/api/swarm/status", { status: "offline", active: false, active_runs: 0, total_workers: 0 }),
    safeFetch("/api/swarm/workers", { workers: [] }),
    safeFetch("/api/swarm/runs", { runs: [] }),
    safeFetch("/api/swarm/activity?limit=30", { activity: [] }),
  ]);
  return { status, workers, runs, activity };
}
