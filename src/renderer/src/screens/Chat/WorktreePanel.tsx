import { useState, useEffect, useCallback, memo } from "react";
import { Folder, ChevronRight, ChevronDown } from "lucide-react";
import { getIconForFile, getSVGStringFromFileType } from "@wesbos/code-icons";
import { FileViewer } from "./FileViewer";
import { useI18n } from "../../components/useI18n";

interface FileEntry {
  name: string;
  isDirectory: boolean;
}

interface WorktreePanelProps {
  folderPath: string;
}

const MIN_PANEL_WIDTH = 220;
const DEFAULT_EDITOR_WIDTH = 760;
const WIDTH_STORAGE_KEY = "hermes:worktreePanelWidth";
const maxPanelWidth = (): number =>
  Math.max(MIN_PANEL_WIDTH, window.innerWidth - 360);

interface TreeItemProps {
  entry: FileEntry;
  parentPath: string;
  depth: number;
  activeFilePath?: string | null;
  onFileClick?: (filePath: string) => void;
}

function FileIcon({ filename }: { filename: string }): React.JSX.Element {
  const iconType = getIconForFile(filename);
  const iconData = iconType ? getSVGStringFromFileType(iconType) : null;
  const svgString =
    iconData && typeof iconData === "object" && "svg" in iconData
      ? iconData.svg
      : "";

  return (
    <div
      className="worktree-file-icon-wrapper"
      dangerouslySetInnerHTML={{ __html: svgString }}
    />
  );
}

