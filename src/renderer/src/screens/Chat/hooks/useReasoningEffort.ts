import { useCallback, useEffect, useRef, useState } from "react";

export type ReasoningEffort =
  | "auto"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "auto";

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return value === "auto" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
    ? value
    : DEFAULT_REASONING_EFFORT;
}

interface UseReasoningEffortResult {
  reasoningEffort: ReasoningEffort;
  setReasoningEffort: (next: ReasoningEffort) => Promise<void>;
}

export function useReasoningEffort(profile?: string): UseReasoningEffortResult {
  const [reasoningEffort, setReasoningEffortState] = useState<ReasoningEffort>(
    DEFAULT_REASONING_EFFORT,
  );
  const reasoningEffortRef = useRef<ReasoningEffort>(DEFAULT_REASONING_EFFORT);

  const revisionRef = useRef(0);
  const lifetimeRef = useRef({ active: false });
  useEffect(() => {
    const lifetime = { active: true };
    lifetimeRef.current = lifetime;
    const revision = ++revisionRef.current;
    reasoningEffortRef.current = DEFAULT_REASONING_EFFORT;
    setReasoningEffortState(DEFAULT_REASONING_EFFORT);
    window.hermesAPI
      .getConfig("agent.reasoning_effort", profile)
      .then((value) => {
        if (lifetime.active && revision === revisionRef.current) {
          const next = normalizeReasoningEffort(value);
          reasoningEffortRef.current = next;
          setReasoningEffortState(next);
        }
      })
      .catch(() => {
        if (lifetime.active && revision === revisionRef.current) {
          reasoningEffortRef.current = DEFAULT_REASONING_EFFORT;
          setReasoningEffortState(DEFAULT_REASONING_EFFORT);
        }
      });

    return (): void => {
      lifetime.active = false;
    };
  }, [profile]);

  const setReasoningEffort = useCallback(
    async (next: ReasoningEffort): Promise<void> => {
      const previous = reasoningEffortRef.current;
      const lifetime = lifetimeRef.current;
      const revision = ++revisionRef.current;
      reasoningEffortRef.current = next;
      setReasoningEffortState(next);

      try {
        await window.hermesAPI.setConfig(
          "agent.reasoning_effort",
          next,
          profile,
        );
      } catch (error) {
        if (lifetime.active && revision === revisionRef.current) {
          reasoningEffortRef.current = previous;
          setReasoningEffortState(previous);
        }
        throw error;
      }
    },
    [profile],
  );

  return { reasoningEffort, setReasoningEffort };
}
