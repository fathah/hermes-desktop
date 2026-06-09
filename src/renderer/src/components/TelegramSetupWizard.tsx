// TelegramSetupWizard.tsx — a beginner-first, secure Telegram setup flow. Used
// both as an optional onboarding step and on demand (Settings / the Scheduled
// modal). Self-styled (no .sps-scope dependency) so it renders in either place.
//
// Steps: intro + safety → create a bot (BotFather) + paste token (restart
// gateway) → pair YOUR account (message bot → paste the code it replies with →
// allowlist exactly you) → done. The allowlist (only your Telegram id) + pairing
// approval are the load-bearing security controls.
import { useEffect, useState } from "react";

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

export function TelegramSetupWizard({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone?: () => void;
}): React.JSX.Element {
  const [step, setStep] = useState<Step>("intro");
  const [token, setToken] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [scope, setScope] = useState<Scope>("?");

  const loadScope = async (): Promise<void> => {
    try {
      const s = await window.hermesAPI.telegramGetScope?.();
      setScope((s as Scope) ?? "?");
    } catch {
      setScope("?");
    }
  };

  // If Telegram is already connected, open straight to the manage/status view.
  useEffect(() => {
    void (async () => {
      try {
        const platforms = await window.hermesAPI.getPlatformEnabled();
        if (platforms?.telegram) {
          await loadScope();
          setStep("manage");
        }
      } catch {
        /* not connected — stay on intro */
      }
    })();
  }, []);

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
