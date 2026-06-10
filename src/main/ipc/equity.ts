import { safeHandle } from "./safe-handle";
import { listBaskets, saveBasket, deleteBasket } from "../equity-baskets";
import { listAlerts, markAlertRead } from "../equity-alerts";

export function registerEquityIpc(): void {
  safeHandle("equity-list-baskets", (_event, profile?: string) =>
    listBaskets(profile),
  );
  safeHandle(
    "equity-save-basket",
    (_event, basket: unknown, profile?: string) => saveBasket(basket, profile),
  );
  safeHandle(
    "equity-delete-basket",
    (_event, basketId: string, profile?: string) =>
      deleteBasket(basketId, profile),
  );
  safeHandle("equity-list-alerts", (_event, limit?: number, profile?: string) =>
    listAlerts(limit, profile),
  );
  safeHandle(
    "equity-mark-alert-read",
    (_event, alertId: string, profile?: string) =>
      markAlertRead(alertId, profile),
  );
}
