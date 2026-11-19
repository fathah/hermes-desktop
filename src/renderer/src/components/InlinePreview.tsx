// @lat: [[inline-preview#Inline preview directive]]
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * `::preview{file="…"}` — a workspace HTML file rendered LIVE inside the
 * agent message. A sandboxed iframe with an opaque origin
 * (`sandbox="allow-scripts"`, deliberately no `allow-same-origin`): scripts
 * run and the widget is fully interactive, but the document cannot reach the
 * app, its cookies, storage, or the IPC bridge. The document arrives via
 * `srcDoc` from a main-process text read, so single-file HTML (what agents
 * generate) is fully live; relative sibling assets don't resolve in an
 * opaque origin.
 *
 * Ported from Nous Research's `apps/desktop` inline-preview directive. A
 * theme prelude injects first — the app's resolved theme tokens under the
 * friendly names the reference HTML writes against (`--foreground`,
 * `--muted-foreground`, `--accent`, `--border`, `--card`), the app font, zero
 * body margin, and a transparent background. The page's own styles override
 * all of it. A measurement script posts the content height up so the frame
 * shrink-wraps to its content instead of showing a fixed-height box.
 */

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 1200;
const DEFAULT_HEIGHT = 320;
const RESIZE_TOLERANCE = 4;
const SIZE_MESSAGE_TYPE = "hermes-inline-preview-size";
const INTENT_MESSAGE_TYPE = "hermes-inline-preview-intent";
const INTENT_SEND_EVENT = "inline-preview:send";
const MAX_INTENT_LENGTH = 500;
const INTENT_THROTTLE_MS = 1000;

/** Fathah theme tokens → the friendly names reference HTML writes against. */
const THEME_BRIDGE_TOKENS: Array<[string, string]> = [
  ["--foreground", "--text-primary"],
  ["--muted-foreground", "--text-muted"],
  ["--accent", "--accent"],
  ["--border", "--border"],
  ["--card", "--bg-elevated"],
];

function themePrelude(): string {
  if (typeof document === "undefined") return "";
  const root = getComputedStyle(document.documentElement);
  const tokens = THEME_BRIDGE_TOKENS.map(([alias, source]) => {
    const value = root.getPropertyValue(source).trim();
    return value ? `${alias}:${value}` : "";
  })
    .filter(Boolean)
    .join(";");
  const font = getComputedStyle(document.body).fontFamily || "";
  const fontRule = font ? `font-family:${font};` : "";
  return (
    `<style>:root{${tokens}}` +
    `html,body{margin:0;padding:0;background:transparent;color:var(--foreground,inherit);${fontRule}}</style>`
  );
}

/** Posts the document's height to the parent so the frame shrink-wraps. */
function measurementScript(token: string): string {
  return (
    "<script>(function(){var t=" +
    JSON.stringify(token) +
    ";var lastH=0;function post(){var d=document.documentElement;var b=document.body;" +
    "var h=Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0);" +
    "if(Math.abs(h-lastH)>1){lastH=h;parent.postMessage({type:" +
    JSON.stringify(SIZE_MESSAGE_TYPE) +
    ",token:t,height:h},\"*\")}}" +
    "if(typeof ResizeObserver===\"function\"){var ro=new ResizeObserver(post);" +
    "ro.observe(document.documentElement);if(document.body)ro.observe(document.body)}" +
    "addEventListener(\"load\",post);post()})()</script>"
  );
}

/**
 * The widget's ONE voice: a capture-phase click listener on `data-hermes-send`
 * posts the prompt up tagged with the mount token. Only TRUSTED user clicks
 * are accepted (`isTrusted`) and no programmatic `window.hermes.send` is
 * exposed, so a script or load handler in the frame cannot impersonate the
 * user and start an agent turn. The parent validates (type, token, length,
 * throttle) and routes an accepted prompt through the chat send path.
 */
