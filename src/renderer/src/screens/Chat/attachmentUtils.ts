import {
  type Attachment,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGE_TARGET_BYTES,
  MAX_TEXT_BYTES,
  isImageMime,
  isTextFile,
} from "../../../../shared/attachments";

export interface AttachmentError {
  code:
    | "too-many"
    | "image-too-large"
    | "image-uncompressible"
    | "text-too-large"
    | "unsupported-type"
    | "read-failed"
    | "remote-mode-binary";
  filename: string;
  detail?: string;
}

export interface ProcessFilesOptions {
  // Session id used to scope staged-paste attachments.  May be empty
  // before the agent has assigned one — staging falls back to "default".
  sessionId?: string;
  // True when the chat is running against a non-local gateway (SSH or
  // remote-URL mode).  Path-ref attachments require the file path to
  // exist on the same host as the agent, so binaries are blocked.
  remoteMode?: boolean;
}

function newId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsText(file, "utf-8");
  });
}

function readAsBase64(file: File): Promise<string> {
  return readAsDataUrl(file).then((dataUrl) => {
    const comma = dataUrl.indexOf(",");
    return comma >= 0 ? dataUrl.slice(comma + 1) : "";
  });
}

// ─────────────────────────────────────────────────────────────────────
//  Image compression (issue #405)
// ─────────────────────────────────────────────────────────────────────
//
// The gateway accepts request bodies up to 10 MB (`MAX_REQUEST_BYTES` in
// `gateway/platforms/api_server.py`). A user image is base64-encoded into
// the JSON body — 4/3× inflation — so anything larger than ~7 MB binary
// produces a body that fails to parse, and the gateway returns the
// (misleading) error "Invalid JSON in request body".
//
// Rather than reject oversized images, the desktop downscales them client-
// side to fit under `MAX_IMAGE_TARGET_BYTES`. The loop drops lossy encoder
// quality first (cheap, perceptually fine to ~0.5) then scales down by 20%
// steps (lossier but bounded). Images already under the target pass through
// untouched — no quality loss, no recompression.
//
// Format strategy: transparent PNGs (alpha channel detected via canvas
// pixel sampling) stay as PNG so transparency survives; opaque images are
// encoded as WebP and JPEG and the smaller result wins. Animated GIFs only
// have their first frame captured by canvas, so we explicitly bail with
// `image-uncompressible` and let the user decide whether to send the static
// thumbnail.

function loadHtmlImage(file: File): Promise<HTMLImageElement> {
  // Round-trip through FileReader → data URL → Image.src rather than
  // `URL.createObjectURL` + `revokeObjectURL`. Data URLs are slightly
  // more memory (~33% base64 overhead during decode) but they survive
  // automation/CDP contexts where blob URLs sometimes fail to decode,
  // and they avoid the URL lifecycle entirely (no race between revoke
  // and decode-complete).
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      const img = new Image();
      img.onload = (): void => resolve(img);
      img.onerror = (): void => reject(new Error("image-decode-failed"));
      img.src = String(reader.result || "");
    };
    reader.onerror = (): void => reject(new Error("image-decode-failed"));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob-failed"))),
      type,
      quality,
    );
  });
}

/**
 * Detect a non-opaque pixel by sampling the canvas. Sampling instead of
 * scanning every pixel because a 4000×3000 image has 12M pixels and
 * `getImageData` for the whole thing is slow + allocates 48 MB. Strided
 * sampling at ~10k points is sufficient to find any transparent region
 * the user might have intentionally placed (logos, UI screenshots, etc.).
 */
function canvasHasTransparency(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const { width, height } = canvas;
  if (width === 0 || height === 0) return false;
  const samples = 100; // 100 × 100 = 10_000 sample points
  const stepX = Math.max(1, Math.floor(width / samples));
  const stepY = Math.max(1, Math.floor(height / samples));
  for (let y = 0; y < height; y += stepY) {
    const row = ctx.getImageData(0, y, width, 1).data;
    for (let x = 0; x < width; x += stepX) {
      if (row[x * 4 + 3] < 255) return true;
    }
  }
  return false;
}

