export interface RendererMediaRequest {
  url: string;
  mediaTypes?: string[];
  devUrl?: string;
}

export function isTrustedAppRenderer(url: string, devUrl?: string): boolean {
  return url.startsWith("file://") || (!!devUrl && url.startsWith(devUrl));
}

export function isRendererMediaRequestAllowed(
  request: RendererMediaRequest,
): boolean {
  if (!isTrustedAppRenderer(request.url, request.devUrl)) return false;
  const mediaTypes = request.mediaTypes ?? [];
  if (mediaTypes.includes("video")) return isQuickCaptureUrl(request.url);
  return true;
}

function isQuickCaptureUrl(url: string): boolean {
  try {
    return new URL(url).searchParams.get("window") === "capture";
  } catch {
    return url.includes("window=capture");
  }
}
