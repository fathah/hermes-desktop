import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CircleAlert,
  ExternalLink,
  Eye,
  FileCode2,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";

const CodeEditor = lazy(() =>
  import("./CodeEditor").then((module) => ({
    default: module.CodeEditor,
  })),
);

interface FileViewerProps {
  files: string[];
  activeFilePath: string;
  workspaceRoot: string;
  onSelectFile: (filePath: string) => void;
  onCloseFile: (filePath: string) => void;
}

interface DocumentState {
  status: "loading" | "ready" | "error";
  kind: "text" | "image" | "binary";
  savedContent: string;
  draft: string;
  editToken?: string;
  imageUrl?: string;
  truncated: boolean;
  mode: "view" | "edit";
  saving: boolean;
  notice?: "saved" | "saveFailed" | "stale";
}

const VIEWABLE_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "svg",
  "ico",
]);

const BINARY_EXTENSIONS = new Set([
  "heic",
  "heif",
  "tiff",
  "tif",
  "raw",
  "psd",
  "ai",
  "eps",
  "pdf",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "flv",
  "wmv",
  "mp3",
  "wav",
  "flac",
  "aac",
  "ogg",
  "wma",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "bz2",
  "xz",
  "exe",
  "dmg",
  "pkg",
  "deb",
  "rpm",
  "msi",
  "dll",
  "so",
  "dylib",
  "bin",
  "dat",
  "db",
  "sqlite",
  "sqlite3",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
]);

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function getFileExtension(filePath: string): string {
  const fileName = getFileName(filePath);
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

function relativeFilePath(workspaceRoot: string, filePath: string): string {
  const normalizedRoot = workspaceRoot.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedFile = filePath.replace(/\\/g, "/");
  return normalizedFile.startsWith(`${normalizedRoot}/`)
    ? normalizedFile.slice(normalizedRoot.length + 1)
    : filePath;
}

function formatFileSize(content: string): string {
  const bytes = new Blob([content]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function initialDocument(kind: DocumentState["kind"]): DocumentState {
  return {
    status: kind === "binary" ? "ready" : "loading",
    kind,
    savedContent: "",
    draft: "",
    truncated: false,
    mode: "view",
    saving: false,
  };
}

function dirty(document: DocumentState | undefined): boolean {
  return (
    !!document &&
    document.kind === "text" &&
    document.draft !== document.savedContent
  );
}

export const FileViewer = memo(function FileViewer({
  files,
  activeFilePath,
  workspaceRoot,
  onSelectFile,
  onCloseFile,
}: FileViewerProps): React.JSX.Element {
  const { t } = useI18n();
  const [documents, setDocuments] = useState<Record<string, DocumentState>>({});
  const documentsRef = useRef(documents);
  const mountedRef = useRef(true);
  documentsRef.current = documents;
  const activeDocument = documents[activeFilePath];
  const activeFileName = getFileName(activeFilePath);
  const relativePath = relativeFilePath(workspaceRoot, activeFilePath);

  const updateDocument = useCallback(
    (
      filePath: string,
      update: (current: DocumentState) => DocumentState,
    ): void => {
      setDocuments((current) => {
        const document = current[filePath];
        if (!document) return current;
        return { ...current, [filePath]: update(document) };
      });
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (documentsRef.current[activeFilePath]) return;

    const extension = getFileExtension(activeFilePath);
    const kind = VIEWABLE_IMAGE_EXTENSIONS.has(extension)
      ? "image"
      : BINARY_EXTENSIONS.has(extension)
        ? "binary"
        : "text";

    setDocuments((current) => ({
      ...current,
      [activeFilePath]: initialDocument(kind),
    }));

    if (kind === "binary") return;

    void (async () => {
      if (kind === "image") {
        const imageUrl = await window.hermesAPI.readImageFile(activeFilePath);
        if (!mountedRef.current) return;
        updateDocument(activeFilePath, (current) => ({
          ...current,
          status: imageUrl ? "ready" : "error",
          imageUrl: imageUrl ?? undefined,
        }));
        return;
      }

      const result = await window.hermesAPI.readFile(
        activeFilePath,
        102_400,
        workspaceRoot,
      );
      if (!mountedRef.current) return;
      updateDocument(activeFilePath, (current) =>
        result
          ? {
              ...current,
              status: "ready",
              savedContent: result.content,
              draft: result.content,
              truncated: result.truncated,
              editToken: result.editToken,
            }
          : { ...current, status: "error" },
      );
    })();
  }, [activeFilePath, updateDocument, workspaceRoot]);

  const canEdit =
    activeDocument?.status === "ready" &&
    activeDocument.kind === "text" &&
    !activeDocument.truncated &&
    !!activeDocument.editToken;
  const isDirty = dirty(activeDocument);

  const saveActiveFile = useCallback(async (): Promise<void> => {
    const document = documents[activeFilePath];
    if (
      !document ||
      !document.editToken ||
      document.saving ||
      !dirty(document)
    ) {
      return;
    }

    updateDocument(activeFilePath, (current) => ({
      ...current,
      saving: true,
      notice: undefined,
    }));
    const result = await window.hermesAPI.saveFile(
      document.editToken,
      document.draft,
    );
    updateDocument(activeFilePath, (current) =>
      result.success
        ? {
            ...current,
            savedContent: current.draft,
            saving: false,
            notice: "saved",
          }
        : {
            ...current,
            saving: false,
            notice: result.error === "stale" ? "stale" : "saveFailed",
          },
    );
  }, [activeFilePath, documents, updateDocument]);

  const requestCloseFile = useCallback(
    (filePath: string): void => {
      if (
        dirty(documents[filePath]) &&
        !window.confirm(t("chat.worktree.discardChanges"))
      ) {
        return;
      }
      setDocuments((current) => {
        const next = { ...current };
        delete next[filePath];
        return next;
      });
      onCloseFile(filePath);
    },
    [documents, onCloseFile, t],
  );

  const notice = useMemo(() => {
    if (!activeDocument?.notice) return null;
    if (activeDocument.notice === "saved") return t("chat.worktree.saved");
    if (activeDocument.notice === "stale") return t("chat.worktree.staleFile");
    return t("chat.worktree.saveFailed");
  }, [activeDocument?.notice, t]);

  return (
    <section
      className="file-viewer-panel"
      aria-label={t("chat.worktree.editor")}
    >
      <div className="file-viewer-tabs" role="tablist">
        {files.map((filePath) => {
          const selected = filePath === activeFilePath;
          return (
            <div
              key={filePath}
              className={`file-viewer-tab ${selected ? "active" : ""}`}
              role="tab"
              aria-selected={selected}
              onClick={() => onSelectFile(filePath)}
              title={filePath}
            >
              <FileCode2 size={14} />
              <span>{getFileName(filePath)}</span>
              {dirty(documents[filePath]) && (
                <span
                  className="file-viewer-dirty"
                  aria-label={t("chat.worktree.unsaved")}
                />
              )}
              <button
                type="button"
                className="file-viewer-tab-close"
                aria-label={`${t("chat.worktree.closeFile")} ${getFileName(filePath)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  requestCloseFile(filePath);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="file-viewer-toolbar">
        <div className="file-viewer-breadcrumb" title={activeFilePath}>
          <span>{relativePath}</span>
          {activeDocument?.kind === "text" &&
            activeDocument.status === "ready" && (
              <span className="file-viewer-size">
                {formatFileSize(activeDocument.draft)}
                {activeDocument.truncated &&
                  ` · ${t("chat.worktree.fileTruncated")}`}
              </span>
            )}
        </div>

        <div className="file-viewer-actions">
          {canEdit && (
            <div
              className="file-viewer-mode"
              role="group"
              aria-label={t("chat.worktree.mode")}
            >
              <button
                type="button"
                className={activeDocument?.mode === "view" ? "active" : ""}
                onClick={() =>
                  updateDocument(activeFilePath, (current) => ({
                    ...current,
                    mode: "view",
                  }))
                }
                aria-label={t("chat.worktree.view")}
              >
                <Eye size={13} />
                <span>{t("chat.worktree.view")}</span>
              </button>
              <button
                type="button"
                className={activeDocument?.mode === "edit" ? "active" : ""}
                onClick={() =>
                  updateDocument(activeFilePath, (current) => ({
                    ...current,
                    mode: "edit",
                  }))
                }
                aria-label={t("chat.worktree.edit")}
              >
                <Pencil size={13} />
                <span>{t("chat.worktree.edit")}</span>
              </button>
            </div>
          )}

          {isDirty && (
            <button
              type="button"
              className="btn-ghost file-viewer-action"
              onClick={() =>
                updateDocument(activeFilePath, (current) => ({
                  ...current,
                  draft: current.savedContent,
                  notice: undefined,
                }))
              }
              title={t("chat.worktree.revert")}
              aria-label={t("chat.worktree.revert")}
            >
              <RotateCcw size={14} />
            </button>
          )}
          <button
            type="button"
            className="btn-ghost file-viewer-action"
            onClick={() => window.hermesAPI.openFileInEditor(activeFilePath)}
            title={t("chat.worktree.openInEditor")}
            aria-label={t("chat.worktree.openInEditor")}
          >
            <ExternalLink size={14} />
          </button>
          <button
            type="button"
            className="file-viewer-save"
            onClick={() => void saveActiveFile()}
            disabled={!isDirty || activeDocument?.saving}
            title={`${t("chat.worktree.save")} (⌘S / Ctrl+S)`}
          >
            {activeDocument?.saving ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Save size={14} />
            )}
            <span>{t("chat.worktree.save")}</span>
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`file-viewer-notice ${activeDocument?.notice === "saved" ? "success" : "error"}`}
          role="status"
        >
          {activeDocument?.notice !== "saved" && <CircleAlert size={13} />}
          {notice}
        </div>
      )}

      <div className="file-viewer-content">
        {!activeDocument || activeDocument.status === "loading" ? (
          <div className="file-viewer-loading">
            <LoaderCircle size={16} className="spin" />
            {t("chat.worktree.loading")}...
          </div>
        ) : activeDocument.status === "error" ? (
          <div className="file-viewer-error">
            <CircleAlert size={18} />
            {t("chat.worktree.errorLoading")}
          </div>
        ) : activeDocument.kind === "image" && activeDocument.imageUrl ? (
          <div className="file-viewer-image-container">
            <img
              src={activeDocument.imageUrl}
              alt={activeFileName}
              className="file-viewer-image"
            />
          </div>
        ) : activeDocument.kind === "binary" ? (
          <div className="file-viewer-binary">
            <FileCode2 size={36} />
            <div className="file-viewer-binary-text">
              {t("chat.worktree.binaryFile")}
            </div>
            <div className="file-viewer-binary-hint">
              {t("chat.worktree.binaryHint")}
            </div>
          </div>
        ) : (
          <>
            {activeDocument.truncated && (
              <div className="file-viewer-truncated">
                {t("chat.worktree.fileTruncatedWarning")}
              </div>
            )}
            <Suspense
              fallback={
                <div className="file-viewer-loading">
                  {t("chat.worktree.loading")}...
                </div>
              }
            >
              <CodeEditor
                value={activeDocument.draft}
                fileName={activeFileName}
                readOnly={activeDocument.mode === "view" || !canEdit}
                onChange={(draft) =>
                  updateDocument(activeFilePath, (current) => ({
                    ...current,
                    draft,
                    notice: undefined,
                  }))
                }
                onSave={() => void saveActiveFile()}
              />
            </Suspense>
          </>
        )}
      </div>
    </section>
  );
});
