import HomeSection from "./HomeSection";

interface WorkspacePreset {
  id: string;
  label: string;
  view: string;
  profile: string;
}

interface HomePresetsProps {
  presets: WorkspacePreset[];
  startupPresetId: string | null;
  onApplyPreset: (preset: WorkspacePreset) => void;
  onSetStartupPreset: (presetId: string | null) => void;
  onRenamePreset: (presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
}

export default function HomePresets({
  presets,
  startupPresetId,
  onApplyPreset,
  onSetStartupPreset,
  onRenamePreset,
  onDeletePreset,
}: HomePresetsProps): React.JSX.Element | null {
  if (presets.length === 0) return null;

  return (
    <HomeSection title="Presets">
      <div className="content-presets-row">
        {presets.map((preset) => (
          <div key={preset.id} className="content-launcher-card-wrap">
            <button className="content-preset-card" onClick={() => onApplyPreset(preset)}>
              <span className="content-pinned-card-kicker">Preset</span>
              <span className="content-pinned-card-title">{preset.label}</span>
              <span className="content-pinned-card-meta">
                {preset.profile} · {preset.view}
              </span>
            </button>
            <div className="content-preset-actions">
              <button
                className={`content-launcher-pin ${startupPresetId === preset.id ? "active" : ""}`}
                onClick={() => onSetStartupPreset(startupPresetId === preset.id ? null : preset.id)}
              >
                {startupPresetId === preset.id ? "Startup preset" : "Set startup"}
              </button>
              <button className="content-launcher-pin" onClick={() => onRenamePreset(preset.id)}>
                Rename
              </button>
              <button className="content-launcher-pin" onClick={() => onDeletePreset(preset.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </HomeSection>
  );
}
