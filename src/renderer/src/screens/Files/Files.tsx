import { useState, useEffect } from "react";

interface FileEntry {
  name: string;
  isDir: boolean;
  path: string;
}

function Files(): React.JSX.Element {
  const [cwd, setCwd] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    window.hermesAPI.filesListDir("").then((list) => {
      if (list.length > 0) {
        setCwd(list[0].path.split("/").slice(0, -1).join("/") || list[0].path);
      }
    });
  }, []);

  useEffect(() => {
    if (!cwd) return;
    window.hermesAPI.filesListDir(cwd).then(setEntries);
  }, [cwd]);

  async function openFile(path: string): Promise<void> {
    const text = await window.hermesAPI.filesRead(path);
    setSelected(path);
    setContent(text);
    setDirty(false);
  }

  async function save(): Promise<void> {
    if (!selected) return;
    await window.hermesAPI.filesWrite(selected, content);
    setDirty(false);
  }

  return (
    <div className="files-screen">
      <header className="screen-header">
        <h1 className="screen-title">Files</h1>
        {selected && (
          <button className="btn-primary" disabled={!dirty} onClick={save}>Save</button>
        )}
      </header>
      <div className="files-split">
        <aside className="files-tree">
          {entries.map((e) => (
            <button key={e.path} className="files-entry" onClick={() => e.isDir ? setCwd(e.path) : openFile(e.path)}>
              {e.isDir ? "📁" : "📄"} {e.name}
            </button>
          ))}
        </aside>
        <div className="files-editor">
          {selected ? (
            <>
              <div className="files-path">{selected}</div>
              <textarea className="files-textarea" value={content} onChange={(e) => { setContent(e.target.value); setDirty(true); }} />
            </>
          ) : (
            <p className="empty-state">Select a file to edit</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default Files;
