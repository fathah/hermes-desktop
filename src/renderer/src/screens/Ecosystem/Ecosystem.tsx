import { useState, useEffect } from "react";

const MEMORY_PROVIDERS = [
  { name: "Honcho", url: "https://app.honcho.dev" },
  { name: "Hindsight", url: "https://ui.hindsight.vectorize.io" },
  { name: "Mem0", url: "https://app.mem0.ai" },
];

const THEMES = ["Hermes", "Nous", "Bronze", "Slate", "Mono"];

function Ecosystem({ profile }: { profile: string }): React.JSX.Element {
  const [skillCount, setSkillCount] = useState(0);

  useEffect(() => {
    window.hermesAPI.listInstalledSkills(profile).then((s) => setSkillCount(s.length));
  }, [profile]);

  return (
    <div className="ecosystem-screen">
      <header className="screen-header">
        <h1 className="screen-title">Ecosystem Browser</h1>
        <p className="screen-subtitle">Discover skills, providers, and themes</p>
      </header>
      <section className="card">
        <h2>Skills</h2>
        <p>{skillCount} skills installed for this profile. Browse and manage in the Skills tab.</p>
      </section>
      <section className="card">
        <h2>Memory providers</h2>
        <ul>{MEMORY_PROVIDERS.map((p) => (
          <li key={p.name}><a href={p.url} onClick={(e) => { e.preventDefault(); window.hermesAPI.openExternal(p.url); }}>{p.name}</a></li>
        ))}</ul>
      </section>
      <section className="card">
        <h2>Themes</h2>
        <div className="theme-preview-grid">
          {THEMES.map((t) => (
            <div key={t} className="theme-preview">{t}</div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default Ecosystem;
