import { useState, useEffect, useRef, memo } from "react";
import { X, FileCode, ExternalLink } from "lucide-react";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import { useI18n } from "../../components/useI18n";

interface FileViewerProps {
  filePath: string;
  onClose: () => void;
}

// Map file extensions to highlight.js language names
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  jsx: "javascript",
  tsx: "typescript",
  json: "json",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  py: "python",
  php: "php",
  java: "java",
  go: "go",
  rs: "rust",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  swift: "swift",
  kt: "kotlin",
  dart: "dart",
  lua: "lua",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  conf: "ini",
  config: "ini",
  xml: "xml",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  txt: "plaintext",
  log: "plaintext",
  vue: "javascript",
  svelte: "javascript",
  dockerfile: "dockerfile",
  rb: "ruby",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  scala: "scala",
  r: "r",
  m: "objectivec",
  mm: "objectivec",
  pl: "perl",
  pm: "perl",
  groovy: "groovy",
  gradle: "groovy",
  tf: "hcl",
  hcl: "hcl",
};

function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

function getLanguage(filename: string): string | undefined {
  const ext = getFileExtension(filename);
  return EXTENSION_TO_LANGUAGE[ext];
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function formatFileSize(content: string): string {
  const bytes = new Blob([content]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Image extensions that can be previewed
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

// Binary/non-text file extensions that can't be displayed
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

function isImageFile(filename: string): boolean {
  return VIEWABLE_IMAGE_EXTENSIONS.has(getFileExtension(filename));
}

function isBinaryFile(filename: string): boolean {
  return BINARY_EXTENSIONS.has(getFileExtension(filename));
}

export const FileViewer = memo(function FileViewer({
  filePath,
  onClose,
}: FileViewerProps): React.JSX.Element {
  const { t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const codeRef = useRef<HTMLElement>(null);

  const fileName = getFileName(filePath);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setImageUrl(null);

    const loadFile = async (): Promise<void> => {
      // If image file, load as data URL
      if (isImageFile(filePath)) {
        const imageData = await window.hermesAPI.readImageFile(filePath);
        if (cancelled) return;
        if (imageData === null) {
          setError(t("worktree.errorLoading"));
        } else {
          setImageUrl(imageData);
        }
        setIsLoading(false);
        return;
      }

      // Otherwise load as text
      const result = await window.hermesAPI.readFile(filePath, 102400);
      if (cancelled) return;
      if (result === null) {
        setError(t("worktree.errorLoading"));
      } else {
        setContent(result.content);
        setTruncated(result.truncated);
      }
      setIsLoading(false);
    };

    void loadFile();
    return () => {
      cancelled = true;
    };
  }, [filePath, t]);

  // Apply syntax highlighting after content loads
  useEffect(() => {
    if (content && codeRef.current) {
      const detectedLang = getLanguage(fileName);
      if (detectedLang) {
        codeRef.current.className = `hljs language-${detectedLang}`;
        hljs.highlightElement(codeRef.current);
      }
    }
  }, [content, fileName]);

  // Handle Escape key to close file viewer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="file-viewer-overlay" onClick={onClose}>
      <div className="file-viewer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="file-viewer-header">
          <div className="file-viewer-title">
            <FileCode size={16} className="file-viewer-icon" />
            <span className="file-viewer-filename" title={filePath}>
              {fileName}
            </span>
            {(content || imageUrl) && (
              <span className="file-viewer-size">
                {content ? formatFileSize(content) : imageUrl ? "Image" : ""}
                {truncated && content && ` (${t("worktree.fileTruncated")})`}
              </span>
            )}
          </div>
          <div className="file-viewer-actions">
            <button
              className="btn-ghost file-viewer-open"
              onClick={() => window.hermesAPI.openFileInEditor(filePath)}
              title={t("worktree.openInEditor")}
            >
              <ExternalLink size={14} />
              <span className="file-viewer-open-text">Open</span>
            </button>
            <button
              className="btn-ghost file-viewer-close"
              onClick={onClose}
              title={t("worktree.closeFile")}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="file-viewer-content">
          {isLoading ? (
            <div className="file-viewer-loading">
              {t("worktree.loading")}...
            </div>
          ) : error ? (
            <div className="file-viewer-error">{error}</div>
          ) : imageUrl ? (
            <div className="file-viewer-image-container">
              <img
                src={imageUrl}
                alt={fileName}
                className="file-viewer-image"
              />
            </div>
          ) : content === null ? (
            <div className="file-viewer-error">
              {t("worktree.errorLoading")}
            </div>
          ) : isBinaryFile(fileName) ? (
            <div className="file-viewer-binary">
              <div className="file-viewer-binary-icon">📄</div>
              <div className="file-viewer-binary-text">
                Binary file cannot be previewed
              </div>
              <div className="file-viewer-binary-hint">
                Click Open to view in default application
              </div>
            </div>
          ) : (
            <>
              {truncated && (
                <div className="file-viewer-truncated">
                  {t("worktree.fileTruncatedWarning")}
                </div>
              )}
              <pre className="file-viewer-code">
                <code ref={codeRef as React.RefObject<HTMLElement>}>
                  {content}
                </code>
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
