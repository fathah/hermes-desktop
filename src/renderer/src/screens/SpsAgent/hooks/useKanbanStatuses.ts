// useKanbanStatuses.ts — one shared poller for the live Kanban status of every
// delegated task row on screen. A delegated row stores only `delegatedTo` (the
// Kanban id); the agent's real state lives in Kanban. Rather than one
// kanbanGetTask call per row (each spawns a Python CLI process), this fetches the
// whole board once per cycle and indexes id → status. Best-effort: when Kanban is
// unavailable (remote mode / CLI missing) the map stays empty and badges hide.
import { useCallback, useEffect, useState } from "react";

const POLL_MS = 30_000;

export interface KanbanStatuses {
  /** Live Kanban status for a delegated id, or undefined when unknown. */
  statusFor: (id: string | null | undefined) => string | undefined;
}

/**
 * Poll the Kanban board while at least one delegated id is on screen and expose
 * a lookup from delegated id → live status. When `kanbanIds` is empty no polling
 * happens at all (the common case: no AI-routed rows visible).
 */
export function useKanbanStatuses(kanbanIds: string[]): KanbanStatuses {
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  // Re-subscribe only when the *set* of delegated ids changes, not on every
  // render (the array identity churns upstream).
  const key = [...kanbanIds].sort().join(",");

  useEffect(() => {
    if (!key) {
      setStatuses({});
      return;
    }
    let cancelled = false;
    const load = async (): Promise<void> => {
      const api = window.hermesAPI;
      if (!api?.kanbanListTasks) return;
      try {
        const res = await api.kanbanListTasks();
        if (cancelled || !res?.success || !res.data) return;
        const next: Record<string, string> = {};
        for (const task of res.data) next[task.id] = task.status;
        setStatuses(next);
      } catch {
        /* Kanban unreachable — leave the prior map; badges degrade to hidden. */
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key]);

  const statusFor = useCallback(
    (id: string | null | undefined): string | undefined =>
      id ? statuses[id] : undefined,
    [statuses],
  );

  return { statusFor };
}
