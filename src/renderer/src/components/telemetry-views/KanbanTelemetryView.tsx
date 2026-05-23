/**
 * Kanban tab in remote mode — read-only board + column card
 * counts driven by GET /v1/telemetry/kanban.
 *
 * Card *bodies* (which can contain user prompts and task
 * descriptions) are intentionally not returned by the backend —
 * only structural counts reach the renderer.
 */

import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import type { KanbanTelemetry } from "../../../../shared/telemetry-types";

function KanbanView({ data }: { data: KanbanTelemetry }): React.JSX.Element {
  if (data.boards.length === 0) {
    return (
      <div className="telemetry-summary">
        <h2 className="telemetry-summary-title">Kanban</h2>
        <p className="telemetry-summary-hint">
          No kanban boards configured on this Hermes instance.
        </p>
      </div>
    );
  }
  return (
    <div className="telemetry-summary">
      <h2 className="telemetry-summary-title">
        Kanban — {data.totalCards} card{data.totalCards === 1 ? "" : "s"} across{" "}
        {data.boards.length} board{data.boards.length === 1 ? "" : "s"}
      </h2>
      <ul className="telemetry-kanban-board-list">
        {data.boards.map((board) => (
          <li key={board.id}>
            <h3 className="telemetry-kanban-board-name">{board.name}</h3>
            {board.columns.length === 0 ? (
              <p className="telemetry-summary-hint">No columns yet.</p>
            ) : (
              <ul className="telemetry-kanban-column-list">
                {board.columns.map((col) => (
                  <li key={col.id}>
                    <span className="telemetry-kanban-column-name">
                      {col.name}
                    </span>
                    <span className="telemetry-kanban-column-count">
                      {col.cardCount}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <p className="telemetry-summary-hint">
        Read-only view. Card content lives on the server.
      </p>
    </div>
  );
}

function KanbanTelemetryView(): React.JSX.Element {
  const state = useTelemetryQuery<KanbanTelemetry>(
    "kanban",
    () => window.hermesAPI.telemetry.kanban(),
    [],
  );
  return (
    <TelemetryCard state={state} feature="Kanban">
      {(data) => <KanbanView data={data} />}
    </TelemetryCard>
  );
}

export default KanbanTelemetryView;
