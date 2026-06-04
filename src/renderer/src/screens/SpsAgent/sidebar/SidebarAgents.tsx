// SidebarAgents.tsx — Hermes profiles surfaced as "Agents" (each profile is a
// separate ~/.hermes/profiles/{name} with its own gateway + session store).
// Clicking switches the active profile; "New agent" creates one. The section's
// "+" (in Sidebar.tsx) and this list share the same create flow.
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";

interface ProfileRow {
  name: string;
  isActive: boolean;
}

export function useAgents(): {
  profiles: ProfileRow[];
  refresh: () => void;
  activate: (name: string) => void;
} {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const flash = useStore((s) => s.flash);

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

  const activate = useCallback(
    (name: string) => {
      const api = window.hermesAPI;
      if (!api?.setActiveProfile) return;
      api
        .setActiveProfile(name)
        .then(() => {
          flash(`Switched to ${name}`);
          refresh();
        })
        .catch(() => flash("Could not switch agent"));
    },
    [flash, refresh],
  );

  return { profiles, refresh, activate };
}

export function SidebarAgents() {
  const { profiles, activate } = useAgents();

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
          onClick={() => activate(p.name)}
          title={p.name}
        >
          <Icon name="sparkle" size={17} />
          <span className="nav-label">{p.name}</span>
        </div>
      ))}
    </>
  );
}
