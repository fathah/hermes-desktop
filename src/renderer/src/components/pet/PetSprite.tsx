import { useEffect, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import type { PetInfo, PetState } from "./petState";

const DEFAULT_ROWS = [
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review",
];

const ROW_ALIASES: Record<PetState, string[]> = {
  idle: ["idle"],
  wave: ["wave", "waving"],
  run: ["run", "running"],
  failed: ["failed"],
  review: ["review"],
  jump: ["jump", "jumping"],
  waiting: ["waiting"],
};

export function PetSprite({
  info,
  state,
}: {
  info: PetInfo;
  state: PetState;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const image = useMemo(() => {
    if (!info.spritesheetBase64) return null;
    const next = new Image();
    next.src = `data:${info.mime ?? "image/webp"};base64,${info.spritesheetBase64}`;
    return next;
  }, [info.mime, info.spritesheetBase64]);
  const frameW = info.frameW ?? 192;
  const frameH = info.frameH ?? 208;
  const scale = info.scale ?? 0.33;
  const drawW = Math.round(frameW * scale);
  const drawH = Math.round(frameH * scale);
  const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const width = Math.max(1, Math.round(drawW * ratio));
  const height = Math.max(1, Math.round(drawH * ratio));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rows = info.stateRows ?? DEFAULT_ROWS;
    const row = rows.findIndex((name) => ROW_ALIASES[state].includes(name));
    const candidateName = rows[row];
    const candidateCount =
      info.framesByState?.[state] ??
      info.framesByRow?.[candidateName] ??
      info.framesByState?.[candidateName] ??
      info.framesPerState ??
      6;
    const resolvedRow =
      row >= 0 && candidateCount > 0 ? row : Math.max(0, rows.indexOf("idle"));
    const rowName = rows[resolvedRow] ?? "idle";
    const count =
      resolvedRow === row
        ? candidateCount
        : (info.framesByRow?.[rowName] ??
          info.framesByState?.idle ??
          info.framesPerState ??
          6);
    const frames = Math.max(1, count);
    let raf = 0;
    let startedAt: number | null = null;
    let lastNow = 0;
    let resume = false;
    let drawnFrame = -1;
    const render = (now: number): void => {
      raf = 0;
      if (document.visibilityState === "hidden") return;
      if (startedAt === null) startedAt = now;
      else if (resume) startedAt += now - lastNow;
      resume = false;
      lastNow = now;
      const currentFrame =
        Math.floor((now - startedAt) / ((info.loopMs ?? 1100) / frames)) %
        frames;
      if (
        image.complete &&
        image.naturalWidth > 0 &&
        currentFrame !== drawnFrame
      ) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(
          image,
          currentFrame * frameW,
          resolvedRow * frameH,
          frameW,
          frameH,
          0,
          0,
          width,
          height,
        );
        drawnFrame = currentFrame;
      }
      raf = requestAnimationFrame(render);
    };
    const visibility = (): void => {
      if (document.visibilityState === "hidden") {
        cancelAnimationFrame(raf);
        raf = 0;
        resume = true;
      } else if (!raf) {
        raf = requestAnimationFrame(render);
      }
    };
    image.addEventListener("load", visibility);
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => {
      cancelAnimationFrame(raf);
      image.removeEventListener("load", visibility);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [
    image,
    state,
    info.stateRows,
    info.framesByState,
    info.framesByRow,
    info.framesPerState,
    info.loopMs,
    frameW,
    frameH,
    width,
    height,
  ]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={info.displayName ? `${info.displayName} pet` : "pet"}
      width={width}
      height={height}
      style={{ width: drawW, height: drawH }}
    />
  );
}
