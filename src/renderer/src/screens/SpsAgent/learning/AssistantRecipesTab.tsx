import { useMemo, useState } from "react";
import {
  ASSISTANT_RECIPE_HIGH_RISK_ACTIONS,
  ASSISTANT_RECIPE_SCHEDULABLE_KINDS,
  ASSISTANT_RECIPE_TEMPLATES,
  type AssistantRecipe,
  type AssistantRecipeAction,
  type AssistantRecipeKind,
  type AssistantRecipeReviewMode,
  type AssistantRecipeRunRecord,
  type AssistantRecipeScheduleCadence,
  type AssistantRecipeTemplate,
} from "../../../../../shared/assistant-recipes";

const RECIPE_ACTION_LABELS: Record<AssistantRecipeAction, string> = {
  read_workspace: "Read workspace",
  search_web: "Search web",
  draft_content: "Draft content",
  propose_changes: "Propose changes",
  process_files: "Process files",
  schedule_runs: "Prepare scheduled runs",
  send_messages: "Send messages",
};

export function defaultFieldValues(
  template: AssistantRecipeTemplate,
): Record<string, string> {
  return Object.fromEntries(template.fields.map((field) => [field.key, ""]));
}

export function compileTemplateRecipe(
  template: AssistantRecipeTemplate,
  values: Record<string, string>,
): { job: string; inputs: string; output: string } {
  if (template.kind === "custom") {
    return {
      job: values.job?.trim() || template.defaultJob,
      inputs: values.inputs?.trim() || template.defaultInputs,
      output: values.output?.trim() || template.defaultOutput,
    };
  }
  const config = template.fields
    .map((field) => `- ${field.label}: ${values[field.key]?.trim() || "Any"}`)
    .join("\n");
  return {
    job: `${template.defaultJob}\n\nUser configuration:\n${config}`,
    inputs: `${template.defaultInputs}\n\nConfigured inputs:\n${config}`,
    output: `${template.defaultOutput}\n\nConfigured output preferences:\n${config}`,
  };
}

