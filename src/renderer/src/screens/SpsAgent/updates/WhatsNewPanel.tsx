import { Icon } from "../components/Icon";
import type {
  ReleaseAffordance,
  ReleaseAffordanceAction,
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

  if (variant === "compact") {
    return (
      <section
        className="home-affordance-cluster home-affordance-updates"
        aria-label="What's new"
      >
        <span className="home-affordance-title">
          <Icon name="sparkle" size={14} />
          What&apos;s new in v{currentVersion}
        </span>
        <div className="home-affordance-actions" aria-label="What's new actions">
          {items.map((item: ReleaseAffordance) => (
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
        <span className="ob-checklist-title">
          What&apos;s new in v{currentVersion}
        </span>
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
        {items.map((item: ReleaseAffordance) => (
          <article key={item.id} className="ob-step-card">
            <div className="ob-step-body">
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
