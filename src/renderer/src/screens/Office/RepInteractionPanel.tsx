import { useCallback, useEffect, useRef, useState } from "react";
import { Landmark, X } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type {
  RepActionId,
  SpaceRepresentative,
} from "./office3d/interactions/registry";
import type { OfficeAgent } from "./office3d/core/types";
import type {
  PortfolioTokenView,
  WalletView,
} from "../../../../shared/wallets";

/** Latest action outcome shown in the panel's result area. */
type ActionState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "hint"; message: string }
  | { kind: "error"; message: string }
  | { kind: "status"; wallets: WalletView[] }
  | { kind: "balance"; totalUsd: number; tokens: PortfolioTokenView[] }
  | { kind: "created"; address?: string }
  | { kind: "exists" };

function formatAmount(value: number): string {
  if (value === 0) return "0";
  if (Math.abs(value) < 0.0001) return "< 0.0001";
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "< $0.01";
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function shortAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

/**
 * The interaction menu for a space representative (e.g. the bank
 * receptionist). Actions run against the hermes-one backend for the chosen
 * agent's linked cloud agent; the desktop holds no keys and reads no chain
 * state locally here.
 */
export default function RepInteractionPanel({
  rep,
  agents,
  initialAgentId,
  onClose,
}: {
  rep: SpaceRepresentative;
  agents: OfficeAgent[];
  initialAgentId: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [agentId, setAgentId] = useState<string | null>(initialAgentId);
  const [activeAction, setActiveAction] = useState<RepActionId | null>(null);
  const [state, setState] = useState<ActionState>({ kind: "idle" });

  // The panel stays mounted while the Office selection changes (e.g. clicking
  // an agent visiting the bank), so follow the outside selection instead of
  // keeping the mount-time agent — otherwise actions would silently run for
  // an agent the rest of the UI is no longer focused on. A cleared selection
  // (null) keeps the panel's own picker choice.
  useEffect(() => {
    if (initialAgentId) setAgentId(initialAgentId);
  }, [initialAgentId]);

  // Monotonic token identifying the latest action request. Wallet data must
  // never render under the wrong agent: an in-flight action for agent A is
  // invalidated the moment the picker moves to agent B (or a newer action
  // starts), so its late result is dropped instead of applied.
  const requestSeq = useRef(0);

  // A different agent context invalidates any shown result — including
  // results still in flight.
  useEffect(() => {
    requestSeq.current += 1;
    setState({ kind: "idle" });
    setActiveAction(null);
  }, [agentId]);

  const hintForStatus = useCallback(
    (status: "signed-out" | "unlinked" | "foreign"): ActionState => ({
      kind: "hint",
      message:
        status === "signed-out"
          ? t("office.repStatusSignedOut")
          : status === "foreign"
            ? t("office.repStatusForeign")
            : t("office.repStatusUnlinked"),
    }),
    [t],
  );

  const runAction = useCallback(
    async (actionId: RepActionId): Promise<void> => {
      if (!agentId) return;
      const request = ++requestSeq.current;
      // Apply a result only if this is still the latest request for the
      // currently selected agent.
      const apply = (next: ActionState): void => {
        if (requestSeq.current === request) setState(next);
      };
      setActiveAction(actionId);
      setState({ kind: "loading" });
      try {
        if (actionId === "accountStatus") {
          const res = await window.hermesAPI.syncWallets(agentId);
          if (
            res.status === "signed-out" ||
            res.status === "unlinked" ||
            res.status === "foreign"
          ) {
            apply(hintForStatus(res.status));
          } else if (res.status === "error") {
            apply({
              kind: "error",
              message: res.error || t("office.repErrorGeneric"),
            });
          } else {
            apply({ kind: "status", wallets: res.wallets });
          }
          return;
        }
        if (actionId === "checkBalance") {
          const res = await window.hermesAPI.syncWallets(agentId);
          if (
            res.status === "signed-out" ||
            res.status === "unlinked" ||
            res.status === "foreign"
          ) {
            apply(hintForStatus(res.status));
            return;
          }
          if (res.status === "error") {
            apply({
              kind: "error",
              message: res.error || t("office.repErrorGeneric"),
            });
            return;
          }
          const wallet = res.wallets.find((w) => w.canTransact);
          if (!wallet) {
            apply({
              kind: "hint",
              message: t("office.repBalanceNoTransactable"),
            });
            return;
          }
          const portfolio = await window.hermesAPI.getWalletPortfolio(
            agentId,
            wallet.id,
          );
          if (portfolio.status !== "ok") {
            apply(
              portfolio.status === "error"
                ? {
                    kind: "error",
                    message: portfolio.error || t("office.repErrorGeneric"),
                  }
                : hintForStatus(portfolio.status),
            );
            return;
          }
          apply({
            kind: "balance",
            totalUsd: portfolio.totalUsd ?? 0,
            tokens: portfolio.tokens ?? [],
          });
          return;
        }
        if (actionId === "createAccount") {
          const res = await window.hermesAPI.provisionCloudWallet(agentId);
          if (res.status === "ok") {
            apply({ kind: "created", address: res.wallet?.address });
          } else if (res.status === "exists") {
            apply({ kind: "exists" });
          } else if (res.status === "error") {
            apply({
              kind: "error",
              message: res.error || t("office.repErrorGeneric"),
            });
          } else {
            apply(hintForStatus(res.status));
          }
          return;
        }
      } catch (err) {
        apply({ kind: "error", message: (err as Error).message });
      }
    },
    [agentId, hintForStatus, t],
  );

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    fontSize: 13,
    padding: "6px 0",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  };

  const badgeStyle: React.CSSProperties = {
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    background: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.85)",
  };

  return (
    <aside
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 320,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: "18px 18px 22px",
        background: "var(--card, rgba(20,24,33,0.96))",
        color: "#fff",
        borderLeft: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "-12px 0 32px rgba(0,0,0,0.28)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "rgba(59,130,246,0.18)",
              color: "#7ab3ff",
              flex: "0 0 auto",
            }}
          >
            <Landmark size={16} />
          </span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>
              {t(`office.${rep.labelKey}`)}
            </span>
            <span style={{ fontSize: 12, opacity: 0.6 }}>
              {t(`office.${rep.spaceLabelKey}`)}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          title={t("office.close")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 4,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: "rgba(255,255,255,0.7)",
            cursor: "pointer",
          }}
        >
          <X size={16} />
        </button>
      </div>

      <label
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 12,
          opacity: 0.9,
        }}
      >
        <span style={{ opacity: 0.65 }}>{t("office.repPanelAgentLabel")}</span>
        <select
          value={agentId ?? ""}
          onChange={(e) => setAgentId(e.target.value || null)}
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.06)",
            color: "#fff",
            fontSize: 13,
          }}
        >
          <option value="" disabled>
            {agents.length > 0
              ? t("office.repPanelPickAgent")
              : t("office.noAgents")}
          </option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rep.actions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={action.disabled || !agentId || state.kind === "loading"}
            onClick={() => void runAction(action.id)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "10px 12px",
              borderRadius: 10,
              border:
                activeAction === action.id
                  ? "1px solid rgba(122,179,255,0.55)"
                  : "1px solid rgba(255,255,255,0.12)",
              background:
                activeAction === action.id
                  ? "rgba(59,130,246,0.14)"
                  : "rgba(255,255,255,0.04)",
              color:
                action.disabled || !agentId
                  ? "rgba(255,255,255,0.4)"
                  : "rgba(255,255,255,0.92)",
              cursor:
                action.disabled || !agentId || state.kind === "loading"
                  ? "default"
                  : "pointer",
              fontSize: 13,
              fontWeight: 600,
              textAlign: "left",
            }}
          >
            <span>{t(`office.${action.labelKey}`)}</span>
            {action.disabled && (
              <span style={{ ...badgeStyle, opacity: 0.8 }}>
                {t("office.repComingSoon")}
              </span>
            )}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        {state.kind === "loading" && (
          <span style={{ opacity: 0.65 }}>{t("office.repLoading")}</span>
        )}
        {(state.kind === "hint" || state.kind === "error") && (
          <span
            style={{
              color: state.kind === "error" ? "#f87171" : "#fbbf24",
            }}
          >
            {state.message}
          </span>
        )}
        {state.kind === "created" && (
          <span style={{ color: "#4ade80" }}>
            {t("office.repCreateSuccess")}
            {state.address ? ` — ${shortAddress(state.address)}` : ""}
          </span>
        )}
        {state.kind === "exists" && (
          <span style={{ opacity: 0.85 }}>{t("office.repCreateExists")}</span>
        )}
        {state.kind === "status" &&
          (state.wallets.length === 0 ? (
            <span style={{ opacity: 0.85 }}>{t("office.repWalletsNone")}</span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {state.wallets.map((wallet) => (
                <div key={wallet.id} style={rowStyle}>
                  <span
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      minWidth: 0,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{wallet.name}</span>
                    <span style={{ opacity: 0.6, fontSize: 11 }}>
                      {shortAddress(wallet.address)}
                    </span>
                  </span>
                  <span style={badgeStyle}>
                    {wallet.canTransact
                      ? t("office.repBadgeTransactable")
                      : t("office.repBadgeReceiveOnly")}
                  </span>
                </div>
              ))}
            </div>
          ))}
        {state.kind === "balance" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {state.tokens.length === 0 && (
              <span style={{ opacity: 0.85 }}>
                {t("office.repBalanceEmpty")}
              </span>
            )}
            {state.tokens.map((token, index) => (
              <div key={`${token.symbol}-${index}`} style={rowStyle}>
                <span style={{ fontWeight: 600 }}>{token.symbol}</span>
                <span style={{ display: "flex", gap: 10 }}>
                  <span>{formatAmount(token.balance)}</span>
                  <span style={{ opacity: 0.6 }}>
                    {formatUsd(token.balanceUsd)}
                  </span>
                </span>
              </div>
            ))}
            <div style={{ ...rowStyle, borderBottom: "none" }}>
              <span style={{ opacity: 0.65 }}>
                {t("office.repBalanceTotal")}
              </span>
              <span style={{ fontWeight: 700 }}>
                {formatUsd(state.totalUsd)}
              </span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
