import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { ModelGroup } from "./types";

interface ModelPickerProps {
  active?: boolean;
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  modelGroups: ModelGroup[];
  displayModel: string;
  onOpen: () => void;
  onSelectModel: (provider: string, model: string, baseUrl: string) => void;
}

export const ModelPicker = memo(function ModelPicker({
  active = true,
  currentModel,
  currentProvider,
  currentBaseUrl,
  modelGroups,
  displayModel,
  onOpen,
  onSelectModel,
}: ModelPickerProps): React.JSX.Element {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [customInput, setCustomInput] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    searchRef.current?.focus();
    function handleClickOutside(e: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.stopPropagation();
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });

  useEffect(() => {
    if (!active) return;
    function handleExternalOpen(): void {
      onOpenRef.current();
      setIsOpen(true);
      setSearchInput("");
    }
    window.addEventListener("model-picker:open", handleExternalOpen);
    return () =>
      window.removeEventListener("model-picker:open", handleExternalOpen);
  }, [active]);

  const searchQuery = searchInput.trim().toLowerCase();
  const filteredGroups = searchQuery
    ? modelGroups
        .map((group) => ({
          ...group,
          models: group.models.filter(
            (m) =>
              m.label.toLowerCase().includes(searchQuery) ||
              m.model.toLowerCase().includes(searchQuery),
          ),
        }))
        .filter((group) => group.models.length > 0)
    : modelGroups;

  function toggle(): void {
    if (!isOpen) onOpen();
    setIsOpen((v) => !v);
    setSearchInput("");
  }

  function select(provider: string, model: string, baseUrl: string): void {
    onSelectModel(provider, model, baseUrl);
    setIsOpen(false);
    setCustomInput("");
    setSearchInput("");
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

  return (
    <div className="chat-model-bar" ref={pickerRef}>
      <button className="chat-model-trigger" onClick={toggle}>
        <span className="chat-model-name">{displayModel}</span>
        <ChevronDown size={12} />
      </button>

      {isOpen && (
        <div
          className="chat-model-dropdown"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setIsOpen(false);
            }
          }}
        >
          <input
            ref={searchRef}
            className="chat-model-search-input"
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setIsOpen(false);
              }
            }}
            placeholder={t("chat.searchModels")}
          />
          {filteredGroups.map((group) => (
            <div key={group.provider} className="chat-model-group">
              <div className="chat-model-group-label">
                {t(group.providerLabel)}
              </div>
              {group.models.map((m) => {
                const active =
                  currentModel === m.model && currentProvider === m.provider;
                return (
                  <button
                    key={`${m.provider}:${m.model}`}
                    className={`chat-model-option ${active ? "active" : ""}`}
                    onClick={() => select(m.provider, m.model, m.baseUrl)}
                  >
                    <span className="chat-model-option-label">{m.label}</span>
                    <span className="chat-model-option-id">{m.model}</span>
                  </button>
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
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setIsOpen(false);
                  }
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