/**
 * Compress an oversized image down to ≤ `targetBytes`.  No-ops when the
 * file is already under the target (cheap fast path — no decode, no
 * recompression).  Returns the original `File` in that case so callers
 * can compare by reference and know whether compression actually ran.
 *
 * Throws `Error("image-uncompressible")` if compression can't get the
 * file under the cap even at minimum scale and quality (rare — only
 * triggers on degenerate inputs like multi-gigapixel images or formats
 * the canvas can't re-encode).
 */
export async function compressImageToFit(
  file: File,
  targetBytes: number,
): Promise<File> {
  if (file.size <= targetBytes) return file;

  // Animated GIFs lose animation through canvas. Pass through unchanged
  // and let the caller reject if over-cap — re-encoding to a JPEG frame
  // loses information silently which is worse than a clear "too big" UX.
  if (file.type === "image/gif" && file.size > targetBytes) {
    throw new Error("image-uncompressible");
  }

  let img: HTMLImageElement;
  try {
    img = await loadHtmlImage(file);
  } catch {
    throw new Error("image-decode-failed");
  }

  // Render once at full resolution to probe for alpha — decides whether
  // we can switch to lossy compression (huge size win) or must stay on
  // a lossless format that preserves transparency.
  const probeCanvas = document.createElement("canvas");
  probeCanvas.width = img.naturalWidth;
  probeCanvas.height = img.naturalHeight;
  const probeCtx = probeCanvas.getContext("2d");
  if (!probeCtx) throw new Error("canvas-unavailable");
  probeCtx.drawImage(img, 0, 0);
  const hasAlpha = canvasHasTransparency(probeCanvas);

  // Candidate output formats. The base64 4/3× wire inflation is fixed
  // by the OpenAI chat-completions content shape — what we control is
  // the binary that gets inflated. So we encode each candidate at the
  // current quality and pick the smallest blob:
  //
  //   - Alpha images: PNG only (the lossless format that preserves
  //     transparency). We could try WebP-lossless too but it rarely
  //     beats PNG for screenshot-style content and adds complexity.
  //   - Opaque images: BOTH WebP and JPEG, pick the smaller. WebP is
  //     usually ~25-50% smaller for screenshots/photos, but JPEG
  //     marginally wins on high-frequency noise/grain content.
  //     Running both costs ~2× encoding time per iteration but
  //     guarantees the smallest wire payload regardless of content.
  //
  // WebP availability is probed once up-front — Chromium's `toBlob`
  // silently produces PNG when it can't honour an unsupported type,
  // so we explicitly check the returned blob type.
  type Candidate = {
    type: string;
    ext: string;
    quality: number | undefined; // undefined = lossless / format default
  };
  const candidates: Candidate[] = [];
  if (hasAlpha) {
    candidates.push({ type: "image/png", ext: "png", quality: undefined });
  } else {
    const webpOk = await canvasSupportsType(probeCanvas, "image/webp");
    if (webpOk) {
      candidates.push({ type: "image/webp", ext: "webp", quality: 0.85 });
    }
    candidates.push({ type: "image/jpeg", ext: "jpg", quality: 0.85 });
  }
  const isLossy = !hasAlpha;

  // Compression loop:
  //   Phase 1 — lossy formats: step quality down from 0.85 to 0.5
  //     across all candidates, keeping the smallest blob ≤ target.
  //   Phase 2 — PNG path or all lossy still too big: scale dimensions
  //     down by 20% per step, resetting quality to 0.85 each round.
  let scale = 1.0;
  let quality = 0.85;
  // Reuse the probe canvas at scale=1 to skip a re-decode for the first
  // iteration. Allocate a fresh canvas only when we actually downsample.
  let workingCanvas: HTMLCanvasElement = probeCanvas;

  // Safety bound: 20 iterations max so a pathological input can't hang
  // the renderer thread. With the step sizes above this loop converges
  // for any input we can decode (worst case: ~3 quality drops × ~6 scale
  // drops = 18 iters).
  for (let i = 0; i < 20; i++) {
    // Encode every candidate at the current quality and remember the
    // smallest blob.  Skip candidates whose encode produces a blob of
    // the wrong type (Chromium fallback to PNG) — those don't count.
    let bestBlob: Blob | null = null;
    let bestCandidate: Candidate | null = null;
    for (const cand of candidates) {
      let blob: Blob;
      try {
        blob = await canvasToBlob(
          workingCanvas,
          cand.type,
          cand.quality === undefined ? undefined : quality,
        );
      } catch {
        continue;
      }
      if (blob.type !== cand.type) continue;
      if (!bestBlob || blob.size < bestBlob.size) {
        bestBlob = blob;
        bestCandidate = cand;
      }
    }
    if (!bestBlob || !bestCandidate) throw new Error("canvas-unavailable");

    if (bestBlob.size <= targetBytes) {
      const newName =
        file.name.replace(/\.[^.]+$/, "") + "." + bestCandidate.ext;
      return new File([bestBlob], newName, { type: bestCandidate.type });
    }

    // For lossy formats: drop quality before scaling — visually preferable.
    if (isLossy && quality > 0.5) {
      quality -= 0.15;
      continue;
    }

    // Need to scale down. PNG path always lands here (no quality knob).
    scale *= 0.8;
    if (workingCanvas.width * scale < 64 || workingCanvas.height * scale < 64) {
      // Below 64 px we'd be unrecognisable even to vision models —
      // refuse rather than silently emit a useless thumbnail.
      throw new Error("image-uncompressible");
    }

    const scaled = document.createElement("canvas");
    scaled.width = Math.max(64, Math.floor(img.naturalWidth * scale));
    scaled.height = Math.max(64, Math.floor(img.naturalHeight * scale));
    const sctx = scaled.getContext("2d");
    if (!sctx) throw new Error("canvas-unavailable");
    sctx.drawImage(img, 0, 0, scaled.width, scaled.height);
    workingCanvas = scaled;
    quality = 0.85; // reset for next quality attempt
  }

  throw new Error("image-uncompressible");
}

