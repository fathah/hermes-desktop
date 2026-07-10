import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crown, Move, RefreshCw, TriangleAlert, Users, X } from "lucide-react";
import type { GpuStatus } from "../../../../shared/gpu";
import { useI18n } from "../../components/useI18n";
import oneChatIcon from "../../assets/images/one-chat.svg";
import OneChatModal from "./OneChatModal";
import Office3D from "./office3d/Office3D";
import { officeAgentsChanged, profilesToOfficeAgents } from "./office3d/agents";
import type { OfficeAgent } from "./office3d/core/types";

interface OfficeProps {
  profile?: string;
  visible?: boolean;
}

// The CEO assignment is desktop-local UI state (one agent at a time), persisted
// across reloads like the app's other renderer preferences (theme, locale).
const CEO_STORAGE_KEY = "hermes:office:ceo";

function readStoredCeo(): string | null {
  try {
    return localStorage.getItem(CEO_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * The Office tab. Renders a native, in-renderer 3D office (no external dev
 * server / webview) where each Hermes profile appears as an interactive agent.
 */
function Office({ visible }: OfficeProps): React.JSX.Element {
  const { t } = useI18n();
  const [agents, setAgents] = useState<OfficeAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ceoId, setCeoId] = useState<string | null>(readStoredCeo);
  const [chatOpen, setChatOpen] = useState(false);
  // Developer building-mover: click a building, then click ground to reposition
  // it; positions are logged to the console so the cityPlan constants can be
  // updated to match.
  const [devMode, setDevMode] = useState(false);
  const [devLog, setDevLog] = useState<string | null>(null);
  // Software-rendering warning: the 3D office is the one surface that makes a
  // SwiftShader fallback painfully visible (1 fps, CPU pegged), so this is
  // where the user learns hardware acceleration is off and can recover.
  const [gpuStatus, setGpuStatus] = useState<GpuStatus | null>(null);
  const [gpuNoticeDismissed, setGpuNoticeDismissed] = useState(false);
  const [reenabling, setReenabling] = useState(false);

  const setCeo = useCallback((id: string | null) => {
    setCeoId(id);
    try {
      if (id) localStorage.setItem(CEO_STORAGE_KEY, id);
      else localStorage.removeItem(CEO_STORAGE_KEY);
    } catch {
      // localStorage may be unavailable in sandboxed renderers
    }
  }, []);
  // Avoid refetching every time the tab regains visibility within a session;
  // only the first reveal and explicit refreshes hit IPC.
  const loadedOnce = useRef(false);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const profiles = await window.hermesAPI.listProfiles();
      setAgents(profilesToOfficeAgents(profiles));
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
      loadedOnce.current = true;
    }
  }, []);

  useEffect(() => {
    if (visible && !loadedOnce.current) {
      void loadAgents();
    }
  }, [visible, loadAgents]);

  // GPU state is fixed for the lifetime of the process (changing it requires a
  // relaunch), so one fetch on first reveal is enough.
  useEffect(() => {
    if (!visible || gpuStatus !== null) return;
    window.hermesAPI
      .getGpuStatus()
      .then(setGpuStatus)
      .catch(() => {
        // Older main processes without the handler: stay silent.
      });
  }, [visible, gpuStatus]);

  const handleReenableGpu = useCallback(async () => {
    setReenabling(true);
    try {
      // On success the app relaunches out from under us; reaching the catch or
      // a `false` result means the env var blocks it (banner already says so).
      await window.hermesAPI.reenableGpu();
    } catch {
      setReenabling(false);
    }
  }, []);

  // Background poll: re-read profiles while the tab is visible so a gateway
  // starting/stopping flips an agent's status (idle <-> working). The 3D
  // controller reacts to that change by walking the agent to its desk or to
  // the rest room. We update state only when something actually changed and
  // never toggle `loading`, so this stays flicker-free.
  const refreshAgentStatuses = useCallback(async () => {
    try {
      const profiles = await window.hermesAPI.listProfiles();
      const next = profilesToOfficeAgents(profiles);
      setAgents((prev) => {
        return officeAgentsChanged(prev, next) ? next : prev;
      });
    } catch {
      // Transient IPC failures are ignored; the next tick retries.
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    const interval = window.setInterval(() => {
      void refreshAgentStatuses();
    }, 4000);
    return () => window.clearInterval(interval);
  }, [visible, refreshAgentStatuses]);

  // The initial fetch is driven solely by the visible-guard effect above
  // (gated on `!loadedOnce.current`). A second unconditional mount effect used
  // to live here too, but when the tab was visible on first render both fired
  // in the same commit and raced two concurrent `listProfiles` calls.

  // Reset selection / CEO if the underlying profile disappears on refresh.
  useEffect(() => {
    if (selectedId && !agents.some((a) => a.id === selectedId)) {
      setSelectedId(null);
    }
  }, [agents, selectedId]);
  useEffect(() => {
    // Only prune a stale CEO once profiles have loaded — otherwise the initial
    // empty `agents` array would wipe the just-restored CEO on every launch.
    if (loading) return;
    if (ceoId && !agents.some((a) => a.id === ceoId)) setCeo(null);
  }, [loading, agents, ceoId, setCeo]);

  // Tag each agent with its org position; the CEO drives the executive desk.
  const positionedAgents = useMemo<OfficeAgent[]>(
    () =>
      agents.map((a) => ({
        ...a,
        position: a.id === ceoId ? "ceo" : "employee",
      })),
    [agents, ceoId],
  );

  const selectedAgent =
    positionedAgents.find((a) => a.id === selectedId) ?? null;
  const selectedIsCeo = selectedAgent?.position === "ceo";
  const selectedStatusColor =
    selectedAgent?.status === "working"
      ? "#22c55e"
      : selectedAgent?.status === "error"
        ? "#ef4444"
        : "#f59e0b";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        position: "relative",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            {t("office.title")}
          </span>
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            {t("office.subtitle")}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              opacity: 0.75,
            }}
          >
            <Users size={15} />
            {t("office.agentCount", { count: agents.length })}
          </span>
          {import.meta.env.DEV && (
            <button
              type="button"
              onClick={() =>
                setDevMode((v) => {
                  const next = !v;
                  console.log(
                    `[office] Move-buildings mode ${next ? "ON" : "OFF"} — click a building, then click the ground.`,
                  );
                  return next;
                })
              }
              title="Developer: click a building then click the ground to move it (logs coordinates to the console)"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 8,
                border: devMode
                  ? "1px solid rgba(245,158,11,0.6)"
                  : "1px solid var(--border, rgba(0,0,0,0.12))",
                background: devMode ? "rgba(245,158,11,0.16)" : "transparent",
                color: devMode ? "#fbbf24" : "var(--text-secondary)",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <Move size={14} />
              {devMode ? "Moving buildings" : "Move buildings"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadAgents()}
            disabled={loading}
            title={t("office.refresh")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--border, rgba(0,0,0,0.12))",
              background: "transparent",
              // Native <button> doesn't inherit `color`; without this it falls
              // back to the UA default (black) and is invisible on the dark
              // header. Use the theme's text colour so it's readable in every
              // theme.
              color: "var(--text-secondary)",
              cursor: loading ? "default" : "pointer",
              fontSize: 13,
            }}
          >
            <RefreshCw
              size={14}
              style={{
                animation: loading ? "spin 1s linear infinite" : undefined,
              }}
            />
            {t("office.refresh")}
          </button>
        </div>
      </header>

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <Office3D
          agents={positionedAgents}
          selectedId={selectedId}
          onSelectAgent={setSelectedId}
          devMode={devMode}
          onDevLog={setDevLog}
        />

        {gpuStatus?.disabled && !gpuNoticeDismissed && (
          <div
            style={{
              position: "absolute",
              top: 16,
              left: "50%",
              transform: "translateX(-50%)",
              maxWidth: 560,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 10,
              background: "rgba(20,24,33,0.92)",
              border: "1px solid rgba(245,158,11,0.5)",
              color: "#fbbf24",
              fontSize: 13,
              lineHeight: 1.4,
              zIndex: 10,
            }}
          >
            <TriangleAlert size={18} style={{ flex: "0 0 auto" }} />
            <span>
              {gpuStatus.reason === "env"
                ? t("office.softwareRenderingEnvNotice")
                : gpuStatus.reason === "preference"
                  ? t("office.softwareRenderingPrefNotice")
                  : t("office.softwareRenderingNotice")}
            </span>
            {gpuStatus.canReenable && (
              <button
                type="button"
                onClick={() => void handleReenableGpu()}
                disabled={reenabling}
                style={{
                  flex: "0 0 auto",
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(245,158,11,0.6)",
                  background: "rgba(245,158,11,0.16)",
                  color: "#fbbf24",
                  cursor: reenabling ? "default" : "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {t("office.reenableGpu")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setGpuNoticeDismissed(true)}
              title={t("office.dismissNotice")}
              style={{
                flex: "0 0 auto",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 4,
                borderRadius: 6,
                border: "none",
                background: "transparent",
                color: "rgba(251,191,36,0.8)",
                cursor: "pointer",
              }}
            >
              <X size={15} />
            </button>
          </div>
        )}

        {import.meta.env.DEV && devMode && (
          <div
            style={{
              position: "absolute",
              left: 20,
              bottom: 20,
              maxWidth: 520,
              padding: "10px 14px",
              borderRadius: 10,
              background: "rgba(20,24,33,0.92)",
              color: "#fbbf24",
              border: "1px solid rgba(245,158,11,0.5)",
              fontSize: 12,
              fontFamily: "monospace",
              lineHeight: 1.5,
              zIndex: 10,
              userSelect: "text",
            }}
          >
            {devLog ??
              "Click a building to pick it up, then click empty ground to move it. Coordinates also log to DevTools console."}
          </div>
        )}

        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="absolute bottom-5 right-5 w-30 h-11 rounded-lg border-none bg-black cursor-pointer flex items-center justify-center px-3 gap-2 z-10"
        >
          <img
            src={oneChatIcon}
            alt="Chat"
            className="h-6 brightness-0 invert"
          />
        </button>

        <OneChatModal
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          agents={positionedAgents}
        />

        {selectedAgent && (
          <aside
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: 300,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              padding: "18px 18px 22px",
              background: "var(--card, rgba(20,24,33,0.96))",
              color: "#fff",
              borderLeft: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "-12px 0 32px rgba(0,0,0,0.28)",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 4,
                    background: selectedAgent.color,
                    flex: "0 0 auto",
                  }}
                />
                <span style={{ fontWeight: 700, fontSize: 16 }}>
                  {selectedAgent.name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                title={t("office.close")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 4,
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  color: "rgba(255,255,255,0.7)",
                  cursor: "pointer",
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                alignSelf: "flex-start",
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                background: selectedIsCeo
                  ? "rgba(245,158,11,0.18)"
                  : "rgba(255,255,255,0.08)",
                color: selectedIsCeo ? "#fbbf24" : "rgba(255,255,255,0.85)",
              }}
            >
              {selectedIsCeo && <Crown size={13} />}
              {selectedIsCeo ? t("office.ceo") : t("office.employee")}
            </div>

            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: "10px 14px",
                margin: 0,
                fontSize: 13,
              }}
            >
              <dt style={{ opacity: 0.55 }}>{t("office.statusLabel")}</dt>
              <dd
                style={{
                  margin: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: selectedStatusColor,
                  }}
                />
                {t(`office.status_${selectedAgent.status}`)}
              </dd>

              <dt style={{ opacity: 0.55 }}>{t("office.modelLabel")}</dt>
              <dd style={{ margin: 0, wordBreak: "break-word" }}>
                {selectedAgent.model || "—"}
              </dd>

              <dt style={{ opacity: 0.55 }}>{t("office.providerLabel")}</dt>
              <dd style={{ margin: 0, wordBreak: "break-word" }}>
                {selectedAgent.provider || "—"}
              </dd>

              <dt style={{ opacity: 0.55 }}>{t("office.gatewayLabel")}</dt>
              <dd style={{ margin: 0 }}>
                {selectedAgent.gatewayRunning
                  ? t("office.gatewayRunning")
                  : t("office.gatewayStopped")}
              </dd>
            </dl>

            <button
              type="button"
              onClick={() => setCeo(selectedIsCeo ? null : selectedAgent.id)}
              style={{
                marginTop: 8,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "10px 14px",
                borderRadius: 10,
                border: selectedIsCeo
                  ? "1px solid rgba(255,255,255,0.18)"
                  : "1px solid rgba(245,158,11,0.5)",
                background: selectedIsCeo
                  ? "transparent"
                  : "rgba(245,158,11,0.16)",
                color: selectedIsCeo ? "rgba(255,255,255,0.85)" : "#fbbf24",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <Crown size={15} />
              {selectedIsCeo ? t("office.removeCeo") : t("office.makeCeo")}
            </button>
          </aside>
        )}

        {!loading && agents.length === 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              opacity: 0.6,
              fontSize: 14,
            }}
          >
            {t("office.noAgents")}
          </div>
        )}
      </div>
    </div>
  );
}

export default Office;
