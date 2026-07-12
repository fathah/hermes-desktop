import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Refresh, Trash, Wallet, X } from "../../assets/icons";
import etheriumIcon from "../../assets/icons/etherium.webp";
import hdTokenIcon from "../../assets/icons/hdtoken.webp";
import type { ProfileWallet, WalletView } from "../../../../shared/wallets";
import { BASE_NETWORK_LABEL } from "../../../../shared/wallets";
import type { TokenBalancesResponse } from "../../../../shared/tokens";
import { AppModal, AppModalTitle } from "../modal/AppModal";
import { useI18n } from "../useI18n";

/** Map token IDs to their Vite-resolved icon URLs. */
const TOKEN_ICONS: Record<string, string> = {
  eth: etheriumIcon,
  hd: hdTokenIcon,
};

/**
 * Module-level balance cache keyed by wallet address.
 * Survives component remounts (tab switches) so stale data
 * displays instantly while fresh balances load in the background.
 */
const balanceCache = new Map<string, TokenBalancesResponse>();

interface ProfileWalletPaneProps {
  profile: string;
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Present a local wallet as the shared view model. */
function localToView(wallet: ProfileWallet): WalletView {
  return { ...wallet, source: "local" };
}

export default function ProfileWalletPane({
  profile,
}: ProfileWalletPaneProps): React.JSX.Element {
  const { t } = useI18n();
  const [wallets, setWallets] = useState<WalletView[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  // A non-fatal note about cloud wallets (signed out / not yet synced).
  const [cloudNote, setCloudNote] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WalletView | null>(null);
  const [balances, setBalances] = useState<Map<string, TokenBalancesResponse>>(
    () => new Map(),
  );
  const [balancesLoading, setBalancesLoading] = useState<Set<string>>(
    new Set(),
  );

  /** Ref that tracks wallet ID → address so fetchBalances can update the cache. */
  const walletIdToAddress = useRef<Map<string, string>>(new Map());

  /**
   * Generation counter for loadWallets. Each call bumps it and captures its
   * value; after an await, a run whose id no longer matches has been
   * superseded (profile change, refresh, or post-delete reload) and must not
   * apply its now-stale results over the newer run's.
   */
  const loadRunRef = useRef(0);

  /** Hydrate balances from the module-level cache after wallets load. */
  function hydrateFromCache(walletList: WalletView[]): void {
    const map = new Map<string, TokenBalancesResponse>();
    const addrMap = new Map<string, string>();
    for (const w of walletList) {
      addrMap.set(w.id, w.address);
      const cached = balanceCache.get(w.address);
      if (cached) map.set(w.id, cached);
    }
    walletIdToAddress.current = addrMap;
    setBalances(map);
  }

  async function fetchBalances(walletList: WalletView[]): Promise<void> {
    if (walletList.length === 0) return;
    // Functional updates only touch this call's ids, so the two concurrent
    // fetches (local + cloud) can't clobber each other's loading spinners.
    const ids = new Set(walletList.map((w) => w.id));
    setBalancesLoading((prev) => new Set([...prev, ...ids]));
    const results = await Promise.allSettled(
      walletList.map(async (w) => {
        const response = await window.hermesAPI.getTokenBalances(w.address);
        return { walletId: w.id, address: w.address, response };
      }),
    );
    setBalances((prev) => {
      const next = new Map(prev);
      for (const result of results) {
        if (result.status === "fulfilled") {
          const { walletId, address, response } = result.value;
          next.set(walletId, response);
          balanceCache.set(address, response);
        }
      }
      return next;
    });
    setBalancesLoading((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  async function refreshSingleBalance(wallet: WalletView): Promise<void> {
    setBalancesLoading((prev) => new Set(prev).add(wallet.id));
    try {
      const response = await window.hermesAPI.getTokenBalances(wallet.address);
      balanceCache.set(wallet.address, response);
      setBalances((prev) => {
        const next = new Map(prev);
        next.set(wallet.id, response);
        return next;
      });
    } catch {
      // Error is reflected as missing balance entry; user can retry.
    } finally {
      setBalancesLoading((prev) => {
        const next = new Set(prev);
        next.delete(wallet.id);
        return next;
      });
    }
  }

  const loadWallets = useCallback(async (): Promise<void> => {
    const runId = ++loadRunRef.current;
    const isStale = (): boolean => loadRunRef.current !== runId;
    setLoading(true);
    setError("");
    setCloudNote("");
    // Local wallets are on disk and show immediately; cloud wallets come from
    // the backend for the profile's linked agent and stream in after.
    let local: WalletView[] = [];
    try {
      local = (await window.hermesAPI.listWallets(profile)).map(localToView);
    } catch {
      if (!isStale()) setError(t("agents.walletLoadFailed"));
    }
    // A newer load (profile switch / refresh) has superseded this one; don't
    // overwrite its state with this profile's data.
    if (isStale()) return;
    setWallets(local);
    hydrateFromCache(local);
    void fetchBalances(local);
    setLoading(false);

    setSyncing(true);
    try {
      const result = await window.hermesAPI.syncWallets(profile);
      if (isStale()) return;
      if (result.status === "signed-out") {
        setCloudNote(t("agents.walletSignInHint"));
      } else if (result.status === "unlinked") {
        setCloudNote(t("agents.walletSyncedHint"));
      } else if (result.status === "foreign") {
        setCloudNote(t("agents.walletForeignHint"));
      } else if (result.status === "error") {
        setCloudNote(result.error || t("agents.walletLoadFailed"));
      } else if (result.wallets.length > 0) {
        // Cloud ids are backend uuids; no collision with local ids.
        const merged = [...local, ...result.wallets];
        setWallets(merged);
        hydrateFromCache(merged);
        void fetchBalances(result.wallets);
      }
    } catch {
      if (!isStale()) setCloudNote(t("agents.walletLoadFailed"));
    } finally {
      if (!isStale()) setSyncing(false);
    }
  }, [profile, t]);

  useEffect(() => {
    void loadWallets();
  }, [loadWallets]);

  async function copyText(value: string, key: string): Promise<void> {
    await window.hermesAPI.copyToClipboard(value);
    setCopied(key);
    window.setTimeout(() => {
      setCopied((current) => (current === key ? null : current));
    }, 1600);
  }

  async function handleDelete(): Promise<void> {
    // Cloud wallets are backend-managed; only local ones have a deletable
    // on-disk record (their delete button is the only way to open this modal).
    if (!deleteTarget || deleteTarget.source !== "local") return;
    setError("");
    const result = await window.hermesAPI.deleteWallet(
      profile,
      deleteTarget.id,
    );
    if (!result.success) {
      setError(result.error || t("agents.walletDeleteFailed"));
      setDeleteTarget(null);
      return;
    }
    setDeleteTarget(null);
    await loadWallets();
  }

  return (
    <div className="profile-modal-pane profile-wallet-pane">
      <div className="profile-wallet-toolbar">
        <div>
          <div className="profile-wallet-heading">
            {t("agents.walletTitle")}
          </div>
          <div className="profile-wallet-subtitle">
            {t("agents.walletNetwork", { network: BASE_NETWORK_LABEL })}
          </div>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => void loadWallets()}
          disabled={syncing}
        >
          <Refresh size={14} />
          {syncing ? t("agents.walletSyncing") : t("agents.walletSync")}
        </button>
      </div>

      {loading ? (
        <div className="profile-modal-loading">
          <div className="loading-spinner" />
        </div>
      ) : wallets.length === 0 ? (
        <div className="profile-wallet-empty">
          <Wallet size={36} />
          <span>{t("agents.walletManagedEmpty")}</span>
          {cloudNote && (
            <span className="profile-wallet-empty-note">{cloudNote}</span>
          )}
        </div>
      ) : (
        <div className="profile-wallet-list">
          {wallets.map((wallet) => (
            <div className="profile-wallet-card" key={wallet.id}>
              <div className="profile-wallet-card-main">
                <div className="profile-wallet-icon">
                  <Wallet size={18} />
                </div>
                <div className="profile-wallet-meta">
                  <div className="profile-wallet-name-row">
                    <span className="profile-wallet-name">{wallet.name}</span>
                    <span
                      className={`profile-wallet-badge profile-wallet-badge-${wallet.source}`}
                    >
                      {wallet.source === "cloud"
                        ? t("agents.walletSourceCloud")
                        : t("agents.walletSourceLocal")}
                    </span>
                    <span className="profile-wallet-network">
                      {BASE_NETWORK_LABEL}
                    </span>
                  </div>
                  <code className="profile-wallet-address">
                    {formatAddress(wallet.address)}
                  </code>
                  <div className="profile-wallet-balances">
                    {balances.get(wallet.id) ? (
                      <>
                        {balances.get(wallet.id)!.balances.map((b) => (
                          <span
                            key={b.tokenId}
                            className="profile-wallet-balance"
                            title={b.formattedFull}
                          >
                            {TOKEN_ICONS[b.tokenId] && (
                              <img
                                className="profile-wallet-balance-icon"
                                src={TOKEN_ICONS[b.tokenId]}
                                alt={b.symbol}
                              />
                            )}
                            <span className="profile-wallet-balance-symbol">
                              {b.symbol}
                            </span>
                            {b.error ? (
                              <span className="profile-wallet-balance-error">
                                {t("agents.walletBalanceUnavailable")}
                              </span>
                            ) : (
                              b.formatted
                            )}
                          </span>
                        ))}
                        <button
                          className={`profile-wallet-refresh ${balancesLoading.has(wallet.id) ? "spinning" : ""}`}
                          onClick={() => refreshSingleBalance(wallet)}
                        >
                          <Refresh size={11} />
                          {t("agents.walletBalanceRefresh")}
                        </button>
                      </>
                    ) : balancesLoading.has(wallet.id) ? (
                      <span className="profile-wallet-balance profile-wallet-balance-loading">
                        {t("agents.walletBalanceLoading")}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="profile-wallet-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => copyText(wallet.address, wallet.id)}
                >
                  {copied === wallet.id ? (
                    <Check size={14} />
                  ) : (
                    <Copy size={14} />
                  )}
                  {copied === wallet.id
                    ? t("agents.walletCopied")
                    : t("agents.walletCopyAddress")}
                </button>
                {wallet.source === "local" && (
                  <button
                    className="btn btn-danger-ghost btn-sm"
                    onClick={() => setDeleteTarget(wallet)}
                  >
                    <Trash size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {wallets.length > 0 && cloudNote && (
        <div className="profile-wallet-note">{cloudNote}</div>
      )}
      {error && <div className="agents-create-error">{error}</div>}

      <AppModal
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        className="profile-wallet-delete-modal"
        overlayClassName="profile-wallet-delete-modal-overlay"
        labelledBy="profile-wallet-delete-title"
      >
        <div className="profile-wallet-delete-header">
          <AppModalTitle
            id="profile-wallet-delete-title"
            className="profile-wallet-delete-title"
          >
            {t("agents.walletDeleteTitle")}
          </AppModalTitle>
          <button
            className="profile-modal-close"
            onClick={() => setDeleteTarget(null)}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="profile-wallet-delete-body">
          {deleteTarget && (
            <>
              <div className="profile-wallet-delete-wallet-info">
                <span className="profile-wallet-delete-wallet-name">
                  {deleteTarget.name}
                </span>
                <code className="profile-wallet-delete-wallet-address">
                  {formatAddress(deleteTarget.address)}
                </code>
              </div>
              <div className="profile-wallet-delete-warning">
                {t("agents.walletDeleteWarning")}
              </div>
              <div className="profile-wallet-delete-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setDeleteTarget(null)}
                >
                  {t("common.cancel")}
                </button>
                <button className="btn btn-danger" onClick={handleDelete}>
                  <Trash size={14} />
                  {t("agents.walletDeleteConfirmLabel")}
                </button>
              </div>
            </>
          )}
        </div>
      </AppModal>
    </div>
  );
}
