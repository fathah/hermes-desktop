import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Crown,
  DoorOpen,
  Footprints,
  LogOut,
  Move,
  RefreshCw,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import type { GpuStatus } from "../../../../shared/gpu";
import { useI18n } from "../../components/useI18n";
import oneChatIcon from "../../assets/images/one-chat.svg";
import OneChatModal from "./OneChatModal";
import Office3D from "./office3d/Office3D";
import RepInteractionPanel from "./RepInteractionPanel";
import { officeAgentsChanged, profilesToOfficeAgents } from "./office3d/agents";
import {
  getRepresentative,
  type RepActionId,
} from "./office3d/interactions/registry";
import {
  completeMission,
  dispatchMission,
  makeMissionId,
  onMissionEvent,
  type Mission,
} from "./office3d/interactions/missionBus";
import {
  planWorldActions,
  type WorldAction,
} from "./office3d/interactions/worldActions";
import type { ShowroomCar } from "./office3d/objects/CarShowroom";
import type { BuildingId, OfficeLocation } from "./office3d/core/locations";
import type { AgentPlace, OfficeAgent } from "./office3d/core/types";
import type { PlayerInteraction } from "./office3d/interactions/proximity";

function isEditableTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLElement &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
  );
}

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
function Office({ visible, profile }: OfficeProps): React.JSX.Element {
  const { t } = useI18n();
  const [agents, setAgents] = useState<OfficeAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ceoId, setCeoId] = useState<string | null>(readStoredCeo);
  const [chatOpen, setChatOpen] = useState(false);
  // Enterable buildings: clicking one in the city view focuses it (shows the
  // Enter prompt); entering switches the whole screen to that interior and
  // unmounts the rest of the city.
  const [location, setLocation] = useState<OfficeLocation>("city");
  const [focusedBuilding, setFocusedBuilding] = useState<BuildingId | null>(
    null,
  );
  const [carCard, setCarCard] = useState<ShowroomCar | null>(null);
  // Space-representative menu (bank tellers today): which rep's panel is open.
  const [activeRepId, setActiveRepId] = useState<string | null>(null);
  // Chat-commanded world action in flight: the mission the agent is walking,
  // and the rep-panel action to auto-run when its modal opens on arrival.
  const missionRef = useRef<Mission | null>(null);
  const missionRepOpenRef = useRef(false);
  const [autoAction, setAutoAction] = useState<RepActionId | null>(null);
  // GTA-style walk mode: the user's avatar walks the city; interiors load by
  // walking through doorways and interactions fire with E near their points.
  const [walkMode, setWalkMode] = useState(false);
  const [nearby, setNearby] = useState<PlayerInteraction | null>(null);
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

  const enterBuilding = useCallback((building: BuildingId) => {
    setLocation(building);
    setFocusedBuilding(null);
    setCarCard(null);
    setActiveRepId(null);
  }, []);

  const exitToCity = useCallback(() => {
    setLocation("city");
    setCarCard(null);
    setActiveRepId(null);
  }, []);

  const enterWalkMode = useCallback(() => {
    setWalkMode(true);
    // The avatar spawns on the street outside HQ, so the world starts in
    // city view regardless of which interior the orbit camera was in.
    setLocation("city");
    setFocusedBuilding(null);
    setCarCard(null);
    setActiveRepId(null);
  }, []);

  const exitWalkMode = useCallback(() => {
    setWalkMode(false);
    setNearby(null);
    setLocation("city");
    setCarCard(null);
    setActiveRepId(null);
  }, []);

  // Walk mode is a foreground control scheme — leaving the tab exits it so
  // its window-level key listeners never capture typing elsewhere.
  useEffect(() => {
    if (!visible && walkMode) exitWalkMode();
  }, [visible, walkMode, exitWalkMode]);

  // The avatar crossed a doorway: mount that building's interior (or the
  // city when back outside). Building-scoped overlays close on any move.
  const handlePlayerPlace = useCallback((place: AgentPlace) => {
    setLocation(place === "outside" ? "city" : place);
    setCarCard(null);
    setActiveRepId(null);
  }, []);

  // Escape exits walk mode, or backs out of an interior to the city view.
  // A rep panel (modal) owns Escape while it's open — its own listener closes
  // it — so this handler stays detached until the modal is gone. Otherwise a
  // single Escape would dismiss the modal *and* drop out of walk mode.
  useEffect(() => {
    if (activeRepId) return;
    if (!visible || (!walkMode && location === "city")) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (walkMode) exitWalkMode();
      else exitToCity();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, location, walkMode, activeRepId, exitWalkMode, exitToCity]);

  // Bank ATM → the ATM representative menu (wallet actions; withdraw/deposit
  // coming soon), same modal machinery as the teller.
  const handleAtmActivate = useCallback(() => {
    setActiveRepId("atm");
  }, []);

  const handleCarActivate = useCallback(
    (car: ShowroomCar) => setCarCard(car),
    [],
  );

  // Bank teller → the representative menu (account status, balances, new
  // accounts) for a chosen agent.
  const handleTellerActivate = useCallback(() => {
    setActiveRepId("bank-teller");
  }, []);

  const closeRepPanel = useCallback(() => setActiveRepId(null), []);
  const activeRep = getRepresentative(activeRepId);

  // Chat-driven world actions: the agent's reply asked for a physical errand.
  // Compose a mission, hand it to the 3D simulation, and pull the camera back
  // to the city so the user watches the walk (walk mode keeps its own camera).
  const handleWorldActions = useCallback(
    (agentId: string, actions: WorldAction[]) => {
      const plan = planWorldActions(actions);
      if (!plan || !agents.some((a) => a.id === agentId)) return;
      const mission: Mission = {
        id: makeMissionId(),
        agentId,
        dest: plan.dest,
        interaction: plan.interaction,
      };
      missionRef.current = mission;
      missionRepOpenRef.current = false;
      setChatOpen(false);
      setActiveRepId(null);
      setAutoAction(null);
      setCarCard(null);
      if (!walkMode) {
        setLocation("city");
        setFocusedBuilding(null);
      }
      dispatchMission(mission);
    },
    [agents, walkMode],
  );

  // Mission progress from the simulation. Arrival flies the camera into the
  // destination, selects the agent, and opens the rep panel with the
  // commanded action; "ended" (walked home, superseded, timed out) clears it.
  useEffect(() => {
    return onMissionEvent((evt) => {
      const pending = missionRef.current;
      if (!pending || evt.mission.id !== pending.id) return;
      if (evt.type === "arrived") {
        setSelectedId(pending.agentId);
        if (!walkMode) setLocation(pending.dest);
        if (pending.interaction) {
          missionRepOpenRef.current = true;
          setAutoAction(pending.interaction.actionId);
          setActiveRepId(pending.interaction.repId);
        }
      } else {
        missionRef.current = null;
        // The simulation gave up (interaction hold timed out) while the
        // panel was still open: close it too, or the UI would keep serving
        // an interaction whose agent has already walked home.
        if (missionRepOpenRef.current) {
          missionRepOpenRef.current = false;
          setAutoAction(null);
          setActiveRepId(null);
        }
      }
    });
  }, [walkMode]);

  // However the mission's modal goes away (close button, Escape, exiting the
  // interior, walk-mode moves), completing the mission sends the agent home.
  useEffect(() => {
    if (activeRepId !== null || !missionRepOpenRef.current) return;
    missionRepOpenRef.current = false;
    setAutoAction(null);
    if (missionRef.current) completeMission(missionRef.current.id);
  }, [activeRepId]);

  // Office desk → select its owner (opens the agent details sidebar).
  const handleDeskActivate = useCallback(
    (agentId: string) => setSelectedId(agentId),
    [],
  );

  // Walk mode: E fires the nearby interaction point — the same actions the
  // click-Interactables fire in orbit mode.
  useEffect(() => {
    if (!visible || !walkMode || !nearby) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code !== "KeyE" || isEditableTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey) return;
      if (nearby.kind === "atm") handleAtmActivate();
      else if (nearby.kind === "teller") handleTellerActivate();
      else if (nearby.kind === "car")
        handleCarActivate({ name: nearby.carName, tint: nearby.carTint });
      else handleDeskActivate(nearby.agentId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    visible,
    walkMode,
    nearby,
    handleAtmActivate,
    handleTellerActivate,
    handleCarActivate,
    handleDeskActivate,
  ]);

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

  // Default the rep panel's agent picker to the active profile (falling back to
  // the first agent) so it opens on the current profile instead of empty.
  const defaultAgentId = useMemo(
    () =>
      positionedAgents.some((a) => a.id === profile)
        ? (profile ?? null)
        : (positionedAgents[0]?.id ?? null),
    [positionedAgents, profile],
  );
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
          location={location}
          onFocusBuilding={setFocusedBuilding}
          onAtmActivate={handleAtmActivate}
          tellerLabel={t("office.repBankTeller")}
          onTellerActivate={handleTellerActivate}
          onCarActivate={handleCarActivate}
          onDeskActivate={handleDeskActivate}
          walkMode={walkMode}
          playerLabel={t("office.you")}
          onPlayerPlaceChange={handlePlayerPlace}
          onNearbyInteraction={setNearby}
          devMode={devMode}
          onDevLog={setDevLog}
        />

        {/* Walk-mode toggle: drop in as an avatar / return to the sky view. */}
        {!devMode && (
          <button
            type="button"
            onClick={walkMode ? exitWalkMode : enterWalkMode}
            title={walkMode ? t("office.walkModeExit") : t("office.walkMode")}
            style={{
              position: "absolute",
              bottom: 24,
              left: 20,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 16px",
              borderRadius: 12,
              border: walkMode
                ? "1px solid rgba(244,180,31,0.6)"
                : "1px solid rgba(125,211,252,0.5)",
              background: "rgba(20,24,33,0.94)",
              color: walkMode ? "#f4b41f" : "#7dd3fc",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              zIndex: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            }}
          >
            <Footprints size={16} />
            {walkMode ? t("office.walkModeExit") : t("office.walkMode")}
          </button>
        )}

        {/* Walk-mode HUD: the nearby Press-E prompt, or the controls hint. */}
        {walkMode && (
          <div
            style={{
              position: "absolute",
              bottom: 24,
              left: "50%",
              transform: "translateX(-50%)",
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: nearby ? "10px 16px" : "8px 14px",
              borderRadius: 12,
              background: "rgba(20,24,33,0.92)",
              border: nearby
                ? "1px solid rgba(244,180,31,0.55)"
                : "1px solid rgba(255,255,255,0.12)",
              color: nearby ? "#fff" : "rgba(255,255,255,0.65)",
              fontSize: 13,
              fontWeight: nearby ? 600 : 500,
              zIndex: 10,
              pointerEvents: "none",
            }}
          >
            {nearby ? (
              <>
                <kbd
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 22,
                    height: 22,
                    padding: "0 5px",
                    borderRadius: 6,
                    background: "rgba(244,180,31,0.18)",
                    border: "1px solid rgba(244,180,31,0.6)",
                    color: "#f4b41f",
                    fontSize: 12,
                    fontWeight: 700,
                    fontFamily: "inherit",
                  }}
                >
                  E
                </kbd>
                {nearby.label}
              </>
            ) : (
              t("office.walkHint")
            )}
          </div>
        )}

        {location === "city" && focusedBuilding && !devMode && !walkMode && (
          <button
            type="button"
            onClick={() => enterBuilding(focusedBuilding)}
            style={{
              position: "absolute",
              bottom: 24,
              left: "50%",
              transform: "translateX(-50%)",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 20px",
              borderRadius: 12,
              border: "1px solid rgba(125,211,252,0.5)",
              background: "rgba(20,24,33,0.94)",
              color: "#7dd3fc",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              zIndex: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            }}
          >
            <DoorOpen size={17} />
            {t(`office.enter_${focusedBuilding}`)}
          </button>
        )}

        {location !== "city" && !walkMode && (
          <button
            type="button"
            onClick={exitToCity}
            title={t("office.exitToCity")}
            style={{
              position: "absolute",
              top: 16,
              left: 16,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(20,24,33,0.92)",
              color: "#fff",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              zIndex: 10,
            }}
          >
            <LogOut size={15} />
            {t("office.exitToCity")}
          </button>
        )}

        {location === "showroom" && carCard && (
          <div
            style={{
              position: "absolute",
              left: 20,
              bottom: 20,
              width: 260,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: "14px 16px",
              borderRadius: 12,
              background: "rgba(20,24,33,0.94)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#fff",
              zIndex: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                {carCard.name}
              </span>
              <button
                type="button"
                onClick={() => setCarCard(null)}
                title={t("office.close")}
                style={{
                  display: "inline-flex",
                  padding: 4,
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  color: "rgba(255,255,255,0.7)",
                  cursor: "pointer",
                }}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  background: carCard.tint,
                  border: "1px solid rgba(255,255,255,0.25)",
                  flex: "0 0 auto",
                }}
              />
              <span style={{ fontSize: 12, opacity: 0.7 }}>
                {t("office.showroomCardColor")}
              </span>
            </div>
            <span style={{ fontSize: 12, opacity: 0.6, lineHeight: 1.45 }}>
              {t("office.showroomCardHint")}
            </span>
          </div>
        )}

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
          onWorldActions={handleWorldActions}
        />

        {activeRep && (
          <RepInteractionPanel
            rep={activeRep}
            agents={positionedAgents}
            initialAgentId={selectedId ?? defaultAgentId}
            visible={visible ?? true}
            autoAction={autoAction}
            onClose={closeRepPanel}
          />
        )}

        {selectedAgent && !activeRep && (
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
