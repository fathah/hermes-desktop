// SidebarAgents.tsx — Hermes profiles surfaced as "Agents" (each profile is a
// separate ~/.hermes/profiles/{name} with its own gateway + session store).
//
// The SPS workspace is single-profile by design: every surface operates on the
// "default" profile, so a silent in-rail profile *switch* here would lie (the
// workspace wouldn't actually change agents). Instead the list is read-only —
// it shows the active agent, and clicking opens the admin Agents screen, where
// profile management genuinely takes effect.
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { openSettings } from "../../../lib/openSettings";

interface ProfileRow {
  name: string;
  isActive: boolean;
}

export function useAgents(): {
  profiles: ProfileRow[];
  refresh: () => void;
} {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);

  const refresh = useCallback(() => {
    const api = window.hermesAPI;
    if (!api?.listProfiles) return;
    api
      .listProfiles()
      .then((rows) =>
        setProfiles(rows.map((r) => ({ name: r.name, isActive: r.isActive }))),
      )
      .catch(() => {
        /* no gateway — leave empty */
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { profiles, refresh };
}

export function SidebarAgents() {
  const { profiles } = useAgents();

  if (profiles.length === 0) {
    return (
      <div className="nav-item nav-empty">
        <Icon name="sparkle" size={17} />
        <span className="nav-label">No agents yet</span>
      </div>
    );
  }

  return (
    <>
      {profiles.map((p) => (
        <div
          key={p.name}
          className={`nav-item ${p.isActive ? "active" : ""}`}
          onClick={() => openSettings("agents")}
          title={`Manage agents (${p.name})`}
        >
          <Icon name="sparkle" size={17} />
          <span className="nav-label">{p.name}</span>
        </div>
      ))}
    </>
  );
}
