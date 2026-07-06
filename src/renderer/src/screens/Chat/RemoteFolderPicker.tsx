import {
  ChevronLeft,
  ChevronRight,
  Folder,
  Loader,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "../../components/useI18n";

interface FileEntry {
  name: string;
  isDirectory: boolean;
}

interface RemoteFolderPickerProps {
  initialPath: string | null;
  open: boolean;
  onCancel: () => void;
  onSelect: (path: string) => void;
}

function joinPath(parent: string, child: string): string {
  if (!parent || parent === "/") return `/${child}`;
  return `${parent.replace(/\/+$/, "")}/${child}`;
}

function parentPath(path: string): string {
  const cleaned = path.replace(/\/+$/, "") || "/";
  if (cleaned === "/") return "/";
  const idx = cleaned.lastIndexOf("/");
  return idx <= 0 ? "/" : cleaned.slice(0, idx);
}

function pathParts(path: string): { label: string; path: string }[] {
  const cleaned = path.replace(/\/+$/, "") || "/";
  const parts = cleaned.split("/").filter(Boolean);
  const rows = [{ label: "/", path: "/" }];
  let current = "";

  for (const part of parts) {
    current = `${current}/${part}`;
    rows.push({ label: part, path: current });
  }

  return rows;
}

export const RemoteFolderPicker = memo(function RemoteFolderPicker({
  initialPath,
  open,
  onCancel,
  onSelect,
}: RemoteFolderPickerProps): React.JSX.Element | null {
  const { t } = useI18n();
  const [currentPath, setCurrentPath] = useState(initialPath || "/");
  const [pathInput, setPathInput] = useState(initialPath || "/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const directories = useMemo(
    () => entries.filter((entry) => entry.isDirectory),
    [entries],
  );

  const loadPath = useCallback(async (path: string) => {
    const nextPath = path.trim() || "/";
    setCurrentPath(nextPath);
    setPathInput(nextPath);
    setActiveIndex(0);
    setLoading(true);
    setError(null);

    const result = await window.hermesAPI.readDirectory(nextPath);
    if (result === null) {
      setEntries([]);
      setError(t("chat.folderPicker.unavailable"));
    } else {
      setEntries(result);
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    if (!open) return;
    void loadPath(initialPath || "/");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [initialPath, loadPath, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, open]);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(
      `[data-folder-index="${activeIndex}"]`,
    );
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  const openDirectory = (path: string): void => {
    void loadPath(path);
  };

  const handleListKeyDown = (event: React.KeyboardEvent): void => {
    if (directories.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((idx) => Math.min(directories.length - 1, idx + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((idx) => Math.max(0, idx - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(directories.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = directories[activeIndex];
      if (entry) openDirectory(joinPath(currentPath, entry.name));
    }
  };

  return (
    <div className="folder-picker-overlay" role="presentation">
      <div
        aria-label={t("chat.folderPicker.title")}
        aria-modal="true"
        className="folder-picker-modal"
        role="dialog"
      >
        <div className="folder-picker-header">
          <div className="folder-picker-title">
            <Folder size={16} />
            <span>{t("chat.folderPicker.title")}</span>
          </div>
          <button
            aria-label={t("common.cancel")}
            className="folder-picker-icon-btn"
            onClick={onCancel}
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <form
          className="folder-picker-path-row"
          onSubmit={(event) => {
            event.preventDefault();
            void loadPath(pathInput);
          }}
        >
          <button
            aria-label={t("chat.folderPicker.parent")}
            className="folder-picker-icon-btn"
            disabled={currentPath === "/"}
            onClick={() => openDirectory(parentPath(currentPath))}
            type="button"
          >
            <ChevronLeft size={16} />
          </button>
          <input
            ref={inputRef}
            className="folder-picker-input"
            onChange={(event) => setPathInput(event.target.value)}
            value={pathInput}
          />
          <button className="btn btn-sm" type="submit">
            {t("chat.folderPicker.open")}
          </button>
        </form>

        <div className="folder-picker-breadcrumbs" aria-label="Breadcrumb">
          {pathParts(currentPath).map((part, index) => (
            <button
              className="folder-picker-crumb"
              key={part.path}
              onClick={() => openDirectory(part.path)}
              title={part.path}
              type="button"
            >
              {index > 0 && <ChevronRight size={12} />}
              <span>{part.label}</span>
            </button>
          ))}
        </div>

        <div
          className="folder-picker-list"
          onKeyDown={handleListKeyDown}
          ref={listRef}
          role="listbox"
          tabIndex={0}
        >
          {loading ? (
            <div className="folder-picker-state">
              <Loader className="folder-picker-loader" size={18} />
              <span>{t("chat.worktree.loading")}</span>
            </div>
          ) : error ? (
            <div className="folder-picker-state">{error}</div>
          ) : directories.length === 0 ? (
            <div className="folder-picker-state">
              {t("chat.folderPicker.empty")}
            </div>
          ) : (
            directories.map((entry, index) => {
              const fullPath = joinPath(currentPath, entry.name);
              return (
                <button
                  aria-selected={activeIndex === index}
                  className={`folder-picker-row${
                    activeIndex === index ? " folder-picker-row-active" : ""
                  }`}
                  data-folder-index={index}
                  key={fullPath}
                  onClick={() => openDirectory(fullPath)}
                  onFocus={() => setActiveIndex(index)}
                  role="option"
                  title={fullPath}
                  type="button"
                >
                  <Folder size={15} />
                  <span>{entry.name}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="folder-picker-footer">
          <button className="btn-ghost btn-sm" onClick={onCancel} type="button">
            {t("common.cancel")}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onSelect(pathInput.trim() || currentPath)}
            type="button"
          >
            {t("chat.folderPicker.select")}
          </button>
        </div>
      </div>
    </div>
  );
});
