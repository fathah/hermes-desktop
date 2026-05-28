import { useState, useEffect, useRef } from "react";

interface MigrationProfile {
  name: string;
  keyCount: number;
  envPath: string;
}

interface MigrationWizardProps {
  onComplete: () => void;
  onSkip: () => void;
}

function MigrationWizard({ onComplete, onSkip }: MigrationWizardProps): React.JSX.Element | null {
  const [profiles, setProfiles] = useState<MigrationProfile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [migrating, setMigrating] = useState(false);
  const [results, setResults] = useState<Array<{ name: string; imported: boolean; vaultEntries: number; error?: string }> | null>(null);

  const onSkipRef = useRef(onSkip);
  onSkipRef.current = onSkip;

  useEffect(() => {
    let cancelled = false;
    window.hermesAPI.profileWizard.detectMigration().then((list) => {
      if (cancelled) return;
      if (list.length === 0) {
        onSkipRef.current();
        return;
      }
      setProfiles(list);
      setSelected(new Set(list.map((p) => p.name)));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function migrate(): Promise<void> {
    setMigrating(true);
    const res = await window.hermesAPI.profileWizard.migrateSecrets([...selected]);
    setResults(res);
    setMigrating(false);
  }

  if (profiles.length === 0) {
    return null;
  }

  return (
    <div className="migration-overlay">
      <div className="migration-modal card">
        <h2>Existing Hermes Profiles Detected</h2>
        <p>Found profiles with plaintext secrets. Migrate to encrypted vault?</p>

        <ul className="migration-list">
          {profiles.map((p) => (
            <li key={p.name}>
              <label>
                <input type="checkbox" checked={selected.has(p.name)} onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(p.name);
                  else next.delete(p.name);
                  setSelected(next);
                }} />
                {p.name} ({p.keyCount} keys)
              </label>
            </li>
          ))}
        </ul>

        {results && (
          <ul className="migration-results">
            {results.map((r) => (
              <li key={r.name}>
                {r.name}: {r.imported ? `✓ ${r.vaultEntries} encrypted` : `✗ ${r.error}`}
              </li>
            ))}
          </ul>
        )}

        <div className="form-actions">
          <button className="btn-secondary" onClick={onSkip}>Skip</button>
          {!results ? (
            <button className="btn-primary" disabled={migrating || selected.size === 0} onClick={migrate}>
              {migrating ? "Migrating…" : "Migrate Selected"}
            </button>
          ) : (
            <button className="btn-primary" onClick={onComplete}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}

export default MigrationWizard;