export function AssistantRecipesTab(props: {
  recipes: AssistantRecipe[];
  runs: AssistantRecipeRunRecord[];
  recipeKind: AssistantRecipeKind;
  recipeName: string;
  setRecipeName: (value: string) => void;
  recipeDescription: string;
  setRecipeDescription: (value: string) => void;
  recipeFieldValues: Record<string, string>;
  setRecipeFieldValue: (key: string, value: string) => void;
  recipeActions: AssistantRecipeAction[];
  recipeReviewMode: AssistantRecipeReviewMode;
  setRecipeReviewMode: (value: AssistantRecipeReviewMode) => void;
  recipeScheduleEnabled: boolean;
  setRecipeScheduleEnabled: (value: boolean) => void;
  recipeScheduleCadence: AssistantRecipeScheduleCadence;
  setRecipeScheduleCadence: (value: AssistantRecipeScheduleCadence) => void;
  recipeScheduleHour: number;
  setRecipeScheduleHour: (value: number) => void;
  recipeRunInput: string;
  setRecipeRunInput: (value: string) => void;
  recipeRunResult: string;
  canSaveRecipeResult: boolean;
  selectRecipeTemplate: (kind: AssistantRecipeKind) => void;
  toggleRecipeAction: (action: AssistantRecipeAction) => void;
  createRecipe: () => void;
  runRecipe: (recipe: AssistantRecipe) => void;
  saveRecipeResult: () => void;
  toggleRecipe: (recipe: AssistantRecipe) => void;
  deleteRecipe: (recipe: AssistantRecipe) => void;
  busy: string;
}): React.JSX.Element {
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const template =
    ASSISTANT_RECIPE_TEMPLATES.find((item) => item.kind === props.recipeKind) ||
    ASSISTANT_RECIPE_TEMPLATES[0];
  const safeToSchedule = ASSISTANT_RECIPE_SCHEDULABLE_KINDS.includes(
    props.recipeKind,
  );
  const hasHighRisk = props.recipeActions.some((action) =>
    ASSISTANT_RECIPE_HIGH_RISK_ACTIONS.includes(action),
  );
  const hasSendMessages = props.recipeActions.includes("send_messages");
  const canSchedule = safeToSchedule && !hasSendMessages;
  const canCreate =
    props.recipeName.trim() &&
    template.fields.every((field) =>
      props.recipeFieldValues[field.key]?.trim(),
    );
  const runsByRecipe = useMemo(() => {
    const grouped = new Map<string, AssistantRecipeRunRecord[]>();
    for (const run of props.runs) {
      const list = grouped.get(run.recipeId) || [];
      list.push(run);
      grouped.set(run.recipeId, list);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => b.createdAt - a.createdAt);
    }
    return grouped;
  }, [props.runs]);

  return (
    <>
      <section className="settings-section">
        <div className="settings-section-title">Build an Assistant</div>
        <div className="settings-field-hint learning-surface-hint">
          Pick a repeatable job, review what it can touch, then run it from
          here.
        </div>
        <label className="settings-label" htmlFor="assistant-template">
          Starting point
        </label>
        <select
          id="assistant-template"
          className="inbox-input"
          aria-label="Assistant template"
          value={props.recipeKind}
          onChange={(e) =>
            props.selectRecipeTemplate(e.target.value as AssistantRecipeKind)
          }
        >
          {ASSISTANT_RECIPE_TEMPLATES.map((item) => (
            <option key={item.kind} value={item.kind}>
              {item.title}
            </option>
          ))}
        </select>
        <input
          className="inbox-input"
          aria-label="Assistant name"
          placeholder="Assistant name"
          value={props.recipeName}
          onChange={(e) => props.setRecipeName(e.target.value)}
        />
        <input
          className="inbox-input"
          aria-label="Assistant description"
          placeholder="When should My Assistant use this?"
          value={props.recipeDescription}
          onChange={(e) => props.setRecipeDescription(e.target.value)}
        />
        {template.fields.map((field) =>
          (field.lines || 1) > 1 ? (
            <textarea
              key={field.key}
              className="memory-entry-textarea"
              aria-label={field.label}
              placeholder={field.placeholder}
              rows={field.lines}
              value={props.recipeFieldValues[field.key] || ""}
              onChange={(e) =>
                props.setRecipeFieldValue(field.key, e.target.value)
              }
            />
          ) : (
            <input
              key={field.key}
              className="inbox-input"
              aria-label={field.label}
              placeholder={field.placeholder}
              value={props.recipeFieldValues[field.key] || ""}
              onChange={(e) =>
                props.setRecipeFieldValue(field.key, e.target.value)
              }
            />
          ),
        )}
        <label className="settings-label" htmlFor="assistant-review-mode">
          Review mode
        </label>
        <select
          id="assistant-review-mode"
          className="inbox-input"
          aria-label="Assistant review mode"
          value={props.recipeReviewMode}
          onChange={(e) =>
            props.setRecipeReviewMode(
              e.target.value as AssistantRecipeReviewMode,
            )
          }
        >
          <option value="review-first">Review first</option>
          <option value="auto-apply" disabled={hasHighRisk}>
            Auto-apply safe changes
          </option>
        </select>
        <div className="you-rules-list learning-surface-list-mt">
          {(Object.keys(RECIPE_ACTION_LABELS) as AssistantRecipeAction[]).map(
            (action) => (
              <label key={action} className="memory-entry-card">
                <input
                  type="checkbox"
                  checked={props.recipeActions.includes(action)}
                  onChange={() => props.toggleRecipeAction(action)}
                />
                <span className="memory-entry-content">
                  {RECIPE_ACTION_LABELS[action]}
                </span>
              </label>
            ),
          )}
        </div>
        {hasHighRisk && (
          <div className="settings-field-hint learning-surface-hint">
            Risky actions stay review-first and cannot bypass approval.
          </div>
        )}
        <label className="memory-entry-card">
          <input
            type="checkbox"
            checked={props.recipeScheduleEnabled}
            disabled={!canSchedule}
            onChange={(e) => props.setRecipeScheduleEnabled(e.target.checked)}
          />
          <span className="memory-entry-content">
            Run on a schedule
            <small className="learning-surface-small-block">
              {canSchedule
                ? "Scheduled runs are queued for review."
                : "Scheduling is only available for safe templates that do not send messages."}
            </small>
          </span>
        </label>
        {props.recipeScheduleEnabled && canSchedule && (
          <div className="you-rules-list learning-surface-list-mt">
            <select
              className="inbox-input"
              aria-label="Assistant schedule cadence"
              value={props.recipeScheduleCadence}
              onChange={(e) =>
                props.setRecipeScheduleCadence(
                  e.target.value as AssistantRecipeScheduleCadence,
                )
              }
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <input
              className="inbox-input"
              aria-label="Assistant schedule hour"
              type="number"
              min={0}
              max={23}
              value={props.recipeScheduleHour}
              onChange={(e) =>
                props.setRecipeScheduleHour(Number(e.target.value))
              }
            />
          </div>
        )}
        <div className="memory-entry-form-actions">
          <button
            className="btn btn-primary btn-sm"
            disabled={!canCreate || props.busy === "create-recipe"}
            onClick={props.createRecipe}
          >
            Create assistant
          </button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Saved assistants</div>
        <textarea
          className="memory-entry-textarea"
          aria-label="Assistant run input"
          rows={2}
          placeholder="Optional instructions for the next run."
          value={props.recipeRunInput}
          onChange={(e) => props.setRecipeRunInput(e.target.value)}
        />
        {props.recipes.length === 0 ? (
          <div className="memory-empty learning-surface-empty-mt">
            No saved assistants yet.
          </div>
        ) : (
          <div className="you-rules-list learning-surface-list-mt">
            {props.recipes.map((recipe) => {
              const runs = runsByRecipe.get(recipe.id) || [];
              const latest = runs[0];
              const expanded = expandedHistory === recipe.id;
              return (
                <div key={recipe.id} className="memory-entry-card">
                  <span className="memory-entry-content">
                    <strong>{recipe.name}</strong>
                    <small className="learning-surface-small-block">
                      {recipe.description || recipe.job}
                    </small>
                    <small className="learning-surface-small-block">
                      {recipe.enabled ? "Enabled" : "Paused"} -{" "}
                      {recipe.reviewMode === "review-first"
                        ? "Review first"
                        : "Auto-apply safe changes"}
                    </small>
                    <small className="learning-surface-small-block">
                      {scheduleLabel(recipe)}
                    </small>
                    <small className="learning-surface-small-block">
                      {latest ? runLabel(latest) : "No runs yet"}
                    </small>
                    {runs.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() =>
                          setExpandedHistory(expanded ? null : recipe.id)
                        }
                      >
                        {expanded ? "Hide past runs" : "View past runs"}
                      </button>
                    )}
                    {expanded && (
                      <div className="you-rules-list learning-surface-list-mt">
                        {runs.slice(0, 5).map((run) => (
                          <small
                            key={run.id}
                            className="learning-surface-small-block"
                          >
                            {runLabel(run)}
                          </small>
                        ))}
                      </div>
                    )}
                  </span>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={
                      !recipe.enabled ||
                      props.busy === `run-recipe-${recipe.id}`
                    }
                    onClick={() => props.runRecipe(recipe)}
                  >
                    Run
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => props.toggleRecipe(recipe)}
                  >
                    {recipe.enabled ? "Pause" : "Enable"}
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete "${recipe.name}" from saved assistants?`,
                        )
                      ) {
                        props.deleteRecipe(recipe);
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {props.recipeRunResult && (
          <>
            <div className="memory-entry-form-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={
                  !props.canSaveRecipeResult ||
                  props.busy === "save-recipe-result"
                }
                onClick={props.saveRecipeResult}
              >
                Send to review
              </button>
            </div>
            <pre className="config-health-output learning-surface-pre-mt">
              {props.recipeRunResult}
            </pre>
          </>
        )}
      </section>
    </>
  );
}

function scheduleLabel(recipe: AssistantRecipe): string {
  if (!recipe.schedule?.enabled) return "No schedule";
  return `${recipe.schedule.cadence} at ${String(recipe.schedule.hour).padStart(2, "0")}:00`;
}

function runLabel(run: AssistantRecipeRunRecord): string {
  const status =
    run.status === "success"
      ? run.savedProposalId
        ? "saved"
        : "not saved"
      : "failed";
  return `${new Date(run.createdAt).toLocaleString()} - ${status}`;
}
