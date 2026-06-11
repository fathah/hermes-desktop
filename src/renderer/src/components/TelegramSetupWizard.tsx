// TelegramSetupWizard.tsx — a beginner-first, secure Telegram setup flow. Used
// both as an optional onboarding step and on demand (Settings / the Scheduled
// modal). Self-styled (no .sps-scope dependency) so it renders in either place.
//
// Steps: intro + safety → create a bot (BotFather) + paste token (restart
// gateway) → pair YOUR account (message bot → paste the code it replies with →
// allowlist exactly you) → done. The allowlist (only your Telegram id) + pairing
// approval are the load-bearing security controls.
import { useEffect, useState } from "react";
import type { TelegramStatus } from "../../../shared/telegram-status";

const box: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};
const card: React.CSSProperties = {
  width: 560,
  maxWidth: "92vw",
  background: "#1b1b1d",
  color: "#eee",
  border: "1px solid #333",
  borderRadius: 12,
  padding: 24,
  fontSize: 14,
  lineHeight: 1.5,
};
const btn: React.CSSProperties = {
  background: "#d8a23a",
  color: "#1b1b1d",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontWeight: 600,
  cursor: "pointer",
};
const ghost: React.CSSProperties = {
  background: "transparent",
  color: "#bbb",
  border: "1px solid #444",
  borderRadius: 8,
  padding: "8px 16px",
  cursor: "pointer",
};
const input: React.CSSProperties = {
  width: "100%",
  background: "#111",
  color: "#eee",
  border: "1px solid #444",
  borderRadius: 8,
  padding: "8px 10px",
  marginTop: 6,
};

type Step = "intro" | "token" | "pair" | "done" | "manage";
type Scope = "read-info" | "broad" | "custom" | "?";

/** Map the live Telegram status to a short label + colour for the status pill. */
function statusDisplay(s: TelegramStatus | null): {
  text: string;
  color: string;
} {
  if (!s) return { text: "Checking…", color: "#888" };
  switch (s.state) {
    case "active":
      return {
        text: `Online — @${s.botUsername} is connected`,
        color: "#7ec77e",
      };
    case "gateway-stopped":
      return {
        text: `Token OK (@${s.botUsername}) — gateway stopped, bot offline`,
        color: "#e0a33a",
      };
    case "invalid-token":
      return { text: "Bot token rejected by Telegram", color: "#e88" };
    case "unreachable":
      return { text: "Couldn’t reach Telegram to verify", color: "#e0a33a" };
    case "not-configured":
      return { text: "Not configured", color: "#888" };
  }
}

