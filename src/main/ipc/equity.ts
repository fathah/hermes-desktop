import { ipcMain } from "electron";
import { listBaskets, saveBasket, deleteBasket } from "../equity-baskets";
import { listAlerts, markAlertRead } from "../equity-alerts";

export function registerEquityIpc(): void {
  ipcMain.handle("equity-list-baskets", (_event, profile?: string) =>
    listBaskets(profile),
  );
  ipcMain.handle(
    "equity-save-basket",
    (_event, basket: unknown, profile?: string) => saveBasket(basket, profile),
  );
  ipcMain.handle(
    "equity-delete-basket",
    (_event, basketId: string, profile?: string) =>
      deleteBasket(basketId, profile),
  );
  ipcMain.handle(
    "equity-list-alerts",
    (_event, limit?: number, profile?: string) => listAlerts(limit, profile),
  );
  ipcMain.handle(
    "equity-mark-alert-read",
    (_event, alertId: string, profile?: string) =>
      markAlertRead(alertId, profile),
  );
}
