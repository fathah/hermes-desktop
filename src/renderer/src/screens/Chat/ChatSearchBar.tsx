import { memo, useEffect, useRef } from "react";
import { Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { useI18n } from "../../components/useI18n";

interface ChatSearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  matchIndex: number;
  totalMatches: number;
  onPrev: () => void;
  onNext: () => void;
}

export const ChatSearchBar = memo(function ChatSearchBar({
  query,
  onQueryChange,
  onClose,
  matchIndex,
  totalMatches,
  onPrev,
  onNext,
}: ChatSearchBarProps): React.JSX.Element {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    }
  }

  return (
    <div className="chat-search-bar">
      <Search size={14} className="chat-search-icon" />
      <input
        ref={inputRef}
        type="text"
        className="chat-search-input"
        placeholder={t("chat.searchPlaceholder")}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {query && (
        <span className="chat-search-count">
          {totalMatches > 0 ? `${matchIndex + 1}/${totalMatches}` : t("chat.searchNoMatch")}
        </span>
      )}
      <button
        type="button"
        className="chat-search-nav"
        onClick={onPrev}
        disabled={totalMatches === 0}
        title={t("chat.searchPrev")}
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        className="chat-search-nav"
        onClick={onNext}
        disabled={totalMatches === 0}
        title={t("chat.searchNext")}
      >
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        className="chat-search-close"
        onClick={onClose}
        title={t("chat.searchClose")}
      >
        <X size={14} />
      </button>
    </div>
  );
});
