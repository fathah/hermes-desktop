// persistence.ts — swappable persistence layer.
//
// PersistenceAdapter is the contract. LocalAdapter (default) ports store.jsx's
// localStorage behaviour. A RemoteAdapter (REST: documents/blocks/comments) drops
// in behind the same interface later — see README "Persistence & multiplayer".
//
// Multiplayer/presence seam: replace the docs blocks with a Yjs document + a
// network provider; the adapter boundary is where that wiring lands without the
// UI knowing.
import type { Workspace } from "../types";

export interface PersistenceAdapter {
  load(): Workspace | null;
  save(ws: Workspace): void;
  clear(): void;
}

const WS_KEY = "sps-agent-ws-v3";

export class LocalAdapter implements PersistenceAdapter {
  private key: string;
  constructor(key: string = WS_KEY) {
    this.key = key;
  }

  load(): Workspace | null {
    try {
      const r = localStorage.getItem(this.key);
      if (r) return JSON.parse(r) as Workspace;
    } catch {
      /* ignore corrupt/blocked storage */
    }
    return null;
  }

  save(ws: Workspace): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(ws));
    } catch {
      /* quota / private mode — fail silent like the prototype */
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }
}

/** The active adapter. Swap here (or via env) to point at a remote backend. */
export const persistence: PersistenceAdapter = new LocalAdapter();