/**
 * Runtime feature probe: does this canvas's `toBlob` actually produce
 * the requested MIME type? Chromium's toBlob silently falls back to
 * PNG when it can't honour the requested type (no error, just a
 * misleading output blob), so the only reliable check is to ask for a
 * tiny encode and inspect the result.  Cheap (<5 ms for a 1×1 canvas)
 * and we only call it once per compression session.
 */
async function canvasSupportsType(
  source: HTMLCanvasElement,
  type: string,
): Promise<boolean> {
  // Use a 1×1 probe canvas rather than `source` so the probe is fast
  // regardless of the source's pixel area (a 4000×4000 source would
  // otherwise burn dozens of MB encoding the probe).
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext("2d");
  if (ctx) ctx.drawImage(source, 0, 0, 1, 1);
  try {
    const blob = await canvasToBlob(probe, type, 0.5);
    return blob.type === type;
  } catch {
    return false;
  }
}

export interface ProcessFilesResult {
  attachments: Attachment[];
  errors: AttachmentError[];
}

/**
 * Convert browser File objects into Attachment values.
 *
 * Routing rules:
 *   - Image MIME (png/jpeg/webp/gif) → inline `image` attachment with
 *     a data URL.
 *   - Text/code file (by MIME prefix or extension allowlist) → inline
 *     `text-file` attachment with UTF-8 contents.
 *   - Everything else → `path-ref` attachment carrying the file's
 *     absolute path.  Picker / drag-drop expose the path via
 *     `webUtils.getPathForFile`; clipboard-pasted blobs have no origin
 *     path and are staged to disk via the main process.
 */
