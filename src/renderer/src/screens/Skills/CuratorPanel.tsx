// CuratorPanel.tsx — the Skills Curator dashboard (run/pause/resume the skill
// consolidation loop, pin/unpin, restore archived skills). Extracted verbatim
// from Schedules.tsx, where skill curation was surprisingly nested under cron
// jobs; it belongs with Skills. Self-contained: owns its own state + the curator
// IPC, takes only `profile`.
import { useState, useEffect, useCallback } from "react";
import { Refresh } from "../../assets/icons";

interface CuratorPanelProps {
  profile?: string;
}

export function CuratorPanel({
  profile,
}: CuratorPanelProps): React.JSX.Element {
  const [curatorStatus, setCuratorStatus] = useState("");
  const [curatorLoading, setCuratorLoading] = useState(false);
  const [curatorOutput, setCuratorOutput] = useState<string | null>(null);
  const [archivedSkills, setArchivedSkills] = useState<string[]>([]);
  const [skillToPin, setSkillToPin] = useState("");
  const [skillToUnpin, setSkillToUnpin] = useState("");
  const [curatorActioning, setCuratorActioning] = useState(false);

  const loadCuratorData = useCallback(async (): Promise<void> => {
    setCuratorLoading(true);
    try {
      const [status, archived] = await Promise.all([
        window.hermesAPI.getCuratorStatus(profile),
        window.hermesAPI.listArchivedSkills(profile),
      ]);
      setCuratorStatus(status);

      // Parse archived skills
      const parsed = archived
        .split("\n")
        .map((line) => line.trim())
        .filter(
          (line) =>
            line &&
            !line.toLowerCase().includes("archive") &&
            !line.includes(":") &&
            !line.includes("-"),
        );
      setArchivedSkills(parsed);
    } catch (err) {
      console.error("Failed to load curator status:", err);
    } finally {
      setCuratorLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    loadCuratorData();
  }, [loadCuratorData]);

  async function handleRunCurator(): Promise<void> {
    setCuratorActioning(true);
    setCuratorOutput(null);
    try {
      const res = await window.hermesAPI.runCuratorNow(profile);
      setCuratorOutput(
        res.output ||
          (res.success ? "Curator ran successfully" : "Failed to run curator"),
      );
      await loadCuratorData();
    } catch (err) {
      setCuratorOutput("Error: " + (err as Error).message);
    } finally {
      setCuratorActioning(false);
    }
  }

  async function handlePauseCurator(): Promise<void> {
    setCuratorActioning(true);
    setCuratorOutput(null);
    try {
      const res = await window.hermesAPI.pauseCurator(profile);
      setCuratorOutput(
        res.output ||
          (res.success ? "Curator paused" : "Failed to pause curator"),
      );
      await loadCuratorData();
    } catch (err) {
      setCuratorOutput("Error: " + (err as Error).message);
    } finally {
      setCuratorActioning(false);
    }
  }

  async function handleResumeCurator(): Promise<void> {
    setCuratorActioning(true);
    setCuratorOutput(null);
    try {
      const res = await window.hermesAPI.resumeCurator(profile);
      setCuratorOutput(
        res.output ||
          (res.success ? "Curator resumed" : "Failed to resume curator"),
      );
      await loadCuratorData();
    } catch (err) {
      setCuratorOutput("Error: " + (err as Error).message);
    } finally {
      setCuratorActioning(false);
    }
  }

  async function handlePinSkill(name: string): Promise<void> {
    if (!name.trim()) return;
    setCuratorActioning(true);
    setCuratorOutput(null);
    try {
      const res = await window.hermesAPI.pinSkill(name.trim(), profile);
      setCuratorOutput(
        res.output ||
          (res.success
            ? `Pinned skill ${name}`
            : `Failed to pin skill ${name}`),
      );
      setSkillToPin("");
      await loadCuratorData();
    } catch (err) {
      setCuratorOutput("Error: " + (err as Error).message);
    } finally {
      setCuratorActioning(false);
    }
  }

  async function handleUnpinSkill(name: string): Promise<void> {
    if (!name.trim()) return;
    setCuratorActioning(true);
    setCuratorOutput(null);
    try {
      const res = await window.hermesAPI.unpinSkill(name.trim(), profile);
      setCuratorOutput(
        res.output ||
          (res.success
            ? `Unpinned skill ${name}`
            : `Failed to unpin skill ${name}`),
      );
      setSkillToUnpin("");
      await loadCuratorData();
    } catch (err) {
      setCuratorOutput("Error: " + (err as Error).message);
    } finally {
      setCuratorActioning(false);
    }
  }

  async function handleRestoreSkill(name: string): Promise<void> {
    setCuratorActioning(true);
    setCuratorOutput(null);
    try {
      const res = await window.hermesAPI.restoreArchivedSkill(name, profile);
      setCuratorOutput(
        res.output ||
          (res.success
            ? `Restored skill ${name}`
            : `Failed to restore skill ${name}`),
      );
      await loadCuratorData();
    } catch (err) {
      setCuratorOutput("Error: " + (err as Error).message);
    } finally {
      setCuratorActioning(false);
    }
  }

  return (
    <div
      style={{
        marginTop: 40,
        borderTop: "1px solid var(--border)",
        paddingTop: 32,
      }}
    >
      <div className="schedules-header" style={{ marginBottom: 16 }}>
        <div>
          <h2 className="schedules-title">Skills Curator Dashboard</h2>
          <p className="schedules-subtitle">
            Control the autopoietic skill consolidation loop that archives
            redundant agent code.
          </p>
        </div>
        <div className="schedules-header-actions">
          <button
            className="btn btn-secondary"
            onClick={loadCuratorData}
            disabled={curatorLoading}
          >
            <Refresh size={14} />
            Refresh Status
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "24px",
        }}
      >
        {/* Status & Actions Card */}
        <div
          className="schedules-card"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            margin: 0,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                color: "var(--text-muted)",
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              Curator Status
            </div>
            {curatorLoading ? (
              <div
                className="settings-loading"
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <div
                  className="loading-spinner"
                  style={{
                    width: 14,
                    height: 14,
                    border: "2px solid rgba(127,127,127,0.2)",
                    borderTopColor: "var(--accent)",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                  }}
                />
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Loading...
                </span>
              </div>
            ) : (
              <pre
                style={{
                  background: "var(--bg-tertiary, rgba(127,127,127,0.06))",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: 12,
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  whiteSpace: "pre-wrap",
                  margin: 0,
                }}
              >
                {curatorStatus || "Curator is not active."}
              </pre>
            )}
          </div>

          <div
            className="schedules-card-actions"
            style={{
              justifyContent: "flex-start",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            <button
              className="btn btn-primary"
              onClick={handleRunCurator}
              disabled={curatorActioning}
            >
              Run Curator Now
            </button>
            <button
              className="btn btn-secondary"
              onClick={handlePauseCurator}
              disabled={curatorActioning}
            >
              Pause Curator
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleResumeCurator}
              disabled={curatorActioning}
            >
              Resume Curator
            </button>
          </div>
        </div>

        {/* Manage Skills Card */}
        <div
          className="schedules-card"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            margin: 0,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                color: "var(--text-muted)",
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              Pin / Unpin Skills
            </div>
            <div style={{ display: "flex", gap: "8px", marginBottom: 12 }}>
              <input
                className="input"
                type="text"
                placeholder="Skill name to pin (e.g. git-log)"
                value={skillToPin}
                onChange={(e) => setSkillToPin(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => handlePinSkill(skillToPin)}
                disabled={curatorActioning || !skillToPin}
              >
                Pin
              </button>
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <input
                className="input"
                type="text"
                placeholder="Skill name to unpin"
                value={skillToUnpin}
                onChange={(e) => setSkillToUnpin(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleUnpinSkill(skillToUnpin)}
                disabled={curatorActioning || !skillToUnpin}
              >
                Unpin
              </button>
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                color: "var(--text-muted)",
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              Archived Skills ({archivedSkills.length})
            </div>
            {archivedSkills.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                No archived skills found.
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  maxHeight: 140,
                  overflowY: "auto",
                }}
              >
                {archivedSkills.map((name) => (
                  <div
                    key={name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      background: "var(--bg-secondary)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: "4px 8px",
                    }}
                  >
                    <span
                      style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}
                    >
                      {name}
                    </span>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleRestoreSkill(name)}
                      disabled={curatorActioning}
                      style={{ padding: "2px 6px", fontSize: 11 }}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {curatorOutput && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              color: "var(--text-muted)",
              letterSpacing: 0.5,
              marginBottom: 8,
            }}
          >
            Curator Command Log
          </div>
          <pre
            style={{
              background: "var(--bg-tertiary, rgba(127,127,127,0.06))",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 12,
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              whiteSpace: "pre-wrap",
              maxHeight: 200,
              overflowY: "auto",
              margin: 0,
            }}
          >
            {curatorOutput}
          </pre>
        </div>
      )}
    </div>
  );
}
