import {
  Copy,
  FileText,
  Folder,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Star,
  Trash2,
} from "lucide-react";

interface WorkspaceFileNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: WorkspaceFileNode[];
}

interface WorkspacePageMeta {
  id: string;
  path: string;
  displayName: string;
  parentPath: string | null;
  favorite: boolean;
  trashed: boolean;
}

interface WorkspaceMetadata {
  pages: Record<string, WorkspacePageMeta>;
  favorites: string[];
}

interface WorkspaceTreeProps {
  nodes: WorkspaceFileNode[];
  metadata: WorkspaceMetadata | null;
  selectedPath: string;
  onSelect: (path: string) => void;
  onCreate: (parentPath?: string | null) => void;
  onRename: (path: string) => void;
  onDuplicate: (path: string) => void;
  onFavorite: (path: string, favorite: boolean) => void;
  onTrash: (path: string) => void;
  onRestore: (path: string) => void;
  onMove: (path: string, parentPath: string | null) => void;
}

function pageLabel(
  path: string,
  metadata: WorkspaceMetadata | null,
  fallback: string,
): string {
  return metadata?.pages[path]?.displayName || fallback;
}

function pathParent(path: string): string | null {
  const parts = path.split("/");
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join("/");
}

function WorkspaceTreeNode({
  node,
  metadata,
  selectedPath,
  onSelect,
  onCreate,
  onRename,
  onDuplicate,
  onFavorite,
  onTrash,
  onMove,
}: {
  node: WorkspaceFileNode;
  metadata: WorkspaceMetadata | null;
  selectedPath: string;
  onSelect: (path: string) => void;
  onCreate: (parentPath?: string | null) => void;
  onRename: (path: string) => void;
  onDuplicate: (path: string) => void;
  onFavorite: (path: string, favorite: boolean) => void;
  onTrash: (path: string) => void;
  onMove: (path: string, parentPath: string | null) => void;
}): React.JSX.Element {
  if (node.kind === "directory") {
    return (
      <div
        className="workspace-tree-group"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          const sourcePath = event.dataTransfer.getData("text/workspace-path");
          if (sourcePath) onMove(sourcePath, node.path);
        }}
      >
        <div className="workspace-tree-folder">
          <Folder size={14} />
          <span>{node.name}</span>
          <button
            type="button"
            aria-label={`New page in ${node.name}`}
            onClick={() => onCreate(node.path)}
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="workspace-tree-children">
          {(node.children ?? []).map((child) => (
            <WorkspaceTreeNode
              key={child.path}
              node={child}
              metadata={metadata}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onCreate={onCreate}
              onRename={onRename}
              onDuplicate={onDuplicate}
              onFavorite={onFavorite}
              onTrash={onTrash}
              onMove={onMove}
            />
          ))}
        </div>
      </div>
    );
  }

  const page = metadata?.pages[node.path];
  const favorite = page?.favorite ?? false;

  return (
    <div
      className="workspace-tree-row"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/workspace-path", node.path);
      }}
    >
      <button
        type="button"
        className={`workspace-tree-file${
          selectedPath === node.path ? " workspace-tree-file-active" : ""
        }`}
        onClick={() => onSelect(node.path)}
      >
        <FileText size={14} />
        <span>{pageLabel(node.path, metadata, node.name)}</span>
      </button>
      <div className="workspace-tree-actions">
        <button
          type="button"
          aria-label={favorite ? "Remove favorite" : "Add favorite"}
          onClick={() => onFavorite(node.path, !favorite)}
        >
          <Star size={13} fill={favorite ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          aria-label="Duplicate page"
          onClick={() => onDuplicate(node.path)}
        >
          <Copy size={13} />
        </button>
        <button
          type="button"
          aria-label="Rename page"
          onClick={() => onRename(node.path)}
        >
          <MoreHorizontal size={13} />
        </button>
        <button
          type="button"
          aria-label="Move to trash"
          onClick={() => onTrash(node.path)}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

export default function WorkspaceTree({
  nodes,
  metadata,
  selectedPath,
  onSelect,
  onCreate,
  onRename,
  onDuplicate,
  onFavorite,
  onTrash,
  onRestore,
  onMove,
}: WorkspaceTreeProps): React.JSX.Element {
  const favoritePages =
    metadata?.favorites
      .map((path) => metadata.pages[path])
      .filter((page): page is WorkspacePageMeta => Boolean(page)) ?? [];
  const trashPages =
    Object.values(metadata?.pages ?? {}).filter((page) => page.trashed) ?? [];

  return (
    <div className="workspace-tree" aria-label="Workspace pages">
      <section className="workspace-tree-section">
        <div className="workspace-section-heading">
          <span>Favorites</span>
        </div>
        {favoritePages.length === 0 ? (
          <div className="workspace-tree-empty">No favorites</div>
        ) : (
          favoritePages.map((page) => (
            <button
              key={page.id}
              type="button"
              className={`workspace-tree-file${
                selectedPath === page.path ? " workspace-tree-file-active" : ""
              }`}
              onClick={() => onSelect(page.path)}
            >
              <Star size={14} fill="currentColor" />
              <span>{page.displayName}</span>
            </button>
          ))
        )}
      </section>

      <section
        className="workspace-tree-section workspace-tree-root-drop"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          const sourcePath = event.dataTransfer.getData("text/workspace-path");
          if (sourcePath && pathParent(sourcePath) !== null)
            onMove(sourcePath, null);
        }}
      >
        <div className="workspace-section-heading">
          <span>Workspace</span>
          <button
            type="button"
            aria-label="New page"
            onClick={() => onCreate(null)}
          >
            <Plus size={14} />
          </button>
        </div>
        {nodes.map((node) => (
          <WorkspaceTreeNode
            key={node.path}
            node={node}
            metadata={metadata}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onCreate={onCreate}
            onRename={onRename}
            onDuplicate={onDuplicate}
            onFavorite={onFavorite}
            onTrash={onTrash}
            onMove={onMove}
          />
        ))}
      </section>

      {trashPages.length > 0 && (
        <section className="workspace-tree-section">
          <div className="workspace-section-heading">
            <span>Trash</span>
          </div>
          {trashPages.map((page) => (
            <div key={page.id} className="workspace-tree-row">
              <button
                type="button"
                className="workspace-tree-file workspace-tree-file-muted"
                onClick={() => onSelect(page.path)}
              >
                <Trash2 size={14} />
                <span>{page.displayName}</span>
              </button>
              <div className="workspace-tree-actions">
                <button
                  type="button"
                  aria-label="Restore page"
                  onClick={() => onRestore(page.path)}
                >
                  <RotateCcw size={13} />
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