function TreeItem({
  entry,
  parentPath,
  depth,
  activeFilePath,
  onFileClick,
}: TreeItemProps): React.JSX.Element {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fullPath = `${parentPath}/${entry.name}`;

  const loadChildren = useCallback(async () => {
    if (!entry.isDirectory || children !== null) return;
    setIsLoading(true);
    const result = await window.hermesAPI.readDirectory(fullPath);
    if (result) {
      // Sort: directories first, then files, both alphabetically
      const sorted = result.sort((a, b) => {
        if (a.isDirectory === b.isDirectory) {
          return a.name.localeCompare(b.name);
        }
        return a.isDirectory ? -1 : 1;
      });
      setChildren(sorted);
    }
    setIsLoading(false);
  }, [entry.isDirectory, fullPath, children]);

  const handleClick = (): void => {
    if (entry.isDirectory) {
      if (!isExpanded) {
        void loadChildren();
      }
      setIsExpanded(!isExpanded);
    } else {
      onFileClick?.(fullPath);
    }
  };

  const paddingLeft = 8 + depth * 12;

  return (
    <div className="worktree-item">
      <div
        className={`worktree-row ${!entry.isDirectory ? "worktree-row-file" : ""} ${fullPath === activeFilePath ? "active" : ""}`}
        onClick={handleClick}
        style={{ paddingLeft }}
        title={fullPath}
      >
        {entry.isDirectory ? (
          <>
            <span className="worktree-chevron">
              {isExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </span>
            <Folder size={14} className="worktree-icon worktree-folder-icon" />
          </>
        ) : (
          <>
            <span className="worktree-chevron-placeholder" />
            <FileIcon filename={entry.name} />
          </>
        )}
        <span className="worktree-name">{entry.name}</span>
      </div>
      {entry.isDirectory && isExpanded && (
        <div className="worktree-children">
          {isLoading ? (
            <div
              className="worktree-loading"
              style={{ paddingLeft: paddingLeft + 12 }}
            >
              {t("chat.worktree.loading")}...
            </div>
          ) : children === null ? null : children.length === 0 ? (
            <div
              className="worktree-empty"
              style={{ paddingLeft: paddingLeft + 12 }}
            >
              {t("chat.worktree.emptyFolder")}
            </div>
          ) : (
            children.map((child) => (
              <TreeItem
                key={`${fullPath}/${child.name}`}
                entry={child}
                parentPath={fullPath}
                depth={depth + 1}
                activeFilePath={activeFilePath}
                onFileClick={onFileClick}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// @lat: [[code-editor#Project code workspace#Docked explorer and tabs]]
export const WorktreePanel = memo(function WorktreePanel({
  folderPath,
}: WorktreePanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_PANEL_WIDTH ? saved : 240;
  });
  const [isResizing, setIsResizing] = useState(false);
  const errorLoadingText = t("chat.worktree.errorLoading");

  useEffect(() => {
    setOpenFiles([]);
    setActiveFilePath(null);
  }, [folderPath]);

  const openFile = useCallback((filePath: string): void => {
    setOpenFiles((current) =>
      current.includes(filePath) ? current : [...current, filePath],
    );
    setActiveFilePath(filePath);
    setWidth((current) =>
      Math.min(maxPanelWidth(), Math.max(current, DEFAULT_EDITOR_WIDTH)),
    );
  }, []);

  const closeFile = useCallback((filePath: string): void => {
    setOpenFiles((current) => {
      const closingIndex = current.indexOf(filePath);
      const next = current.filter((path) => path !== filePath);
      setActiveFilePath((activePath) => {
        if (activePath !== filePath) return activePath;
        if (next.length === 0) return null;
        return next[Math.min(Math.max(closingIndex, 0), next.length - 1)];
      });
      return next;
    });
  }, []);

  const startResize = (e: React.PointerEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const minWidth = activeFilePath ? 520 : MIN_PANEL_WIDTH;
    let nextWidth = startWidth;
    setIsResizing(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: PointerEvent): void => {
      // Panel sits on the right edge, so dragging the handle left widens it.
      const delta = startX - ev.clientX;
      nextWidth = Math.min(
        maxPanelWidth(),
        Math.max(minWidth, startWidth + delta),
      );
      setWidth(nextWidth);
    };
    const onUp = (): void => {
      setIsResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(nextWidth)));
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const loadRoot = async (): Promise<void> => {
      const result = await window.hermesAPI.readDirectory(folderPath);
      if (cancelled) return;
      if (result === null) {
        setError(errorLoadingText);
      } else {
        // Sort: directories first, then files, both alphabetically
        const sorted = result.sort((a, b) => {
          if (a.isDirectory === b.isDirectory) {
            return a.name.localeCompare(b.name);
          }
          return a.isDirectory ? -1 : 1;
        });
        setEntries(sorted);
      }
      setIsLoading(false);
    };

    void loadRoot();
    return () => {
      cancelled = true;
    };
  }, [errorLoadingText, folderPath]);

  // Get the folder name from the path
  const folderName =
    folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;

  const panelWidth = activeFilePath ? width : MIN_PANEL_WIDTH;

  return (
    <div
      className={`code-workspace-panel ${activeFilePath ? "has-editor" : "explorer-only"}`}
      style={{ width: panelWidth }}
    >
      <div
        className={`worktree-resize-handle ${
          isResizing ? "worktree-resize-handle-active" : ""
        }`}
        onPointerDown={startResize}
        title="Drag to resize"
      />
      <div className="worktree-panel">
        <div className="worktree-header">
          <Folder size={16} className="worktree-header-icon" />
          <span className="worktree-header-title" title={folderPath}>
            {folderName}
          </span>
        </div>
        <div className="worktree-content">
          {isLoading ? (
            <div className="worktree-loading">
              {t("chat.worktree.loading")}...
            </div>
          ) : error ? (
            <div className="worktree-error">{error}</div>
          ) : entries === null || entries.length === 0 ? (
            <div className="worktree-empty">{t("chat.worktree.empty")}</div>
          ) : (
            entries.map((entry) => (
              <TreeItem
                key={`${folderPath}/${entry.name}`}
                entry={entry}
                parentPath={folderPath}
                depth={0}
                activeFilePath={activeFilePath}
                onFileClick={openFile}
              />
            ))
          )}
        </div>
      </div>
      {activeFilePath && (
        <FileViewer
          files={openFiles}
          activeFilePath={activeFilePath}
          workspaceRoot={folderPath}
          onSelectFile={setActiveFilePath}
          onCloseFile={closeFile}
        />
      )}
    </div>
  );
});
