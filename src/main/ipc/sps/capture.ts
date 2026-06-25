import { clipboard } from "electron";
import { safeHandle } from "../safe-handle";
import { spsUnfurl } from "../../sps-agent";
import { writeSpsCapture } from "../../sps-capture";
import { resolveSpsVaultDir } from "../../sps-storage";
import {
  importClipboardScreenshot,
  importRecentScreenshot,
  listRecentScreenshots,
} from "../../recent-screenshots";
import { requireLocalWorkspace } from "../connection-guards";
import type { SpsCaptureInput } from "../../../shared/sps-types";
import type {
  SpsClipboardScreenshotImportInput,
  SpsRecentScreenshotImportInput,
} from "../../../shared/recent-screenshots";

export function registerSpsCaptureIpc(): void {
  safeHandle(
    "sps-capture",
    async (_event, input: SpsCaptureInput, profile?: string) => {
      const capture = { ...input };
      if (capture.source === "web" && capture.url) {
        const unfurled = await spsUnfurl(capture.url);
        capture.title = capture.title?.trim() || unfurled.title;
        capture.description = capture.description?.trim() || unfurled.desc;
      }
      return writeSpsCapture(resolveSpsVaultDir(profile), capture);
    },
  );
  safeHandle(
    "sps-list-recent-screenshots",
    async (_event, profile?: string) => {
      requireLocalWorkspace();
      void profile;
      const screenshots = await listRecentScreenshots();
      return screenshots.map(
        ({ id, originalName, modifiedAt, size, previewDataUrl }) => ({
          id,
          originalName,
          modifiedAt,
          size,
          ...(previewDataUrl ? { previewDataUrl } : {}),
        }),
      );
    },
  );
  safeHandle(
    "sps-import-recent-screenshot",
    async (
      _event,
      input?: SpsRecentScreenshotImportInput,
      profile?: string,
    ) => {
      requireLocalWorkspace();
      return importRecentScreenshot(resolveSpsVaultDir(profile), input);
    },
  );
  safeHandle(
    "sps-import-clipboard-screenshot",
    async (
      _event,
      input?: SpsClipboardScreenshotImportInput,
      profile?: string,
    ) => {
      requireLocalWorkspace();
      const image = clipboard.readImage();
      return importClipboardScreenshot(
        resolveSpsVaultDir(profile),
        image.isEmpty() ? Buffer.alloc(0) : image.toPNG(),
        input,
      );
    },
  );
}
