import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { ModelGroup } from "./types";

interface ModelPickerProps {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  modelGroups: ModelGroup[];
  displayModel: string;
  onOpen: () => void;
  onSelectModel: (provider: string, model: string, baseUrl: string) => void;
  selectedModels: Array<{
    provider: string;
    model: string;
    baseUrl: string;
    label: string;
  }>;
  onToggleCouncilModel: (
    provider: string,
    model: string,
    baseUrl: string,
    label: string,
  ) => void;
}

export const ModelPicker = memo(function ModelPicker({
  currentModel,
  currentProvider,
  currentBaseUrl,
  modelGroups,
  displayModel,
  onOpen,
  onSelectModel,
  selectedModels,
  onToggleCouncilModel,
}: ModelPickerProps): React.JSX.Element {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

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

  function toggle(): void {
    if (!isOpen) onOpen();
    setIsOpen((v) => !v);
  }

  function select(provider: string, model: string, baseUrl: string): void {
    onSelectModel(provider, model, baseUrl);
    setIsOpen(false);
    setCustomInput("");
  }

  function submitCustom(): void {
    const model = customInput.trim();
    if (!model) return;
    select(
      currentProvider === "auto" ? "auto" : currentProvider,
      model,
      currentBaseUrl,
    );
  }

  const isCouncil = selectedModels.length > 1;

  return (
    <div className="chat-model-bar" ref={pickerRef}>
      <button
        className={`chat-model-trigger ${isCouncil ? "council-active" : ""}`}
        onClick={toggle}
        type="button"
      >
        <span className="chat-model-name">
          {isCouncil
            ? `Council of LLMs (${selectedModels.length})`
            : displayModel}
        </span>
        <ChevronDown size={12} />
      </button>

      {isOpen && (
        <div className="chat-model-dropdown">
          {modelGroups.map((group) => (
            <div key={group.provider} className="chat-model-group">
              <div className="chat-model-group-label">
                {t(group.providerLabel)}
              </div>
              {group.models.map((m) => {
                const active =
                  currentModel === m.model && currentProvider === m.provider;
                const isSelectedInCouncil = selectedModels.some(
                  (sm) => sm.model === m.model && sm.provider === m.provider,
                );
                return (
                  <div
                    key={`${m.provider}:${m.model}`}
                    className={`chat-model-option-wrapper ${
                      m.disabled ? "disabled" : ""
                    }`}
                  >
                    <button
                      className={`chat-model-option ${active ? "active" : ""}`}
                      onClick={() => select(m.provider, m.model, m.baseUrl)}
                      disabled={m.disabled}
                      title={
                        m.disabledReasonKey ? t(m.disabledReasonKey) : undefined
                      }
                      type="button"
                    >
                      <span className="chat-model-option-label">{m.label}</span>
                      <span className="chat-model-option-id">
                        {m.disabledReasonKey ? t(m.disabledReasonKey) : m.model}
                      </span>
                    </button>
                    <div
                      className="chat-model-option-checkbox-container"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (m.disabled) return;
                        onToggleCouncilModel(
                          m.provider,
                          m.model,
                          m.baseUrl,
                          m.label,
                        );
                      }}
                    >
                      <input
                        type="checkbox"
                        className="chat-model-option-checkbox"
                        checked={isSelectedInCouncil}
                        disabled={m.disabled}
                        onChange={() => {}}
                        title="Add to Council of LLMs"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          <div className="chat-model-group">
            <div className="chat-model-group-label">{t("chat.custom")}</div>
            <div className="chat-model-custom">
              <input
                className="chat-model-custom-input"
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitCustom();
                }}
                placeholder={t("chat.typeModelName")}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
