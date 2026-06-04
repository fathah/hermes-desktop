import { useState, useEffect, useCallback, memo } from "react";
import { Folder, ChevronRight, ChevronDown } from "lucide-react";
import { getIconForFile, getSVGStringFromFileType } from "@wesbos/code-icons";
import { FileViewer } from "./FileViewer";

interface FileEntry {
  name: string;
  isDirectory: boolean;
}

interface WorktreePanelProps {
  folderPath: string;
}

interface TreeItemProps {
  entry: FileEntry;
  parentPath: string;
  depth: number;
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
  onFileClick,
}: TreeItemProps): React.JSX.Element {
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
        className={`worktree-row ${!entry.isDirectory ? "worktree-row-file" : ""}`}
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
              Loading...
            </div>
          ) : children === null ? null : children.length === 0 ? (
            <div
              className="worktree-empty"
              style={{ paddingLeft: paddingLeft + 12 }}
            >
              Empty folder
            </div>
          ) : (
            children.map((child) => (
              <TreeItem
                key={`${fullPath}/${child.name}`}
                entry={child}
                parentPath={fullPath}
                depth={depth + 1}
                onFileClick={onFileClick}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export const WorktreePanel = memo(function WorktreePanel({
  folderPath,
}: WorktreePanelProps): React.JSX.Element {
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const loadRoot = async (): Promise<void> => {
      const result = await window.hermesAPI.readDirectory(folderPath);
      if (cancelled) return;
      if (result === null) {
        setError("Failed to load folder contents");
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
  }, [folderPath]);

  // Get the folder name from the path
  const folderName =
    folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;

  return (
    <div className="worktree-panel">
      <div className="worktree-header">
        <Folder size={16} className="worktree-header-icon" />
        <span className="worktree-header-title" title={folderPath}>
          {folderName}
        </span>
      </div>
      <div className="worktree-content">
        {isLoading ? (
          <div className="worktree-loading">Loading...</div>
        ) : error ? (
          <div className="worktree-error">{error}</div>
        ) : entries === null || entries.length === 0 ? (
          <div className="worktree-empty">Folder is empty</div>
        ) : (
          entries.map((entry) => (
            <TreeItem
              key={`${folderPath}/${entry.name}`}
              entry={entry}
              parentPath={folderPath}
              depth={0}
              onFileClick={setSelectedFile}
            />
          ))
        )}
      </div>
      {selectedFile && (
        <FileViewer
          filePath={selectedFile}
          onClose={() => setSelectedFile(null)}
        />
      )}
    </div>
  );
});
