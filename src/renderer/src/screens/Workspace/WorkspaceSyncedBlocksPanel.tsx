import { useState } from "react";

interface WorkspaceSyncedBlock {
  id: string;
  sourcePath: string;
  sourceBlockId: string;
  content: string;
  references: Array<{ path: string; blockId: string }>;
  updatedAt: number;
}

interface WorkspaceSyncedBlocksPanelProps {
  blocks: WorkspaceSyncedBlock[];
  onCreate: (content: string) => void;
}

export default function WorkspaceSyncedBlocksPanel({
  blocks,
  onCreate,
}: WorkspaceSyncedBlocksPanelProps): React.JSX.Element {
  const [content, setContent] = useState("");
  return (
    <section className="workspace-synced-panel" aria-label="Synced blocks">
      <label>
        <span>Synced block content</span>
        <input
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={!content.trim()}
        onClick={() => {
          onCreate(content.trim());
          setContent("");
        }}
      >
        Create synced block
      </button>
      {blocks.map((block) => (
        <article key={block.id}>
          <strong>
            {block.sourcePath} -&gt; {block.references.length} reference
            {block.references.length === 1 ? "" : "s"}
          </strong>
          <small>{block.content}</small>
        </article>
      ))}
    </section>
  );
}