export function TelegramSetupWizard({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone?: () => void;
}): React.JSX.Element {
  const [step, setStep] = useState<Step>("intro");
  const [token, setToken] = useState("");
  const [allowedUsers, setAllowedUsers] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [scope, setScope] = useState<Scope>("?");
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [revoking, setRevoking] = useState<string | null>(null);

  const loadScope = async (): Promise<void> => {
    try {
      const s = await window.hermesAPI.telegramGetScope?.();
      setScope((s as Scope) ?? "?");
    } catch {
      setScope("?");
    }
  };

  const loadStatus = async (): Promise<void> => {
    setStatusBusy(true);
    try {
      const s = await window.hermesAPI.telegramCheckStatus?.();
      setStatus(s ?? null);
    } catch {
      setStatus(null);
    } finally {
      setStatusBusy(false);
    }
  };

  // Connected accounts come from the gateway's channel directory (the chats the
  // bot has talked to) — the actionable set for "remove access".
  const loadAccounts = async (): Promise<void> => {
    try {
      const avail = await window.hermesAPI.srTelegramAvailability?.();
      setAccounts(avail?.targets ?? []);
    } catch {
      setAccounts([]);
    }
  };

  const revokeAccount = async (id: string): Promise<void> => {
    setRevoking(id);
    setNote("");
    try {
      const res = await window.hermesAPI.revokePairing(id, undefined);
      if (!res.success) {
        setNote(res.output || "Couldn't remove that account.");
      }
      await loadAccounts();
    } catch (e) {
      setNote("Error: " + (e as Error).message);
    } finally {
      setRevoking(null);
    }
  };

  // If Telegram is already connected, open straight to the manage/status view.
  useEffect(() => {
    void (async () => {
      try {
        const platforms = await window.hermesAPI.getPlatformEnabled();
        if (platforms?.telegram) {
          await Promise.all([loadScope(), loadStatus(), loadAccounts()]);
          setStep("manage");
        }
      } catch {
        /* not connected — stay on intro */
      }
    })();
  }, []);

  // Refresh the live status + connected accounts whenever the manage view opens
  // (e.g. arriving from the "done" step after a fresh pairing).
  useEffect(() => {
    if (step !== "manage") return;
    void loadScope();
    void loadStatus();
    void loadAccounts();
  }, [step]);

  const lockReadInfo = async (): Promise<void> => {
    setBusy(true);
    try {
      await window.hermesAPI.telegramSetReadInfoScope?.();
      await loadScope();
    } finally {
      setBusy(false);
    }
  };

  const killSwitch = async (): Promise<void> => {
    setBusy(true);
    try {
      await window.hermesAPI.setPlatformEnabled("telegram", false, undefined);
      setNote(
        "Remote control disabled. Your bot will no longer act on messages.",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveToken = async (): Promise<void> => {
    const t = token.trim();
    if (!t) return;
    setBusy(true);
    setNote("Saving token and restarting the gateway…");
    try {
      await window.hermesAPI.setEnv("TELEGRAM_BOT_TOKEN", t, undefined);
      // Optional allowlist: who (besides the paired account) may command the
      // bot. Empty leaves it unset — the pairing approval is still the gate.
      const allow = allowedUsers.trim();
      if (allow) {
        await window.hermesAPI.setEnv(
          "TELEGRAM_ALLOWED_USERS",
          allow,
          undefined,
        );
      }
      await window.hermesAPI.setPlatformEnabled("telegram", true, undefined);
      // Security default: scope the Telegram agent to read/info-only (no
      // terminal/file/computer-use). This also restarts the gateway so the token
      // + scope take effect.
      await window.hermesAPI.telegramSetReadInfoScope?.();
      setNote("");
      setStep("pair");
    } catch (e) {
      setNote("Couldn't save: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const approve = async (): Promise<void> => {
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    setNote("");
    try {
      const res = await window.hermesAPI.approvePairing(c, undefined);
      if (res.success) {
        setStep("done");
      } else {
        setNote(res.output || "That code didn't work — try again.");
      }
    } catch (e) {
      setNote("Error: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={box} onMouseDown={onClose}>
      <div style={card} onMouseDown={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>📱 Connect Telegram</h2>

        {step === "intro" && (
          <>
            <p>
              Connect a Telegram bot so Hermes can message you (e.g. scheduled
              research updates) and you can ask it things from your phone.
            </p>
            <p style={{ color: "#bbb" }}>
              <strong>Safety:</strong> only <em>you</em> will be able to command
              it — we allowlist your Telegram account and nobody else&apos;s.
              You&apos;ll approve your own account in a moment. For extra
              protection, turn on Two-Step Verification in Telegram.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button style={btn} onClick={() => setStep("token")}>
                Get started
              </button>
              <button style={ghost} onClick={onClose}>
                Maybe later
              </button>
            </div>
          </>
        )}

        {step === "token" && (
          <>
            <p>
              <strong>1.</strong> Open Telegram and message{" "}
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noreferrer"
                style={{ color: "#d8a23a" }}
              >
                @BotFather
              </a>
              . Send <code>/newbot</code>, pick a name, and it gives you a{" "}
              <strong>token</strong> (a long line like <code>123456:ABC-…</code>
              ).
            </p>
            <p>
              <strong>2.</strong> Paste that token here:
            </p>
            <input
              style={input}
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="123456789:ABCdef…"
            />
            <p style={{ marginTop: 14, marginBottom: 0 }}>
              <strong>Allowed accounts</strong>{" "}
              <span style={{ color: "#888" }}>(optional)</span>
            </p>
            <p style={{ color: "#bbb", marginTop: 4, fontSize: 13 }}>
              Telegram user IDs or @usernames allowed to command the bot, comma
              separated. Leave blank — you&apos;ll still approve your own
              account next.
            </p>
            <input
              style={input}
              value={allowedUsers}
              onChange={(e) => setAllowedUsers(e.target.value)}
              placeholder="123456789, @you"
            />
            {note && <p style={{ color: "#d88", marginTop: 8 }}>{note}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                style={btn}
                onClick={() => void saveToken()}
                disabled={busy || !token.trim()}
              >
                {busy ? "Connecting…" : "Save & continue"}
              </button>
              <button style={ghost} onClick={() => setStep("intro")}>
                Back
              </button>
            </div>
          </>
        )}

        {step === "pair" && (
          <>
            <p>
              <strong>3.</strong> In Telegram, open <em>your new bot</em> and
              send it any message (e.g. <code>hi</code>).
            </p>
            <p>
              It will reply with a <strong>pairing code</strong>. Paste that
              code here to authorise <em>your</em> account (and only yours):
            </p>
            <input
              style={input}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="pairing code from the bot"
            />
            {note && <p style={{ color: "#d88", marginTop: 8 }}>{note}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                style={btn}
                onClick={() => void approve()}
                disabled={busy || !code.trim()}
              >
                {busy ? "Approving…" : "Approve my account"}
              </button>
              <button style={ghost} onClick={() => setStep("token")}>
                Back
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <p>
              ✅{" "}
              <strong>Telegram is connected and paired to your account.</strong>
            </p>
            <p style={{ color: "#bbb" }}>
              Scheduled research can now push updates to you, and you can
              message your bot to ask things. Only your account can command it.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button style={btn} onClick={() => setStep("manage")}>
                Manage
              </button>
              <button
                style={ghost}
                onClick={() => {
                  onDone?.();
                  onClose();
                }}
              >
                Done
              </button>
            </div>
          </>
        )}

        {step === "manage" && (
          <>
            <p>
              ✅ <strong>Telegram is connected.</strong> You can message your
              bot to ask things, and scheduled research can push to you.
            </p>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                border: "1px solid #333",
                borderRadius: 8,
                padding: "10px 12px",
                margin: "12px 0",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: statusDisplay(status).color,
                  flexShrink: 0,
                }}
              />
              <span style={{ color: statusDisplay(status).color, flex: 1 }}>
                {statusBusy ? "Checking…" : statusDisplay(status).text}
              </span>
              <button
                style={{ ...ghost, padding: "4px 10px" }}
                disabled={statusBusy}
                onClick={() => void loadStatus()}
              >
                Recheck
              </button>
            </div>
            <div
              style={{
                border: "1px solid #333",
                borderRadius: 8,
                padding: 12,
                margin: "12px 0",
              }}
            >
              <div style={{ marginBottom: 8 }}>
                <strong>Capability:</strong>{" "}
                {scope === "read-info" ? (
                  <span style={{ color: "#7ec77e" }}>
                    Read &amp; info only ✓ (no commands or file changes)
                  </span>
                ) : scope === "broad" ? (
                  <span style={{ color: "#e0a33a" }}>
                    Broad — the agent can run commands / change files
                  </span>
                ) : scope === "custom" ? (
                  <span style={{ color: "#bbb" }}>Custom</span>
                ) : (
                  <span style={{ color: "#888" }}>checking…</span>
                )}
              </div>
              {scope === "broad" && (
                <button
                  style={btn}
                  disabled={busy}
                  onClick={() => void lockReadInfo()}
                >
                  {busy ? "Applying…" : "Lock to read/info only"}
                </button>
              )}
            </div>
            <div
              style={{
                border: "1px solid #333",
                borderRadius: 8,
                padding: 12,
                margin: "12px 0",
              }}
            >
              <div style={{ marginBottom: 8 }}>
                <strong>Connected accounts</strong>
              </div>
              {accounts.length === 0 ? (
                <p style={{ color: "#888", margin: 0, fontSize: 13 }}>
                  No accounts have connected yet. Message your bot to pair.
                </p>
              ) : (
                accounts.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "6px 0",
                    }}
                  >
                    <span style={{ flex: 1 }}>
                      {a.name} <span style={{ color: "#888" }}>({a.id})</span>
                    </span>
                    <button
                      style={{
                        ...ghost,
                        padding: "4px 10px",
                        borderColor: "#a44",
                        color: "#e88",
                      }}
                      disabled={revoking === a.id}
                      onClick={() => void revokeAccount(a.id)}
                    >
                      {revoking === a.id ? "Removing…" : "Remove access"}
                    </button>
                  </div>
                ))
              )}
            </div>
            <p style={{ color: "#bbb", fontSize: 13 }}>
              <strong>Security:</strong> only your paired account can command
              it. Anything sensitive is gated by an approval prompt. Turn on
              Two-Step Verification in Telegram for extra protection.
            </p>
            {note && <p style={{ color: "#d88" }}>{note}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button style={ghost} onClick={() => setStep("pair")}>
                Re-pair an account
              </button>
              <button
                style={{ ...ghost, borderColor: "#a44", color: "#e88" }}
                disabled={busy}
                onClick={() => void killSwitch()}
              >
                Disable remote control
              </button>
              <button
                style={btn}
                onClick={() => {
                  onDone?.();
                  onClose();
                }}
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
