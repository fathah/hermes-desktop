import { app, dialog, protocol, type BrowserWindow } from "electron";
import { randomUUID } from "crypto";
import { basename, extname, join } from "path";
import { copyFile, mkdir, readFile, readdir, unlink } from "fs/promises";
import type {
  CustomSoftBackground,
  CustomSoftBackgroundId,
} from "../shared/soft-backgrounds";

const SCHEME = "hermes-background";
const DIRECTORY_NAME = "soft-backgrounds";
const CUSTOM_ID_PREFIX = "custom:";
const STORED_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}--[\p{L}\p{N}._-]+\.(?:png|jpe?g|webp|gif|avif)$/iu;
const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
]);
const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

function backgroundsDirectory(): string {
  return join(app.getPath("userData"), DIRECTORY_NAME);
}

function storedFilenameFromId(id: string): string | null {
  if (!id.startsWith(CUSTOM_ID_PREFIX)) return null;
  const filename = id.slice(CUSTOM_ID_PREFIX.length);
  return STORED_FILE_PATTERN.test(filename) ? filename : null;
}

function displayName(filename: string): string {
  const withoutId = filename.replace(/^[0-9a-f-]{36}--/i, "");
  return basename(withoutId, extname(withoutId)).replaceAll("-", " ");
}

function toBackground(filename: string): CustomSoftBackground {
  return {
    id: `${CUSTOM_ID_PREFIX}${filename}` as CustomSoftBackgroundId,
    name: displayName(filename),
    image: `${SCHEME}://image/${encodeURIComponent(filename)}`,
  };
}

function safeStem(filePath: string): string {
  const ext = extname(filePath);
  const stem = basename(filePath, ext)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return stem || "custom-image";
}

/** Must run before Electron's ready event. */
export function registerSoftBackgroundScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
      },
    },
  ]);
}

/** Serves only UUID-prefixed image files inside the app-owned directory. */
export function installSoftBackgroundProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "image") return new Response(null, { status: 404 });

    const filename = decodeURIComponent(url.pathname.slice(1));
    if (!STORED_FILE_PATTERN.test(filename)) {
      return new Response(null, { status: 404 });
    }

    try {
      const bytes = await readFile(join(backgroundsDirectory(), filename));
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Cache-Control": "private, max-age=31536000, immutable",
          "Content-Type":
            CONTENT_TYPES[extname(filename).toLowerCase()] ??
            "application/octet-stream",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

export async function listCustomSoftBackgrounds(): Promise<
  CustomSoftBackground[]
> {
  const directory = backgroundsDirectory();
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && STORED_FILE_PATTERN.test(entry.name))
    .map((entry) => toBackground(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function addCustomSoftBackgrounds(
  parent?: BrowserWindow,
): Promise<CustomSoftBackground[]> {
  const options: Electron.OpenDialogOptions = {
    title: "Add soft backgrounds",
    buttonLabel: "Add images",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif"],
      },
    ],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled) return [];

  const directory = backgroundsDirectory();
  await mkdir(directory, { recursive: true });
  const added: CustomSoftBackground[] = [];
  for (const sourcePath of result.filePaths) {
    const extension = extname(sourcePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) continue;
    const filename = `${randomUUID()}--${safeStem(sourcePath)}${extension}`;
    await copyFile(sourcePath, join(directory, filename));
    added.push(toBackground(filename));
  }
  return added;
}

export async function removeCustomSoftBackground(id: string): Promise<boolean> {
  const filename = storedFilenameFromId(id);
  if (!filename) return false;
  try {
    await unlink(join(backgroundsDirectory(), filename));
    return true;
  } catch {
    return false;
  }
}
