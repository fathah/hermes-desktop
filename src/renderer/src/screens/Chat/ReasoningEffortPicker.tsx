import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Brain, ChevronDown, HelpCircle } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { ReasoningEffort } from "./hooks/useReasoningEffort";

interface ReasoningEffortPickerProps {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void | Promise<void>;
}

const OPTIONS: Array<{
  value: ReasoningEffort;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    value: "auto",
    labelKey: "chat.reasoningEffort.auto",
    descriptionKey: "chat.reasoningEffort.autoDescription",
  },
  {
    value: "minimal",
    labelKey: "chat.reasoningEffort.minimal",
    descriptionKey: "chat.reasoningEffort.minimalDescription",
  },
  {
    value: "low",
    labelKey: "chat.reasoningEffort.low",
    descriptionKey: "chat.reasoningEffort.lowDescription",
  },
  {
    value: "medium",
    labelKey: "chat.reasoningEffort.medium",
    descriptionKey: "chat.reasoningEffort.mediumDescription",
  },
  {
    value: "high",
    labelKey: "chat.reasoningEffort.high",
    descriptionKey: "chat.reasoningEffort.highDescription",
  },
  {
    value: "xhigh",
    labelKey: "chat.reasoningEffort.xhigh",
    descriptionKey: "chat.reasoningEffort.xhighDescription",
  },
];

export const ReasoningEffortPicker = memo(function ReasoningEffortPicker({
  value,
  onChange,
}: ReasoningEffortPickerProps): React.JSX.Element {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const selectedIndex = useMemo(() => {
    const idx = OPTIONS.findIndex((option) => option.value === value);
    return idx === -1 ? 0 : idx;
  }, [value]);
  const selected = OPTIONS[selectedIndex];
  // 0..1 position of the knob along the Faster→Smarter rail.
  const fraction =
    OPTIONS.length > 1 ? selectedIndex / (OPTIONS.length - 1) : 0;

  // Last index we applied — dedupes the flood of identical commits a drag emits
  // (and the click that follows a pointer release) so `onChange` fires once per
  // real change, not once per pixel.
  const lastIndexRef = useRef(selectedIndex);
  useEffect(() => {
    lastIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Stays open after a change — the user dismisses it themselves (click-away or
  // Escape), so they can nudge the level a few times without it vanishing.
  async function select(next: ReasoningEffort): Promise<void> {
    try {
      await onChange(next);
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }

  function commit(index: number): void {
    const clamped = Math.min(OPTIONS.length - 1, Math.max(0, index));
    if (clamped === lastIndexRef.current) return;
    lastIndexRef.current = clamped;
    void select(OPTIONS[clamped].value);
  }

  // Map a pointer x to the nearest stop. The rail spans between the first and
  // last dot centres, each 9px in from the track edge (stops are 18px wide).
  function indexFromClientX(clientX: number): number {
    const track = trackRef.current;
    if (!track) return selectedIndex;
    const rect = track.getBoundingClientRect();
    const span = Math.max(1, rect.width - 18);
    const frac = Math.min(1, Math.max(0, (clientX - (rect.left + 9)) / span));
    return Math.round(frac * (OPTIONS.length - 1));
  }

  function handleTrackPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return;
    e.preventDefault();
    trackRef.current?.focus();
    commit(indexFromClientX(e.clientX));
    const onMove = (ev: PointerEvent): void =>
      commit(indexFromClientX(ev.clientX));
    const onUp = (): void => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  function handleTrackKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    let next: number;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown")
      next = selectedIndex - 1;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp")
      next = selectedIndex + 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = OPTIONS.length - 1;
    else return; // let Escape etc. bubble to the dropdown handler
    e.preventDefault();
    commit(next);
  }

  return (
    <div className="chat-reasoning-bar" ref={pickerRef}>
      <button
        className="chat-reasoning-trigger"
        onClick={() => {
          setSaveError(false);
          setIsOpen((open) => !open);
        }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={t("chat.reasoningEffort.title")}
        type="button"
      >
        <Brain size={12} />
        <span className="chat-reasoning-name">{t(selected.labelKey)}</span>
        <ChevronDown size={12} />
      </button>

      {isOpen && (
        <div
          className="chat-reasoning-dropdown chat-effort"
          aria-label={t("chat.reasoningEffort.title")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setIsOpen(false);
              setSaveError(false);
            }
          }}
        >
          <div className="chat-effort-head">
            <div className="chat-effort-heading">
              <span className="chat-effort-label">
                {t("chat.reasoningEffort.title")}
              </span>
              <span className="chat-effort-value">{t(selected.labelKey)}</span>
            </div>
            <span
              className="chat-effort-help"
              tabIndex={0}
              role="img"
              aria-label={t("chat.reasoningEffort.hint")}
              title={t("chat.reasoningEffort.hint")}
            >
              <HelpCircle size={13} />
            </span>
          </div>

          <div
            ref={trackRef}
            className="chat-effort-track"
            role="slider"
            tabIndex={0}
            aria-label={t("chat.reasoningEffort.title")}
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={OPTIONS.length - 1}
            aria-valuenow={selectedIndex}
            aria-valuetext={t(selected.labelKey)}
            onPointerDown={handleTrackPointerDown}
            onKeyDown={handleTrackKeyDown}
            style={{ ["--effort-frac" as string]: String(fraction) }}
          >
            <span className="chat-effort-rail" aria-hidden="true" />
            <span className="chat-effort-rail-fill" aria-hidden="true" />
            {OPTIONS.map((option, index) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  className={`chat-effort-stop${active ? " active" : ""}${
                    index <= selectedIndex ? " passed" : ""
                  }${index === OPTIONS.length - 1 ? " apex" : ""}`}
                  onClick={() => commit(index)}
                  tabIndex={-1}
                  aria-hidden="true"
                  aria-label={t(option.labelKey)}
                  title={t(option.labelKey)}
                  type="button"
                >
                  <span className="chat-effort-dot" aria-hidden="true" />
                </button>
              );
            })}
          </div>

          <div className="chat-effort-ends" aria-hidden="true">
            <span>{t("chat.reasoningEffort.faster")}</span>
            <span>{t("chat.reasoningEffort.smarter")}</span>
          </div>

          {saveError && (
            <div className="chat-reasoning-error" role="alert">
              {t("chat.reasoningEffort.saveError")}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
