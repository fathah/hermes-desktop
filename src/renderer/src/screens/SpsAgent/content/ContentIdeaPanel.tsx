import type {
  ContentStudioPlaybook,
  ContentStudioRubric,
} from "../../../../../shared/content-studio";

interface Props {
  playbooks: ContentStudioPlaybook[];
  selectedPlaybookId: string;
  onSelectPlaybook: (id: string) => void;
  ideaTitle: string;
  sourceUrl: string;
  audience: string;
  angle: string;
  rubric: ContentStudioRubric;
  overrideLowScore: boolean;
  scoreText: string;
  runMessage: string;
  variantMessage: string;
  lastAssistantRunId: string;
  onIdeaTitleChange: (value: string) => void;
  onSourceUrlChange: (value: string) => void;
  onAudienceChange: (value: string) => void;
  onAngleChange: (value: string) => void;
  onRubricChange: (key: keyof ContentStudioRubric, value: string) => void;
  onOverrideChange: (checked: boolean) => void;
  onScoreIdea: () => void;
  onStartRun: () => void;
  onGenerateVariants: () => void;
  onSaveAssistantResult: () => void;
}

const RUBRIC_LABELS: Array<[keyof ContentStudioRubric, string]> = [
  ["bookmarkability", "Bookmarkable"],
  ["proof", "Hard proof"],
  ["immediateUse", "Useful now"],
  ["audienceClarity", "Audience clear"],
  ["reproducibility", "Can follow it"],
  ["hookStrength", "Strong hook"],
  ["originality", "Original value"],
];

export function ContentIdeaPanel(props: Props): React.JSX.Element {
  return (
    <section className="active-work-section" id="content-studio-panel-ideas">
      <h2>Score Idea</h2>
      <label className="content-studio-field">
        <span>Creator playbook</span>
        <select
          aria-label="Creator playbook"
          className="inbox-input"
          value={props.selectedPlaybookId}
          onChange={(event) => props.onSelectPlaybook(event.target.value)}
        >
          <option value="">No playbook</option>
          {props.playbooks.map((playbook) => (
            <option key={playbook.id} value={playbook.id}>
              {playbook.title}
            </option>
          ))}
        </select>
      </label>
      <div className="content-studio-grid">
        <label>
          <span>Idea title</span>
          <input
            aria-label="Idea title"
            className="inbox-input"
            value={props.ideaTitle}
            onChange={(event) => props.onIdeaTitleChange(event.target.value)}
            placeholder="Agent-Reach setup without API-key hype"
          />
        </label>
        <label>
          <span>Source URL</span>
          <input
            aria-label="Source URL"
            className="inbox-input"
            value={props.sourceUrl}
            onChange={(event) => props.onSourceUrlChange(event.target.value)}
            placeholder="https://example.com/source"
          />
        </label>
        <label>
          <span>Audience</span>
          <input
            aria-label="Audience"
            className="inbox-input"
            value={props.audience}
            onChange={(event) => props.onAudienceChange(event.target.value)}
            placeholder="Who should save this?"
          />
        </label>
        <label>
          <span>Angle</span>
          <input
            aria-label="Angle"
            className="inbox-input"
            value={props.angle}
            onChange={(event) => props.onAngleChange(event.target.value)}
            placeholder="What original value does this add?"
          />
        </label>
      </div>
      <div className="content-studio-rubric">
        {RUBRIC_LABELS.map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              aria-label={label}
              type="number"
              min={0}
              max={2}
              className="inbox-input"
              value={props.rubric[key]}
              onChange={(event) =>
                props.onRubricChange(key, event.target.value)
              }
            />
          </label>
        ))}
      </div>
      <label className="memory-entry-card">
        <input
          type="checkbox"
          aria-label="Override low score"
          checked={props.overrideLowScore}
          onChange={(event) => props.onOverrideChange(event.target.checked)}
        />
        <span className="memory-entry-content">
          Override low score
          <small className="learning-surface-small-block">
            Use only when a strategic reason beats the rubric.
          </small>
        </span>
      </label>
      <div className="memory-entry-form-actions">
        <button
          className="btn btn-secondary btn-sm"
          onClick={props.onScoreIdea}
        >
          Score idea
        </button>
        <button className="btn btn-primary btn-sm" onClick={props.onStartRun}>
          Start content run
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={props.onGenerateVariants}
        >
          Generate variants
        </button>
        <button
          className="btn btn-secondary btn-sm"
          disabled={!props.lastAssistantRunId}
          onClick={props.onSaveAssistantResult}
        >
          Save assistant result to Review Queue
        </button>
      </div>
      <div className="content-studio-score">{props.scoreText}</div>
      {props.runMessage && (
        <div className="active-work-error">{props.runMessage}</div>
      )}
      {props.variantMessage && (
        <div className="content-studio-quality">{props.variantMessage}</div>
      )}
    </section>
  );
}
