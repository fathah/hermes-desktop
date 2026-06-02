import { memo } from "react";
import { useI18n } from "../../components/useI18n";

export interface ContextUsage {
  /** Current context occupancy = latest turn's prompt tokens. */
  used: number;
  /** Model context window in tokens. */
  window: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/**
 * Small circular gauge showing how full the model's context window is, with a
 * hover/focus tooltip breaking down tokens used and prompt-cache hits. Mirrors
 * the webui's context indicator. Auto-compress threshold is intentionally
 * omitted — the gateway doesn't expose it over the chat API.
 */
export const ContextGauge = memo(function ContextGauge({
  used,
  window: ctxWindow,
  cacheReadTokens,
  cacheWriteTokens,
}: ContextUsage): React.JSX.Element {
  const { t } = useI18n();
  const pct =
    ctxWindow > 0 ? Math.min(100, Math.round((used / ctxWindow) * 100)) : 0;
  const left = 100 - pct;

  // Ring geometry.
  const size = 26;
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (pct / 100) * circumference;

  const hasCache =
    cacheReadTokens !== undefined || cacheWriteTokens !== undefined;
  const cacheHitPct =
    used > 0 && cacheReadTokens
      ? Math.min(100, Math.round((cacheReadTokens / used) * 100))
      : 0;

  return (
    <div
      className="chat-ctx-gauge"
      tabIndex={0}
      role="img"
      aria-label={t("chat.contextUsed", { pct, left })}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="chat-ctx-gauge-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="chat-ctx-gauge-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="chat-ctx-gauge-num">{pct}</span>

      <div className="chat-ctx-tooltip" role="tooltip">
        <div className="chat-ctx-tooltip-title">{t("chat.contextWindow")}</div>
        <div>{t("chat.contextUsed", { pct, left })}</div>
        <div>
          {t("chat.contextTokens", {
            used: fmtTokens(used),
            total: fmtTokens(ctxWindow),
          })}
        </div>
        {hasCache && (
          <div>
            {t("chat.contextCache", {
              pct: cacheHitPct,
              read: fmtTokens(cacheReadTokens || 0),
              write: fmtTokens(cacheWriteTokens || 0),
            })}
          </div>
        )}
      </div>
    </div>
  );
});
