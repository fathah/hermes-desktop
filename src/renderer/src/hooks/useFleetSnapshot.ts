/** Phase 6B — Shared singleton FleetSnapshot hook.
 *  AgentsView and sidebar-footer share the SAME state and poller.
 *  refCount 0→1 starts polling, 1→0 stops.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import type { FleetSnapshot } from "../../../shared/types/fleet";
import { validateFleetSnapshot } from "../../../shared/types/fleet";

interface FleetState {
  snapshot: FleetSnapshot | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  lastFetchAt: number | null;
}

// Module-level singleton — shared across all consumers
let _refCount = 0;
let _pending = false;
let _timer: ReturnType<typeof setInterval> | null = null;
let _lastGood: FleetSnapshot | null = null;
const _listeners = new Set<(s: FleetState) => void>();
let _state: FleetState = { snapshot: null, loading: false, error: null, stale: false, lastFetchAt: null };

function _notify(): void {
  for (const fn of _listeners) fn({ ..._state });
}

async function _fetchOnce(): Promise<void> {
  if (_pending) return;
  _pending = true;
  try {
    const result = await window.hermesAPI.readFleetSnapshot();
    if (result.ok && result.snapshot) {
      const validated = validateFleetSnapshot(result.snapshot);
      if (validated) {
        _lastGood = validated;
        _state = { snapshot: validated, loading: false, error: null, stale: false, lastFetchAt: Date.now() };
      } else {
        _state = { ..._state, loading: false, error: "unsupported schema_version" };
      }
    } else {
      _state = { snapshot: _lastGood, loading: false, error: result.error || "snapshot read failed", stale: _lastGood !== null, lastFetchAt: _state.lastFetchAt };
    }
  } catch {
    _state = { snapshot: _lastGood, loading: false, error: "snapshot read failed", stale: _lastGood !== null, lastFetchAt: _state.lastFetchAt };
  } finally {
    _pending = false;
    _notify();
  }
}

function _start(): void {
  if (_timer) return;
  _state = { ..._state, loading: true };
  _notify();
  _fetchOnce();
  _timer = setInterval(_fetchOnce, 30_000);
}

function _stop(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

export function useFleetSnapshot(): FleetState & { refresh: () => void } {
  const [local, setLocal] = useState<FleetState>(_state);
  const mounted = useRef(true);

  useEffect(() => {
    const listener = (s: FleetState) => { if (mounted.current) setLocal(s); };
    _listeners.add(listener);
    _refCount++;
    if (_refCount === 1) _start();
    return () => {
      _listeners.delete(listener);
      _refCount--;
      if (_refCount === 0) _stop();
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    _state = { ..._state, loading: false };
    _notify();
    _fetchOnce();
  }, []);

  return { ...local, refresh };
}
