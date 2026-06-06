import { memo } from "react";
import {
  Search,
  Clock,
  Mail,
  Code,
  ChartLine,
  Bell,
  BookOpen,
} from "lucide-react";
import icon from "../../assets/icon.png";
import { useI18n } from "../../components/useI18n";

interface Suggestion {
  i18nKey: string;
  text: string;
  Icon: typeof Search;
}

const SUGGESTIONS: Suggestion[] = [
  {
    i18nKey: "chat.suggestionSearch",
    text: "Search the web for today's top tech news",
    Icon: Search,
  },
  {
    i18nKey: "chat.suggestionReminder",
    text: "Set a reminder to check emails every day at 9 AM",
    Icon: Bell,
  },
  {
    i18nKey: "chat.suggestionEmail",
    text: "Read my latest emails and summarize them",
    Icon: Mail,
  },
  {
    i18nKey: "chat.suggestionScript",
    text: "Write a Python script to rename all files in a folder",
    Icon: Code,
  },
  {
    i18nKey: "chat.suggestionSchedule",
    text: "Schedule a cron job to back up my database every night",
    Icon: Clock,
  },
  {
    i18nKey: "chat.suggestionAnalyze",
    text: "Analyze this CSV file and show key insights",
    Icon: ChartLine,
  },
  {
    i18nKey: "chat.suggestionResearch",
    text: "Find recent open-access papers on CRISPR gene editing and summarize the top 3",
    Icon: BookOpen,
  },
];

interface ChatEmptyStateProps {
  onSelectSuggestion: (text: string) => void;
}

export const ChatEmptyState = memo(function ChatEmptyState({
  onSelectSuggestion,
}: ChatEmptyStateProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="chat-empty">
      <div className="chat-empty-icon">
        <img src={icon} width={64} height={64} alt="" />
      </div>
      <div className="chat-empty-text">{t("chat.emptyTitle")}</div>
      <div className="chat-empty-hint">{t("chat.emptyHint")}</div>
      <div className="chat-empty-suggestions">
        {SUGGESTIONS.map(({ i18nKey, text, Icon }) => (
          <button
            key={i18nKey}
            className="chat-suggestion"
            onClick={() => onSelectSuggestion(text)}
          >
            <Icon size={16} />
            {t(i18nKey)}
          </button>
        ))}
      </div>
    </div>
  );
});