export async function processFiles(
  files: File[] | FileList,
  existingCount: number,
  options: ProcessFilesOptions = {},
): Promise<ProcessFilesResult> {
  const list = Array.from(files);
  const attachments: Attachment[] = [];
  const errors: AttachmentError[] = [];

  const slotsRemaining = Math.max(
    0,
    MAX_ATTACHMENTS_PER_MESSAGE - existingCount,
  );

  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    if (i >= slotsRemaining) {
      errors.push({ code: "too-many", filename: file.name });
      continue;
    }

    const mime = file.type || "";
    const name = file.name || "untitled";

    if (isImageMime(mime)) {
      // Sanity cap: only reject pathologically large inputs that would
      // OOM the canvas or fail to decode. Anything reasonable proceeds
      // to the compression step below.
      if (file.size > MAX_IMAGE_INPUT_BYTES) {
        errors.push({ code: "image-too-large", filename: name });
        continue;
      }

      let compressedFile: File = file;
      const originalSize = file.size;
      // Skip compression for files already under the gateway-safe target.
      // `compressImageToFit` itself short-circuits but checking here keeps
      // the dataUrl read path identical for small images (no canvas decode
      // overhead at all).
      if (file.size > MAX_IMAGE_TARGET_BYTES) {
        try {
          compressedFile = await compressImageToFit(
            file,
            MAX_IMAGE_TARGET_BYTES,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({
            code:
              msg === "image-uncompressible" || msg === "image-decode-failed"
                ? "image-uncompressible"
                : "read-failed",
            filename: name,
            detail: msg,
          });
          continue;
        }
      }

      try {
        const dataUrl = await readAsDataUrl(compressedFile);
        attachments.push({
          id: newId(),
          kind: "image",
          name: compressedFile.name || name,
          mime: compressedFile.type || mime,
          size: compressedFile.size,
          dataUrl,
          // Only set when we actually transcoded — preserves the chip's
          // simple "5.2 MB" display for unmodified attachments and adds
          // the "from N MB" hint only when the user lost some quality.
          ...(compressedFile !== file ? { originalSize } : {}),
        });
      } catch (err) {
        errors.push({
          code: "read-failed",
          filename: name,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }

    if (isTextFile(mime, name)) {
      if (file.size > MAX_TEXT_BYTES) {
        errors.push({ code: "text-too-large", filename: name });
        continue;
      }
      try {
        const text = await readAsText(file);
        attachments.push({
          id: newId(),
          kind: "text-file",
          name,
          mime: mime || "text/plain",
          size: file.size,
          text,
        });
      } catch (err) {
        errors.push({
          code: "read-failed",
          filename: name,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }

    // Path-ref path — binary/document attachment that the agent will
    // read via its own file tools.  Requires a filesystem path that's
    // valid on the agent's host.
    if (options.remoteMode) {
      errors.push({ code: "remote-mode-binary", filename: name });
      continue;
    }

    let path = "";
    try {
      path = window.hermesAPI.getPathForFile(file) || "";
    } catch {
      path = "";
    }

    if (!path) {
      // No origin path (clipboard paste) — stage the bytes to disk.
      try {
        const base64 = await readAsBase64(file);
        path = await window.hermesAPI.stageAttachment(
          options.sessionId || "",
          name,
          base64,
        );
      } catch (err) {
        errors.push({
          code: "read-failed",
          filename: name,
          detail: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
    }

    if (!path) {
      errors.push({ code: "read-failed", filename: name });
      continue;
    }

    attachments.push({
      id: newId(),
      kind: "path-ref",
      name,
      mime: mime || "application/octet-stream",
      size: file.size,
      path,
    });
  }

  return { attachments, errors };
}

/**
 * Extract any File objects from a clipboard paste event.  Returns:
 * - {files: File[], hasText: boolean} where hasText indicates whether the
 *   clipboard also contained plain text (so callers can decide whether to
 *   suppress the default paste behavior).
 */
export function filesFromClipboard(
  event: ClipboardEvent | React.ClipboardEvent,
): {
  files: File[];
  hasText: boolean;
} {
  const files: File[] = [];
  let hasText = false;
  const items = event.clipboardData?.items;
  if (!items) return { files, hasText };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "file") {
      const f = it.getAsFile();
      if (f) files.push(f);
    } else if (it.kind === "string" && it.type === "text/plain") {
      hasText = true;
    }
  }
  return { files, hasText };
}
