import { Icon } from "../components/Icon";
import type {
  ReleaseAffordance,
  ReleaseAffordanceAction,
} from "../../../../../shared/update-affordances";
import { useWhatsNew } from "./useWhatsNew";

interface Props {
  onRunAction: (action: ReleaseAffordanceAction) => void;
}

export function WhatsNewPanel({
  onRunAction,
}: Props): React.JSX.Element | null {
  const { currentVersion, items, dismiss } = useWhatsNew();
  if (!currentVersion || items.length === 0) return null;

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
