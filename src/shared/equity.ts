// Shared equity IPC types — single source of truth for baskets and alerts.
// Producers: src/main/equity-baskets.ts, src/main/equity-alerts.ts.
// Contract: src/preload/index.d.ts.

export interface EquityBasketHolding {
  ticker: string;
  exchange?: string;
  qty?: number;
  avg_cost?: number;
}

export interface EquityBasket {
  id: string;
  name: string;
  created_at: string;
  holdings: EquityBasketHolding[];
}

export interface EquityAlert {
  id: string;
  ts: string;
  ticker: string | null;
  trigger: string;
  direction?: string;
  message: string;
  read?: boolean;
}
