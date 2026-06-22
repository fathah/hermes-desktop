export type VisualCaptureOrigin =
  | "screen-snippet"
  | "recent-file"
  | "clipboard"
  | "file"
  | "camera";

export type VisualCaptureOcrStatus = "not-run" | "complete" | "failed";

export interface VisualCaptureBodyInput {
  assetPath: string;
  originalName: string;
  note?: string;
}

export interface VisualCaptureTitleInput {
  captureOrigin: VisualCaptureOrigin;
  originalName: string;
  capturedAt: number;
}

export function buildVisualCaptureBody(input: VisualCaptureBodyInput): string {
  const lines = [
    `![Capture](../_assets/${input.assetPath})`,
    `Imported from ${input.originalName}.`,
  ];
  const note = input.note?.trim();
  if (note) lines.push(`Note: ${note}`);
  return lines.join("\n\n");
}

export function visualCaptureTitle(input: VisualCaptureTitleInput): string {
  if (input.captureOrigin === "file" && input.originalName.trim()) {
    return input.originalName.trim();
  }
  const date = new Date(input.capturedAt);
  const when = Number.isNaN(date.getTime())
    ? ""
    : ` - ${date.toLocaleString()}`;
  switch (input.captureOrigin) {
    case "camera":
      return `Camera capture${when}`;
    case "screen-snippet":
      return `Screen snippet${when}`;
    case "clipboard":
      return `Clipboard screenshot${when}`;
    case "recent-file":
      return input.originalName.trim() || `Screenshot${when}`;
    case "file":
      return input.originalName.trim() || `Image capture${when}`;
  }
}

export function visualCaptureMimeFromPath(path: string): string {
  const ext = visualCaptureExtFromPath(path).toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  if (ext === "svg") return "image/svg+xml";
  return "image/png";
}

export function visualCaptureExtFromPath(path: string): string {
  const clean = path.split(/[?#]/, 1)[0] ?? "";
  const name = clean.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  const ext =
    dot >= 0
      ? name
          .slice(dot + 1)
          .trim()
          .toLowerCase()
      : "";
  return ext || "png";
}

export function visualCaptureNameFromPath(path: string): string {
  const clean = path.split(/[?#]/, 1)[0] ?? "";
  return clean.split(/[\\/]/).pop()?.trim() || "image.png";
}
