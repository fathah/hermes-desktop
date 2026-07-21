import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpToLine,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  FileText,
  Landmark,
  Loader2,
  RefreshCw,
  UserPlus,
  Wallet,
  X,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type {
  RepActionId,
  SpaceRepresentative,
} from "./office3d/interactions/registry";
import type { OfficeAgent } from "./office3d/core/types";
import {
  BASE_NETWORK_LABEL,
  type PortfolioTokenView,
  type WalletView,
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

/** Icon shown on each action chip, keyed by action id. */
const ACTION_ICONS: Record<RepActionId, typeof Wallet> = {
  checkBalance: Wallet,
  accountStatus: FileText,
  createAccount: UserPlus,
  sendMoney: ArrowLeftRight,
  withdraw: ArrowDownToLine,
  deposit: ArrowUpToLine,
};

/** Header icon per representative; falls back to the bank landmark. */
const REP_ICONS: Record<string, typeof Wallet> = {
  "bank-teller": Landmark,
  atm: CreditCard,
};

/** A round token badge's colours, themed by symbol (no gradients). */
function tokenBadge(symbol: string): {
  bg: string;
  color: string;
  label: string;
} {
  const key = symbol.toUpperCase();
  if (key === "HD" || key === "H1" || key.startsWith("HERMES")) {
    return {
      bg: "var(--primary-yellow)",
      color: "#1a1a1a",
      label: key.slice(0, 2),
    };
  }
  if (key === "ETH" || key === "WETH") {
    return {
      bg: "var(--accent-subtle)",
      color: "var(--accent-text)",
      label: "Ξ",
    };
  }
  return {
    bg: "var(--bg-elevated)",
    color: "var(--text-secondary)",
    label: key.slice(0, 2),
  };
}

/**
 * Session cache of each agent's bank state. An agent has exactly one account,
 * so once we've seen its wallet we remember it (id/address/transactable) plus
 * its last portfolio for the life of the app process. This lets the panel
 * hydrate instantly when reopened or when switching back to an agent, skip the
 * wallet lookup on a "Check balance" refresh, and hide "Create account" for an
 * agent that already has one. In-memory only — no cloud wallet data is
 * persisted to disk (see wallet-token-balances).
 *
 * The key is `${signed-in account id}::${agent id}`, so cached financial data
 * can never cross a sign-out/relink: a different (or absent) account produces a
 * different key, and the previous account's portfolio and wallet id are never
 * read back for the relinked profile. A null key (no known account) is a cache
 * miss on read and a no-op on write, so nothing is served or stored while
 * signed out.
 */
interface AgentBankCache {
  wallet: { id: string; address: string; canTransact: boolean } | null;
  hasAccount: boolean;
  portfolio?: { totalUsd: number; tokens: PortfolioTokenView[] };
}

const bankCache = new Map<string, AgentBankCache>();

function readBank(key: string | null): AgentBankCache | null {
  return key ? (bankCache.get(key) ?? null) : null;
}

function rememberBank(
  key: string | null,
  patch: Partial<AgentBankCache>,
): void {
  if (!key) return;
  const prev = bankCache.get(key) ?? { wallet: null, hasAccount: false };
  bankCache.set(key, { ...prev, ...patch });
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
  visible = true,
  onClose,
}: {
  rep: SpaceRepresentative;
  agents: OfficeAgent[];
  initialAgentId: string | null;
  // Whether the Office tab hosting this panel is the shown view. The panel
  // stays mounted while the tab is hidden, so this re-triggers account
  // resolution when the user returns (see the account-scope effect below).
  visible?: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [agentId, setAgentId] = useState<string | null>(initialAgentId);
  const [activeAction, setActiveAction] = useState<RepActionId | null>(null);
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  // Whether the selected agent is known to already have an account (from the
  // session cache or a completed action). Hides the redundant "Create account".
  const [hasAccount, setHasAccount] = useState(false);

  // The signed-in Hermes account id, used to scope the wallet cache so cached
  // financial data never survives a sign-out or relink. Null until resolved (or
  // when signed out), which makes cache lookups miss and writes no-op.
  //
  // Re-resolved every time the Office tab becomes visible, not just on mount:
  // the panel can stay mounted while the tab is hidden and the user changes the
  // Hermes account elsewhere (account management lives outside Office), so
  // returning must re-check who's signed in. If the account changed, `accountId`
  // updates, the cache key changes, and the rehydrate effect misses the previous
  // account's entry instead of surfacing its portfolio.
  const [accountId, setAccountId] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) {
      // Hidden: forget the resolved account so a stale balance can never flash
      // on return before we re-check who's signed in. The rehydrate effect
      // falls back to idle while the account is unknown.
      setAccountId(null);
      return;
    }
    let alive = true;
    void window.hermesAPI
      .getAccount()
      .then((acc) => {
        if (alive) setAccountId(acc?.user.id ?? null);
      })
      .catch(() => {
        if (alive) setAccountId(null);
      });
    return () => {
      alive = false;
    };
  }, [visible]);

  const cacheKey = useCallback(
    (id: string | null): string | null =>
      accountId && id ? `${accountId}::${id}` : null,
    [accountId],
  );

  // Drives the open transition: false on mount, flipped true on the next frame
  // so the backdrop fades and the card scales in. Escape closes the modal.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

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
  // results still in flight — then rehydrates from the session cache: a known
  // portfolio renders instantly and a known account hides "Create account". A
  // cold agent (or an unresolved/absent account) falls back to idle. Re-runs
  // once the account id resolves so the cache is read under the right scope.
  useEffect(() => {
    requestSeq.current += 1;
    setActiveAction(null);
    const cached = readBank(cacheKey(agentId));
    setHasAccount(cached?.hasAccount ?? false);
    setState(
      cached?.portfolio
        ? {
            kind: "balance",
            totalUsd: cached.portfolio.totalUsd,
            tokens: cached.portfolio.tokens,
          }
        : { kind: "idle" },
    );
  }, [agentId, cacheKey]);

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
      // Cache key captured at the request's start so a late result caches under
      // this request's account + agent, even after the picker moved on.
      const key = cacheKey(agentId);
      // Apply a result only if this is still the latest request for the
      // currently selected agent.
      const apply = (next: ActionState): void => {
        if (requestSeq.current === request) setState(next);
      };
      // Cache updates are keyed by this request's account + agent, so a late
      // result still caches the right data even after the picker moved on; the
      // hasAccount flag only touches the UI while this request is current.
      const remember = (patch: Partial<AgentBankCache>): void => {
        rememberBank(key, patch);
        if (patch.hasAccount !== undefined && requestSeq.current === request) {
          setHasAccount(patch.hasAccount);
        }
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
            const primary =
              res.wallets.find((w) => w.canTransact) ?? res.wallets[0] ?? null;
            remember({
              hasAccount: res.wallets.length > 0,
              wallet: primary
                ? {
                    id: primary.id,
                    address: primary.address,
                    canTransact: !!primary.canTransact,
                  }
                : null,
            });
            apply({ kind: "status", wallets: res.wallets });
          }
          return;
        }
        if (actionId === "checkBalance") {
          // Reuse the cached transactable wallet id so a refresh skips the
          // wallet-lookup round-trip; only fetch the wallet list when unknown.
          // The key is account-scoped, so a relinked profile never reuses the
          // previous account's wallet id.
          const cached = readBank(key);
          let walletId = cached?.wallet?.canTransact ? cached.wallet.id : null;
          if (!walletId) {
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
            remember({
              hasAccount: res.wallets.length > 0,
              wallet: wallet
                ? { id: wallet.id, address: wallet.address, canTransact: true }
                : (cached?.wallet ?? null),
            });
            if (!wallet) {
              apply({
                kind: "hint",
                message: t("office.repBalanceNoTransactable"),
              });
              return;
            }
            walletId = wallet.id;
          }
          const portfolio = await window.hermesAPI.getWalletPortfolio(
            agentId,
            walletId,
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
          const result = {
            totalUsd: portfolio.totalUsd ?? 0,
            tokens: portfolio.tokens ?? [],
          };
          remember({ hasAccount: true, portfolio: result });
          apply({ kind: "balance", ...result });
          return;
        }
        if (actionId === "createAccount") {
          const res = await window.hermesAPI.provisionCloudWallet(agentId);
          if (res.status === "ok") {
            remember({
              hasAccount: true,
              wallet: res.wallet
                ? {
                    id: res.wallet.id,
                    address: res.wallet.address,
                    canTransact: !!res.wallet.canTransact,
                  }
                : null,
            });
            apply({ kind: "created", address: res.wallet?.address });
          } else if (res.status === "exists") {
            remember({ hasAccount: true });
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
    [agentId, cacheKey, hintForStatus, t],
  );

  const selectedAgent = agents.find((a) => a.id === agentId) ?? null;
  const busy = state.kind === "loading";

  // One agent can only ever have one account, so "Create account" is dropped
  // once we know this agent already has one.
  const visibleActions = hasAccount
    ? rep.actions.filter((a) => a.id !== "createAccount")
    : rep.actions;

  // Header identity varies by representative (bank teller vs. ATM).
  const HeaderIcon = REP_ICONS[rep.id] ?? Landmark;
  const isAtm = rep.id === "atm";
  const statusText = selectedAgent
    ? isAtm
      ? `${t("office.repAtmOnline")} · ${selectedAgent.name}`
      : `${t("office.repTellerOpen")} · ${t("office.repTellerServing", { name: selectedAgent.name })}`
    : t("office.repTellerIdle");

  // --- shared style tokens (theme colours, flat, no gradients) --------------
  const card: React.CSSProperties = {
    borderRadius: 14,
    border: "1px solid var(--border)",
    background: "var(--bg-tertiary)",
    padding: 16,
  };
  const label: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  };
  // Money/amount figures render in Space Grotesk with tabular digits so totals
  // and token balances line up.
  const numeric: React.CSSProperties = {
    fontFamily: "var(--font-numeric)",
    fontVariantNumeric: "tabular-nums",
  };

  // Hero card content varies by the latest action outcome; the action grid
  // below stays constant so the panel never reflows out from under a click.
  function renderHero(): React.JSX.Element {
    if (state.kind === "loading") {
      return (
        <div style={card}>
          <div style={label}>{t("office.repLoading")}</div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 10,
              color: "var(--text-secondary)",
            }}
          >
            <Loader2 size={18} className="animate-spin" />
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              {t("office.repLoadingBalance")}
            </span>
          </div>
          <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
            <div
              style={{
                height: 8,
                borderRadius: 999,
                width: "70%",
                background: "var(--bg-elevated)",
              }}
            />
            <div
              style={{
                height: 8,
                borderRadius: 999,
                width: "45%",
                background: "var(--bg-elevated)",
              }}
            />
          </div>
        </div>
      );
    }

    if (state.kind === "error") {
      return (
        <div
          style={{
            ...card,
            borderColor: "var(--error)",
            background: "var(--error-bg)",
          }}
        >
          <div style={{ ...label, color: "var(--error)" }}>
            {t("office.repErrorTitle")}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 10,
              color: "var(--text-primary)",
            }}
          >
            <AlertCircle size={18} color="var(--error)" />
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              {t("office.repErrorTitle")}
            </span>
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 13,
              color: "var(--text-secondary)",
            }}
          >
            {state.message}
          </div>
          {activeAction && (
            <button
              type="button"
              onClick={() => void runAction(activeAction)}
              disabled={busy}
              style={{
                marginTop: 12,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: "none",
                background: "transparent",
                color: "var(--accent-text)",
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? "default" : "pointer",
                padding: 0,
              }}
            >
              <RefreshCw size={13} />
              {t("office.repRetry")}
            </button>
          )}
        </div>
      );
    }

    if (state.kind === "created") {
      return (
        <div
          style={{
            ...card,
            borderColor: "var(--success)",
            background: "var(--success-bg)",
          }}
        >
          <div style={{ ...label, color: "var(--success)" }}>
            {t("office.repCreateSuccess")}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 10,
              color: "var(--text-primary)",
            }}
          >
            <CheckCircle2 size={18} color="var(--success)" />
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              {t("office.repCreateSuccess")}
            </span>
          </div>
          {state.address && (
            <div
              style={{
                marginTop: 6,
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              {shortAddress(state.address)} · {BASE_NETWORK_LABEL}
            </div>
          )}
        </div>
      );
    }

    if (state.kind === "exists") {
      return (
        <div style={card}>
          <div style={label}>{t("office.repCreateSuccess")}</div>
          <div
            style={{
              marginTop: 8,
              fontSize: 14,
              color: "var(--text-secondary)",
            }}
          >
            {t("office.repCreateExists")}
          </div>
        </div>
      );
    }

    if (state.kind === "hint") {
      return (
        <div
          style={{
            ...card,
            borderColor: "var(--warning)",
            background: "var(--warning-bg)",
          }}
        >
          <div
            style={{
              fontSize: 14,
              color: "var(--text-primary)",
              lineHeight: 1.5,
            }}
          >
            {state.message}
          </div>
        </div>
      );
    }

    if (state.kind === "balance") {
      // Reaching a balance means the account already exists, so the empty
      // wallet just reports zero funds — no "create" prompt (one account only).
      if (state.totalUsd === 0 && state.tokens.length === 0) {
        return (
          <div style={card}>
            <div style={label}>{t("office.repEmptyWalletTitle")}</div>
            <div
              style={{
                ...numeric,
                fontSize: 32,
                fontWeight: 700,
                marginTop: 6,
                color: "var(--text-primary)",
              }}
            >
              {formatUsd(0)}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              {t("office.repEmptyWalletBody")}
            </div>
          </div>
        );
      }
      return (
        <div style={card}>
          <div style={label}>{t("office.repTotalBalance")}</div>
          <div
            style={{
              ...numeric,
              fontSize: 34,
              fontWeight: 700,
              marginTop: 4,
              color: "var(--text-primary)",
              letterSpacing: "-0.01em",
            }}
          >
            {formatUsd(state.totalUsd)}
          </div>
          <BalanceSparkline />
        </div>
      );
    }

    // idle / status → neutral placeholder hero.
    return (
      <div style={card}>
        <div style={label}>{t("office.repTotalBalance")}</div>
        <div
          style={{
            ...numeric,
            fontSize: 34,
            fontWeight: 700,
            marginTop: 4,
            color: "var(--text-muted)",
          }}
        >
          $—
        </div>
        <div
          style={{ marginTop: 6, fontSize: 13, color: "var(--text-secondary)" }}
        >
          {t("office.repBalancePlaceholder")}
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
        padding: 24,
        opacity: shown ? 1 : 0,
        transition: "opacity 200ms ease-out",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440,
          maxWidth: "100%",
          maxHeight: "calc(100vh - 48px)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: "18px 18px 20px",
          background: "var(--bg-secondary)",
          color: "var(--text-primary)",
          border: "1px solid var(--border)",
          borderRadius: 18,
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
          overflowY: "auto",
          transform: shown ? "scale(1)" : "scale(0.97)",
          transition: "opacity 200ms ease-out, transform 200ms ease-out",
        }}
      >
        {/* Header: identity + agent chip + close */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minWidth: 0,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 34,
                height: 34,
                borderRadius: 10,
                background: "var(--accent-subtle)",
                color: "var(--accent-text)",
                flex: "0 0 auto",
              }}
            >
              <HeaderIcon size={17} />
            </span>
            <div
              style={{ display: "flex", flexDirection: "column", minWidth: 0 }}
            >
              <span style={{ fontWeight: 700, fontSize: 16 }}>
                {t(`office.${rep.labelKey}`)}
              </span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "var(--text-muted)",
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    background: selectedAgent
                      ? "var(--success)"
                      : "var(--text-muted)",
                    flex: "0 0 auto",
                  }}
                />
                <span
                  style={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    minWidth: 0,
                  }}
                >
                  {statusText}
                </span>
              </span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flex: "0 0 auto",
            }}
          >
            {/* Agent picker, styled as a chip. Native <select> keeps it
              keyboard-accessible; the avatar and chevron are overlays. */}
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                height: 34,
                paddingLeft: 6,
                paddingRight: 26,
                borderRadius: 999,
                border: "1px solid var(--border-bright)",
                background: "var(--bg-tertiary)",
                maxWidth: 160,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  flex: "0 0 auto",
                }}
              >
                {(selectedAgent?.name ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <select
                value={agentId ?? ""}
                onChange={(e) => setAgentId(e.target.value || null)}
                style={{
                  appearance: "none",
                  WebkitAppearance: "none",
                  MozAppearance: "none",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-primary)",
                  fontSize: 13,
                  fontWeight: 600,
                  paddingLeft: 8,
                  paddingRight: 0,
                  maxWidth: 96,
                  cursor: "pointer",
                  outline: "none",
                  textOverflow: "ellipsis",
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
              <ChevronDown
                size={15}
                color="var(--text-muted)"
                style={{
                  position: "absolute",
                  right: 8,
                  pointerEvents: "none",
                }}
              />
            </div>

            <button
              type="button"
              onClick={onClose}
              title={t("office.close")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 34,
                height: 34,
                borderRadius: 999,
                border: "1px solid var(--border-bright)",
                background: "var(--bg-tertiary)",
                color: "var(--text-muted)",
                cursor: "pointer",
                flex: "0 0 auto",
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Hero: total balance / state feedback */}
        {renderHero()}

        {/* Token rows (only when a balance is loaded and non-empty) */}
        {state.kind === "balance" && state.tokens.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {state.tokens.map((token, index) => {
              const badge = tokenBadge(token.symbol);
              return (
                <div
                  key={`${token.symbol}-${index}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 2px",
                    borderBottom:
                      index === state.tokens.length - 1
                        ? "none"
                        : "1px solid var(--border)",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 38,
                      height: 38,
                      borderRadius: 999,
                      background: badge.bg,
                      color: badge.color,
                      fontSize: 13,
                      fontWeight: 700,
                      flex: "0 0 auto",
                    }}
                  >
                    {badge.label}
                  </span>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 14,
                        color: "var(--text-primary)",
                      }}
                    >
                      {token.name || token.symbol}
                    </span>
                    <span
                      style={{
                        ...numeric,
                        fontSize: 12,
                        color: "var(--text-muted)",
                      }}
                    >
                      {formatAmount(token.balance)} {token.symbol}
                    </span>
                  </div>
                  <span
                    style={{
                      ...numeric,
                      fontWeight: 600,
                      fontSize: 14,
                      color: "var(--text-primary)",
                    }}
                  >
                    {formatUsd(token.balanceUsd)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Account status rows (when the account-status action was run) */}
        {state.kind === "status" && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {state.wallets.length === 0 ? (
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {t("office.repWalletsNone")}
              </span>
            ) : (
              state.wallets.map((wallet, index) => (
                <div
                  key={wallet.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "12px 2px",
                    borderBottom:
                      index === state.wallets.length - 1
                        ? "none"
                        : "1px solid var(--border)",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      minWidth: 0,
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      {wallet.name}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {shortAddress(wallet.address)}
                    </span>
                  </span>
                  <span
                    style={{
                      padding: "3px 9px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 600,
                      background: "var(--bg-elevated)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {wallet.canTransact
                      ? t("office.repBadgeTransactable")
                      : t("office.repBadgeReceiveOnly")}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Action chips — flex-wrap so a variable set of actions always lays
            out cleanly (no empty grid cells). */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginTop: 2,
          }}
        >
          {visibleActions.map((action) => {
            const Icon = ACTION_ICONS[action.id];
            const primary = action.id === "checkBalance" && !action.disabled;
            const disabled = action.disabled || !agentId || busy;
            return (
              <button
                key={action.id}
                type="button"
                disabled={disabled}
                onClick={() => void runAction(action.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "10px 16px 10px 12px",
                  borderRadius: 999,
                  border: primary
                    ? "1px solid var(--accent)"
                    : "1px solid var(--border)",
                  background: primary ? "var(--accent)" : "var(--bg-tertiary)",
                  color: action.disabled
                    ? "var(--text-muted)"
                    : primary
                      ? "#fff"
                      : "var(--text-primary)",
                  cursor: disabled ? "default" : "pointer",
                  opacity: !agentId && !action.disabled ? 0.55 : 1,
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                <Icon
                  size={16}
                  style={{
                    flex: "0 0 auto",
                    opacity: action.disabled ? 0.7 : 1,
                  }}
                />
                <span>{t(`office.${action.labelKey}`)}</span>
                {action.disabled && (
                  <span
                    style={{
                      marginLeft: 2,
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      background: "var(--accent-subtle)",
                      color: "var(--accent-text)",
                    }}
                  >
                    {t("office.repSoon")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * A flat, decorative baseline shown under the total. It carries no data — the
 * backend gives no price history — so it stays a neutral accent line rather
 * than implying a specific trend.
 */
function BalanceSparkline(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 300 44"
      preserveAspectRatio="none"
      style={{ width: "100%", height: 40, marginTop: 12, display: "block" }}
    >
      <polyline
        points="0,30 40,26 80,29 120,20 160,24 200,14 240,18 300,10"
        fill="none"
        stroke="var(--accent-text)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.55}
      />
    </svg>
  );
}
