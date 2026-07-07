import { Icon } from "../components/Icon";
import {
  isEngineUpdateAffordance,
  type ReleaseAffordanceAction,
  type WhatsNewAffordance,
} from "../../../../../shared/update-affordances";
import { useWhatsNew } from "./useWhatsNew";

interface Props {
  onRunAction: (action: ReleaseAffordanceAction) => void;
  variant?: "card" | "compact";
}

export function WhatsNewPanel({
  onRunAction,
  variant = "card",
}: Props): React.JSX.Element | null {
  const { currentVersion, items, dismiss } = useWhatsNew();
  if (!currentVersion || items.length === 0) return null;
  const engineCount = items.filter(isEngineUpdateAffordance).length;
  const releaseCount = items.length - engineCount;
  const title =
    engineCount > 0 && releaseCount > 0
      ? "What's new and available updates"
      : engineCount > 0
        ? "Hermes Agent update available"
        : `What's new in v${currentVersion}`;

  if (variant === "compact") {
    return (
      <section
        className="home-affordance-cluster home-affordance-updates"
        aria-label="What's new"
      >
        <span className="home-affordance-title">
          <Icon name="sparkle" size={14} />
          {title}
        </span>
        <div
          className="home-affordance-actions"
          aria-label="What's new actions"
        >
          {items.map((item: WhatsNewAffordance) => (
            <button
              key={item.id}
              type="button"
              className="home-affordance-action"
              title={item.title}
              onClick={() => onRunAction(item.action)}
            >
              {item.cta}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="home-affordance-dismiss"
          onClick={dismiss}
          aria-label="Dismiss what's new"
          title="Dismiss what's new"
        >
          <Icon name="x" size={14} />
        </button>
      </section>
    );
  }

  return (
    <section className="ob-checklist whats-new-panel" aria-label="What's new">
      <div className="ob-checklist-head">
        <span className="ob-checklist-title">{title}</span>
        <button
          type="button"
          className="ob-checklist-dismiss"
          onClick={dismiss}
          aria-label="Dismiss what's new"
          title="Dismiss what's new"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="ob-checklist-steps">
        {items.map((item: WhatsNewAffordance) => (
          <article key={item.id} className="ob-step-card">
            <div className="ob-step-body">
              {isEngineUpdateAffordance(item) && (
                <div className="ob-step-desc">
                  Available Hermes Agent update
                </div>
              )}
              <div className="ob-step-title">{item.title}</div>
              <div className="ob-step-desc">{item.body}</div>
            </div>
            <button
              type="button"
              className="ob-step-action"
              onClick={() => onRunAction(item.action)}
            >
              {item.cta}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
