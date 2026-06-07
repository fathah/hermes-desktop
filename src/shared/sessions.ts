// Shared session IPC type — single source of truth for a session summary row.
// Producer: src/main/sessions.ts. Contract: src/preload/index.d.ts.

export interface SessionSummary {
  id: string;
  source: string;
  startedAt: number;
  endedAt: number | null;
  messageCount: number;
  model: string;
  title: string | null;
  preview: string;
}
