// Alert Center — the in-app feed for the equity alert engine. Reads the alert
// log via IPC (the headless evaluator appends to equity-alerts.jsonl), live-
// updates on the `equity-alert` event the main-process watcher pushes, shows an
// unread badge, and lets you mark alerts read. Pure SPS tokens.

import React, { useCallback, useEffect, useState } from "react";

const PROFILE = "default";

interface Alert {
  id: string;
  ts: string;
  ticker: string | null;
  trigger: string;
  direction?: string;
  message: string;
  read?: boolean;
}

const TRIGGER_LABEL: Record<string, string> = {
  policy: "Policy",
  intrinsic: "Intrinsic",
  floor: "Floor",
  regime: "Regime",
};

function directionClass(direction?: string): string {
  if (direction === "positive") return "eq-alert-pos";
  if (direction === "negative") return "eq-alert-neg";
  return "eq-alert-neutral";
}

export function AlertCenter(): React.JSX.Element {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const refresh = useCallback(() => {
    void window.hermesAPI
      .equityListAlerts(200, PROFILE)
      .then((rows) => setAlerts(((rows as Alert[]) ?? []).slice().reverse()))
      .catch(() => setAlerts([]));
  }, []);

  useEffect(() => {
    refresh();
    const off = window.hermesAPI.onEquityAlert(() => refresh());
    return off;
  }, [refresh]);

  const markRead = (id: string): void => {
    void window.hermesAPI
      .equityMarkAlertRead(id, PROFILE)
      .then(() => refresh());
  };

  const unread = alerts.filter((a) => !a.read).length;

  return (
    <div className="eq-alert-center">
      <div className="eq-alert-header">
        <h2 className="eq-basket-title">Alerts</h2>
        {unread > 0 && <span className="eq-alert-badge">{unread}</span>}
      </div>

      {alerts.length === 0 ? (
        <div className="eq-empty">
          No alerts yet. Save a basket and schedule the india-equity-alerts
          skill to watch your held names for regime shifts.
        </div>
      ) : (
        <ul className="eq-alert-list">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className={`eq-alert-item ${alert.read ? "eq-alert-read" : ""}`}
            >
              <div className="eq-alert-row">
                <span
                  className={`eq-alert-tag ${directionClass(alert.direction)}`}
                >
                  {TRIGGER_LABEL[alert.trigger] ?? alert.trigger}
                </span>
                {alert.ticker && (
                  <span className="eq-alert-ticker">{alert.ticker}</span>
                )}
                <span className="eq-alert-ts">
                  {alert.ts.slice(0, 16).replace("T", " ")}
                </span>
                {!alert.read && (
                  <button
                    className="eq-alert-mark"
                    onClick={() => markRead(alert.id)}
                  >
                    Mark read
                  </button>
                )}
              </div>
              <div className="eq-alert-msg">{alert.message}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
