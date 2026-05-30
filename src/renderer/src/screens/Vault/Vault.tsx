import { useState, useEffect, useCallback } from "react";
import { Plus, Trash, KeyRound } from "../../assets/icons";

interface SecretItem {
  id: string;
  provider: string;
  label: string;
  maskedValue: string;
}

function Vault({ profile }: { profile: string }): React.JSX.Element {
  const [secrets, setSecrets] = useState<SecretItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  const [provider, setProvider] = useState("openai");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await window.hermesAPI.vault.getCredentials(profile);
      if (Array.isArray(list)) {
        setSecrets(list);
        setLocked(false);
      } else {
        setError(list.error);
        setLocked(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLocked(true);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  async function unlock(): Promise<void> {
    setError("");
    const result = await window.hermesAPI.vault.initWithPassword(password);
    if (!result.success) {
      setError(result.error || "Unable to unlock vault");
      return;
    }
    setPassword("");
    await load();
  }

  async function handleAdd(): Promise<void> {
    if (!value.trim()) {
      setError("API key is required");
      return;
    }
    setError("");
    await window.hermesAPI.vault.addCredential(
      profile,
      provider,
      label || provider,
      value.trim(),
    );
    setShowAdd(false);
    setValue("");
    setLabel("");
    await load();
  }

  async function handleDelete(id: string): Promise<void> {
    const result = await window.hermesAPI.vault.deleteCredential(profile, id);
    if (!result.success) {
      setError(result.error || "Unable to delete credential");
      return;
    }
    await load();
  }

  if (loading) {
    return <div className="screen-loading">Loading vault…</div>;
  }

  if (locked) {
    return (
      <div className="vault-screen">
        <header className="screen-header">
          <div>
            <h1 className="screen-title">
              <KeyRound size={20} /> Encrypted Vault
            </h1>
            <p className="screen-subtitle">
              Unlock or initialize the local vault for <strong>{profile}</strong>
            </p>
          </div>
        </header>
        <div className="vault-add-form card">
          <label>
            Vault password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button className="btn-primary" onClick={unlock} disabled={password.length < 8}>
              Unlock vault
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="vault-screen">
      <header className="screen-header">
        <div>
          <h1 className="screen-title">
            <KeyRound size={20} /> Encrypted Vault
          </h1>
          <p className="screen-subtitle">
            Secrets for profile <strong>{profile}</strong> — encrypted at rest
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add credential
        </button>
      </header>

      {showAdd && (
        <div className="vault-add-form card">
          <label>
            Provider
            <input value={provider} onChange={(e) => setProvider(e.target.value)} />
          </label>
          <label>
            Label
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Optional" />
          </label>
          <label>
            API key
            <input type="password" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button className="btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleAdd}>Save encrypted</button>
          </div>
        </div>
      )}

      <div className="vault-list">
        {secrets.length === 0 ? (
          <p className="empty-state">No credentials stored yet.</p>
        ) : (
          secrets.map((s) => (
            <div key={s.id} className="vault-card card">
              <div>
                <div className="vault-card-provider">{s.provider}</div>
                <div className="vault-card-label">{s.label}</div>
                <div className="vault-card-masked">{s.maskedValue}</div>
              </div>
              <button className="btn-icon danger" onClick={() => handleDelete(s.id)} aria-label="Delete">
                <Trash size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default Vault;
