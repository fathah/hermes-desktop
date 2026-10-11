import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PetSprite } from "./PetSprite";
import { derivePetState, type PetActivity } from "./petState";
import {
  openPetGateway,
  petRequest,
  refreshPetInfo,
  type PetInfoPayload,
} from "./petGateway";
import type { DashboardGatewayClient } from "../../screens/Chat/dashboardGatewayClient";
import { useConnectionTargetRevision } from "../../hooks/useConnectionTargetRevision";

interface Props {
  connectionId: string;
  profile: string;
  runId?: string;
  busy: boolean;
  onOpenSettings?: () => void;
}

interface PetActivityDetail {
  connectionId: string;
  profile: string;
  runId: string;
  type: string;
  payload?: unknown;
  failed?: boolean;
}

const POSITION_KEY = "hermes.one.pet.position.v1";

/** A device-local position; selection, scale, and sprite bytes remain backend-owned. */
export default function FloatingPet({
  connectionId,
  profile,
  runId,
  busy,
  onOpenSettings,
}: Props): React.JSX.Element | null {
  const connectionRevision = useConnectionTargetRevision();
  const [info, setInfo] = useState<PetInfoPayload>({ enabled: false });
  const infoRef = useRef<PetInfoPayload>({ enabled: false });
  const [activity, setActivity] = useState<PetActivity>({});
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    () => {
      try {
        const stored = JSON.parse(
          localStorage.getItem(POSITION_KEY) || "null",
        ) as { x?: unknown; y?: unknown } | null;
        return stored &&
          typeof stored.x === "number" &&
          typeof stored.y === "number" &&
          Number.isFinite(stored.x) &&
          Number.isFinite(stored.y)
          ? { x: stored.x, y: stored.y }
          : null;
      } catch {
        return null;
      }
    },
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
  } | null>(null);
  const prevBusy = useRef(busy);
  const flashTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Several runs can share one profile. The visible run alone owns its pose.
    window.clearTimeout(flashTimer.current);
    flashTimer.current = undefined;
    setActivity({});
    prevBusy.current = busy;
    return () => window.clearTimeout(flashTimer.current);
    // Reset only when the visible run changes; a busy transition must not clear tool/clarify activity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useEffect(() => {
    if (busy) {
      setActivity((old) => ({
        ...old,
        justCompleted: false,
        error: false,
        awaitingInput: false,
      }));
      prevBusy.current = true;
      return;
    }
    if (!prevBusy.current) return;
    prevBusy.current = false;
    setActivity((old) => ({
      ...old,
      justCompleted: !old.awaitingInput && !old.error,
      toolRunning: false,
      reasoning: false,
    }));
    const timer = window.setTimeout(
      () => setActivity((old) => ({ ...old, justCompleted: false })),
      2200,
    );
    return () => window.clearTimeout(timer);
  }, [busy, runId]);

  useEffect(() => {
    let disposed = false;
    let socket: DashboardGatewayClient | null = null;
    let pending = false;
    let refreshRequested = false;
    let connecting = false;
    let refreshGeneration = 0;
    infoRef.current = { enabled: false };
    setInfo(infoRef.current);
    const update = async (): Promise<void> => {
      if (disposed || !socket?.connected) return;
      if (pending) {
        refreshRequested = true;
        return;
      }
      pending = true;
      const generation = ++refreshGeneration;
      try {
        const meta = await petRequest<{
          enabled: boolean;
          slug?: string;
          scale?: number;
          spritesheetRevision?: string;
        }>(socket, profile, "pet.info.meta");
        if (disposed || generation !== refreshGeneration) return;
        if (!meta.enabled) {
          infoRef.current = { enabled: false };
          setInfo(infoRef.current);
        } else if (
          infoRef.current.enabled &&
          infoRef.current.slug === meta.slug &&
          infoRef.current.spritesheetRevision === meta.spritesheetRevision &&
          infoRef.current.spritesheetBase64
        ) {
          if (infoRef.current.scale !== meta.scale) {
            infoRef.current = { ...infoRef.current, scale: meta.scale };
            setInfo(infoRef.current);
          }
        } else {
          const next = await refreshPetInfo(socket, profile, infoRef.current);
          if (!disposed && generation === refreshGeneration) {
            infoRef.current = next;
            setInfo(next);
          }
        }
      } catch {
        // A disconnected/old gateway cannot be mistaken for another profile's pet.
        if (!disposed) {
          infoRef.current = { enabled: false };
          setInfo(infoRef.current);
        }
      } finally {
        pending = false;
        if (refreshRequested && !disposed) {
          refreshRequested = false;
          void update();
        }
      }
    };
    const reconnect = async (): Promise<void> => {
      if (disposed || connecting) return;
      if (socket?.connected) {
        void update();
        return;
      }
      connecting = true;
      socket?.close();
      socket = null;
      try {
        const connected = await openPetGateway(
          profile,
          connectionId,
          (event) => {
            if (event.type === "pet.changed") void update();
          },
        );
        if (disposed) {
          connected.close();
          return;
        }
        socket = connected;
        void update();
      } catch {
        // The selected gateway is unavailable; don't display stale pet data.
        if (!disposed) {
          infoRef.current = { enabled: false };
          setInfo(infoRef.current);
        }
      } finally {
        connecting = false;
      }
    };
    const localChange = (event: Event): void => {
      const detail = (
        event as CustomEvent<{ profile: string; connectionId: string }>
      ).detail;
      if (detail?.profile === profile && detail.connectionId === connectionId)
        void reconnect();
    };
    window.addEventListener("hermes-pet-changed", localChange);
    void reconnect();
    const poll = window.setInterval(() => void reconnect(), 12000);
    const focus = (): void => {
      void reconnect();
    };
    window.addEventListener("focus", focus);
    return () => {
      disposed = true;
      refreshGeneration++;
      window.clearInterval(poll);
      window.removeEventListener("focus", focus);
      window.removeEventListener("hermes-pet-changed", localChange);
      socket?.close();
    };
  }, [connectionId, profile, connectionRevision]);

  useEffect(() => {
    const onActivity = (event: Event): void => {
      const detail = (event as CustomEvent<PetActivityDetail>).detail;
      if (
        !detail ||
        detail.connectionId !== connectionId ||
        detail.profile !== profile ||
        detail.runId !== runId
      )
        return;
      const payload =
        detail.payload && typeof detail.payload === "object"
          ? (detail.payload as { error?: unknown })
          : {};
      if (detail.type === "tool.start" || detail.type === "tool.generating")
        setActivity((old) => ({
          ...old,
          toolRunning: true,
          reasoning: false,
          awaitingInput: false,
        }));
      if (detail.type === "tool.complete") {
        window.clearTimeout(flashTimer.current);
        setActivity((old) => ({
          ...old,
          toolRunning: false,
          awaitingInput: false,
          error: Boolean(payload.error),
        }));
        if (payload.error)
          flashTimer.current = window.setTimeout(
            () => setActivity((old) => ({ ...old, error: false })),
            1600,
          );
      }
      if (detail.type === "thinking.delta" || detail.type === "reasoning.delta")
        setActivity((old) => ({ ...old, reasoning: true, toolRunning: false }));
      if (
        detail.type === "approval.request" ||
        detail.type === "clarify.request"
      )
        setActivity((old) => ({
          ...old,
          awaitingInput: true,
          justCompleted: false,
        }));
      if (
        detail.type === "clarify.expire" ||
        detail.type === "message.complete" ||
        detail.type === "turn.failed"
      ) {
        const terminal =
          detail.type === "message.complete" || detail.type === "turn.failed";
        const failed = detail.type === "turn.failed" || Boolean(detail.failed);
        if (terminal) window.clearTimeout(flashTimer.current);
        setActivity((old) => ({
          ...old,
          awaitingInput: false,
          toolRunning: false,
          reasoning: false,
          ...(terminal ? { error: failed, justCompleted: !failed } : {}),
        }));
        if (failed)
          flashTimer.current = window.setTimeout(
            () =>
              setActivity((old) => ({
                ...old,
                error: false,
                justCompleted: false,
              })),
            2200,
          );
      }
    };
    window.addEventListener("hermes-pet-activity", onActivity);
    return () => window.removeEventListener("hermes-pet-activity", onActivity);
  }, [connectionId, profile, runId]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const container = stage?.parentElement;
    if (!stage || !container) return;
    const clamp = (): void => {
      setPosition((previous) => {
        if (!previous) return previous;
        const next = {
          x: Math.max(
            0,
            Math.min(previous.x, container.clientWidth - stage.offsetWidth),
          ),
          y: Math.max(
            0,
            Math.min(previous.y, container.clientHeight - stage.offsetHeight),
          ),
        };
        if (next.x === previous.x && next.y === previous.y) return previous;
        localStorage.setItem(POSITION_KEY, JSON.stringify(next));
        return next;
      });
    };
    clamp();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(clamp);
    observer?.observe(container);
    window.addEventListener("resize", clamp);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", clamp);
    };
  }, [info.enabled, info.scale, info.spritesheetBase64]);

  if (!info.enabled || !info.spritesheetBase64) return null;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const stage = stageRef.current;
    const container = stage?.parentElement;
    if (!stage || !container) return;
    const bounds = container.getBoundingClientRect();
    const rect = stage.getBoundingClientRect();
    dragging.current = {
      x: event.clientX,
      y: event.clientY,
      startX: rect.left - bounds.left,
      startY: rect.top - bounds.top,
    };
    stage.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragging.current;
    const stage = stageRef.current;
    const container = stage?.parentElement;
    if (!drag || !stage || !container) return;
    const box = container.getBoundingClientRect();
    setPosition({
      x: Math.max(
        0,
        Math.min(
          box.width - stage.offsetWidth,
          drag.startX + event.clientX - drag.x,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          box.height - stage.offsetHeight,
          drag.startY + event.clientY - drag.y,
        ),
      ),
    });
  };
  const onPointerUp = (): void => {
    dragging.current = null;
    if (position) localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  };
  return (
    <div
      ref={stageRef}
      className="pet-floating"
      style={
        position
          ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
          : undefined
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onOpenSettings}
    >
      <PetSprite
        info={info}
        state={derivePetState({
          ...activity,
          busy,
          toolRunning: busy && activity.toolRunning,
          reasoning: busy && activity.reasoning,
        })}
      />
    </div>
  );
}
