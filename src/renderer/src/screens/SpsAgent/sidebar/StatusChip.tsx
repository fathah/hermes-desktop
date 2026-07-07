// StatusChip.tsx — always-visible "which Hermes am I talking to?" indicator in
// the rail footer: connection mode, active agent, and a health dot. Clicking
// deep-links to the admin tab most relevant to the current state (Providers when
// no API key, Gateway when unhealthy, else connection Settings). The supervisor
// push stream keeps transient gateway states visible without hammering IPC.
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { openSettings, type AdminView } from "../../../lib/openSettings";
import type { GatewayHealthStatus } from "../../../../../shared/gateway";

type Health = "ok" | "warn" | "down";

interface Status {
  label: string; // Local / Remote / SSH <host>
  profile: string; // active agent name
  hasApiKey: boolean;
  gatewayHealth: GatewayHealthStatus;
  health: Health;
  target: AdminView; // where a click goes
  hint: string;
}

const DOT_COLOR: Record<Health, string> = {
  ok: "#3ba55d",
  warn: "#e0a100",
  down: "#d83c3c",
};

function healthLevel(status: GatewayHealthStatus): Health {
  if (status === "healthy") return "ok";
  if (status === "down") return "down";
  return "warn";
}

function gatewayHint(status: GatewayHealthStatus): string {
  switch (status) {
    case "healthy":
      return "Gateway healthy";
    case "unhealthy":
      return "Gateway unhealthy";
    case "recovering":
      return "Gateway recovering";
    case "down":
      return "Gateway down";
  }
}

function buildStatus(
  label: string,
  profile: string,
  hasApiKey: boolean,
  gatewayHealth: GatewayHealthStatus,
): Status {
  if (!hasApiKey && gatewayHealth !== "healthy") {
    return {
      label,
      profile,
      hasApiKey,
      gatewayHealth,
      health: "warn",
      target: "providers",
      hint: "No API key — add one in Providers",
    };
  }

  return {
    label,
    profile,
    hasApiKey,
    gatewayHealth,
    health: healthLevel(gatewayHealth),
    target: gatewayHealth === "healthy" ? "settings" : "gateway",
    hint: gatewayHint(gatewayHealth),
  };
}

export function StatusChip(): React.JSX.Element | null {
  const [status, setStatus] = useState<Status | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const api = window.hermesAPI;
      if (!api?.getConnectionConfig) return;
      try {
        const conn = await api.getConnectionConfig();
        const [gatewayHealth, profiles] = await Promise.all([
          api.gatewayHealthStatus
            ? api
                .gatewayHealthStatus()
                .catch(() => "down" as GatewayHealthStatus)
            : Promise.resolve("healthy" as GatewayHealthStatus),
          api.listProfiles
            ? api.listProfiles().catch(() => [])
            : Promise.resolve([]),
        ]);
        if (cancelled) return;
        const active = profiles.find((p) => p.isActive)?.name ?? "default";
        const label =
          conn.mode === "local"
            ? "Local"
            : conn.mode === "ssh"
              ? `SSH ${conn.ssh?.host ?? ""}`.trim()
              : "Remote";
        setStatus(buildStatus(label, active, conn.hasApiKey, gatewayHealth));
      } catch {
        /* offline / no gateway — leave the last good value */
      }
    };
    void load();
    const unsubscribe = window.hermesAPI.onGatewayHealthChanged?.((change) => {
      setStatus((prev) =>
        prev
          ? buildStatus(prev.label, prev.profile, prev.hasApiKey, change.status)
          : prev,
      );
    });
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      unsubscribe?.();
      clearInterval(timer);
    };
  }, []);

  if (!status) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "100%",
      }}
    >
      <button
        className="rail-status-chip"
        title={status.hint}
        aria-label={`Connection ${status.label}, profile ${status.profile}. ${status.hint}.`}
        onClick={() => openSettings(status.target)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flex: "1 1 auto",
          minWidth: 0,
          padding: "4px 10px",
          margin: 0,
          background: "none",
          border: "none",
          font: "inherit",
          fontSize: "0.72rem",
          color: "var(--muted, #888)",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: DOT_COLOR[status.health],
            flex: "none",
          }}
        />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {status.label} · {status.profile}
        </span>
      </button>
      <button
        type="button"
        title="Update Hermes Agent engine now"
        aria-label="Update Hermes Agent engine now"
        disabled={updateBusy}
        onClick={async () => {
          const api = window.hermesAPI;
          if (!api?.runHermesAgentUpdateCheck) return;
          setUpdateBusy(true);
          try {
            const result = await api.runHermesAgentUpdateCheck(status.profile, {
              autoApply: true,
            });
            setStatus((prev) =>
              prev ? { ...prev, hint: result.message || prev.hint } : prev,
            );
          } catch (err) {
            setStatus((prev) =>
              prev
                ? {
                    ...prev,
                    health: "warn",
                    hint: err instanceof Error ? err.message : String(err),
                  }
                : prev,
            );
          } finally {
            setUpdateBusy(false);
          }
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "0 0 24px",
          width: 24,
          height: 24,
          padding: 0,
          margin: 0,
          background: "none",
          border: "none",
          color: "var(--muted, #888)",
          cursor: updateBusy ? "default" : "pointer",
          opacity: updateBusy ? 0.55 : 1,
        }}
      >
        <Icon name="refresh" size={13} />
      </button>
    </div>
  );
}