function intentScript(token: string): string {
  return (
    "<script>(function(){var t=" +
    JSON.stringify(token) +
    ";function send(p){if(typeof p!==\"string\"||!p.trim())return;" +
    "parent.postMessage({type:" +
    JSON.stringify(INTENT_MESSAGE_TYPE) +
    ",token:t,prompt:p.trim()},\"*\")}" +
    "addEventListener(\"click\",function(e){if(!e.isTrusted)return;" +
    "var el=e.target&&e.target.closest?e.target.closest(\"[data-hermes-send]\"):null;" +
    "if(el)send(el.getAttribute(\"data-hermes-send\")||\"\")},true)})()</script>"
  );
}

function clampHeight(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, parsed));
}

export function InlinePreview({
  file,
  raw,
  height,
  workspace,
}: {
  file: string;
  raw: string;
  height?: string;
  /** The session's linked workspace, used to resolve relative file paths. */
  workspace?: string | null;
}): React.JSX.Element {
  const [doc, setDoc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [measured, setMeasured] = useState<number | null>(null);
  const token = useMemo(() => Math.random().toString(36).slice(2), []);
  const lastIntentAt = useRef(0);

  useEffect(() => {
    let cancelled = false;
    // Clear the previous error on every (re)read so a relative path that
    // failed before its workspace was linked can recover once it is linked.
    setFailed(false);
    window.hermesAPI
      .readPreviewFile(file, workspace ?? undefined)
      .then((text) => {
        if (cancelled) return;
        if (text) setDoc(text);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [file, workspace]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: unknown;
        token?: unknown;
        height?: unknown;
      };
      if (
        data?.type !== SIZE_MESSAGE_TYPE ||
        data?.token !== token ||
        typeof data.height !== "number" ||
        !Number.isFinite(data.height)
      ) {
        return;
      }
      setMeasured((prev) => {
        const next = Math.min(
          MAX_HEIGHT,
          Math.max(MIN_HEIGHT, Math.round(data.height as number)),
        );
        return Math.abs(next - (prev ?? DEFAULT_HEIGHT)) > RESIZE_TOLERANCE
          ? next
          : prev;
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [token]);

  // Widget intents: accept only OUR message type carrying OUR mount token,
  // with a length cap and a human-speed throttle, then re-emit as a DOM event
  // that Chat.tsx routes through the send path. Anything else is ignored.
  useEffect(() => {
    const onIntent = (event: MessageEvent): void => {
      const data = event.data as {
        type?: unknown;
        token?: unknown;
        prompt?: unknown;
      };
      if (data?.type !== INTENT_MESSAGE_TYPE || data?.token !== token) return;
      const prompt = typeof data.prompt === "string" ? data.prompt.trim() : "";
      if (!prompt || prompt.length > MAX_INTENT_LENGTH) return;
      const now = Date.now();
      if (
        lastIntentAt.current > 0 &&
        now - lastIntentAt.current < INTENT_THROTTLE_MS
      ) {
        return;
      }
      lastIntentAt.current = now;
      document.dispatchEvent(
        new CustomEvent(INTENT_SEND_EVENT, { detail: prompt }),
      );
    };
    window.addEventListener("message", onIntent);
    return () => window.removeEventListener("message", onIntent);
  }, [token]);

  // A failed read falls back to the literal directive text — never a broken
  // frame — matching how an unverified bare path renders verbatim.
  if (failed) return <>{raw}</>;
  if (!doc) return <span className="chat-media-loading">Loading {file}…</span>;

  const framedDoc =
    themePrelude() + doc + measurementScript(token) + intentScript(token);
  const frameHeight = measured ?? clampHeight(height, DEFAULT_HEIGHT);

  return (
    <iframe
      className="chat-inline-preview"
      sandbox="allow-scripts"
      srcDoc={framedDoc}
      title={file}
      style={{
        height: frameHeight,
        width: "100%",
        border: "none",
        background: "transparent",
        display: "block",
      }}
    />
  );
}
