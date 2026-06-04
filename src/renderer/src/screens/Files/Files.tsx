import { useState, useEffect } from "react";

interface FileEntry {
  name: string;
  isDir: boolean;
  path: string;
  error?: string;
}

function Files(): React.JSX.Element {
  const [rootInput, setRootInput] = useState("");
  const [root, setRoot] = useState<string | null>(null);
  const [cwd, setCwd] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    window.hermesAPI.filesGetWorkspaceRoot().then((res) => {
      if (res.success && res.data?.root) {
        setRoot(res.data.root);
        setRootInput(res.data.root);
        setCwd(res.data.root);
      } else if (res.error) {
        setError(res.error);
      }
    });
  }, []);

  useEffect(() => {
    if (!cwd) return;
    window.hermesAPI.filesListDir(cwd).then((res) => {
      if (!res.success || !res.data) {
        setError(res.error || "Unable to list folder");
        setEntries([]);
        return;
      }
      setError("");
      setRoot(res.data.root);
      setCwd(res.data.cwd || "");
      setEntries(res.data.entries);
    });
  }, [cwd]);

  async function openFile(path: string): Promise<void> {
    const res = await window.hermesAPI.filesRead(path);
    if (!res.success || !res.data) {
      setError(res.error || "Unable to open file");
      return;
    }
    setSelected(path);
    setContent(res.data.text);
    setDirty(false);
    setError("");
  }

  async function save(): Promise<void> {
    if (!selected) return;
    const res = await window.hermesAPI.filesWrite(selected, content);
    if (!res.success) {
      setError(res.error || "Unable to save file");
      return;
    }
    setDirty(false);
    setError("");
  }

  async function setWorkspaceRoot(): Promise<void> {
    const res = await window.hermesAPI.filesSetWorkspaceRoot(rootInput);
    if (!res.success || !res.data) {
      setError(res.error || "Unable to use workspace folder");
      return;
    }
    setRoot(res.data.root);
    setCwd(res.data.root);
    setSelected(null);
    setContent("");
    setDirty(false);
    setError("");
  }

  return (
    <div className="files-screen">
      <header className="screen-header">
        <h1 className="screen-title">Files</h1>
        <div className="files-root-picker">
          <input
            className="input"
            value={rootInput}
            onChange={(e) => setRootInput(e.target.value)}
            placeholder="Workspace root"
          />
          <button className="btn btn-secondary btn-sm" onClick={setWorkspaceRoot}>Use</button>
          {selected && (
            <button className="btn btn-primary btn-sm" disabled={!dirty} onClick={save}>Save</button>
          )}
        </div>
      </header>
      {error && <div className="files-error">{error}</div>}
      <div className="files-split">
        <aside className="files-tree">
          {root && cwd !== root && (
            <button className="files-entry" onClick={() => setCwd(root)}>Workspace root</button>
          )}
          {entries.map((e) => (
            <button
              key={e.path}
              className="files-entry"
              disabled={!!e.error}
              onClick={() => e.isDir ? setCwd(e.path) : openFile(e.path)}
              title={e.error}
            >
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
