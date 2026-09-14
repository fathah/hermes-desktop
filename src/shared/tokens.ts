/** Known ERC-20 / native token metadata and balance-response types
 *  shared between the main process (RPC reads) and the renderer (UI).
 *
 *  // @lat: [[wallet-token-balances#Token Balances]] */

export interface KnownToken {
  /** Stable identifier, e.g. "eth", "hd". */
  id: string;
  /** Human-readable name, e.g. "Hermes Desktop". */
  name: string;
  /** Ticker symbol, e.g. "HD". */
  symbol: string;
  /** On-chain contract address (omitted for native ETH). */
  contractAddress?: string;
  /** Token decimals (18 for all current tokens). */
  decimals: number;
}

export interface TokenBalanceResult {
  tokenId: string;
  symbol: string;
  /** Raw BigInt balance as a decimal string, e.g. "1000000000000000000". */
  raw: string;
  /** Compact formatted balance with K/M suffixes, e.g. "10.5K". */
  formatted: string;
  /** Full formatted balance without suffixes, e.g. "10500". Used for tooltips. */
  formattedFull: string;
  /** Present when the RPC call for this token failed. */
  error?: string;
}

export interface TokenBalancesResponse {
  address: string;
  balances: TokenBalanceResult[];
  /** Epoch ms when the balances were fetched. */
  fetchedAt: number;
}

/** Live tokens on Base mainnet plus native ETH. */
export const BASE_TOKENS: KnownToken[] = [
  {
    id: "eth",
    name: "Ethereum",
    symbol: "ETH",
    decimals: 18,
  },
  {
    id: "hd",
    name: "Hermes Desktop",
    symbol: "HD",
    contractAddress: "0xfda75f77a22b4f4b783bbbb21915ef64d149bba3",
    decimals: 18,
  },
];

/** Format a raw token balance into a full human-readable string
 *  (no K/M suffixes), suitable for tooltips.
 *  - Zero → "0"
 *  - Otherwise → up to 4 significant digits with trailing zeros removed */
export function formatTokenBalanceFull(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";

  const padded = raw.padStart(decimals + 1, "0");
  const integerPart = padded.slice(0, padded.length - decimals) || "0";
  const fractionalPart = padded.slice(padded.length - decimals);
  const firstNonZero = fractionalPart.search(/[1-9]/);
  if (firstNonZero === -1) return integerPart;
  const trimmedFrac = fractionalPart.replace(/0+$/, "");

  if (integerPart !== "0") {
    const capped = trimmedFrac.slice(0, 4);
    return capped ? `${integerPart}.${capped}` : integerPart;
  }

  if (firstNonZero >= 4) return "< 0.0001";
  const significantDigits = trimmedFrac.slice(firstNonZero);
  const visible = significantDigits.slice(0, 4);
  return `0.${"0".repeat(firstNonZero)}${visible}`;
}

/** Scale a whole-token integer string down by `scaleDigits` powers of ten and
 *  render it with up to two decimal places (rounded, trailing zeros trimmed).
 *  Pure string/BigInt math so it stays exact for balances far larger than
 *  `Number.MAX_SAFE_INTEGER` — e.g. millions of 18-decimal tokens.
 *  `compactScale("10500", 3)` → "10.5" (10,500 → 10.5K). */
function compactScale(integerPart: string, scaleDigits: number): string {
  const whole = integerPart.slice(0, integerPart.length - scaleDigits) || "0";
  const fraction = integerPart.slice(integerPart.length - scaleDigits);
  // Round to two decimals using the first three scaled-away digits.
  const firstThree = (fraction + "000").slice(0, 3);
  let hundredths = Math.round(Number(firstThree) / 10); // 0..100
  let wholeNum = BigInt(whole);
  if (hundredths === 100) {
    wholeNum += 1n;
    hundredths = 0;
  }
  const fracStr = hundredths.toString().padStart(2, "0").replace(/0+$/, "");
  return fracStr ? `${wholeNum.toString()}.${fracStr}` : wholeNum.toString();
}

/** Format a raw token balance into a compact string with K/M suffixes.
 *  - Zero → "0"
 *  - ≥ 1M → e.g. "1.5M"
 *  - ≥ 1K → e.g. "10.5K"
 *  - Tiny non-zero (< 0.0001) → "< 0.0001"
 *  - Otherwise → up to 4 significant digits */
export function formatTokenBalance(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";

  // Whole-token integer part as a string — never via float, so precision holds
  // for arbitrarily large balances.
  const padded = raw.padStart(decimals + 1, "0");
  const integerPart =
    padded.slice(0, padded.length - decimals).replace(/^0+/, "") || "0";

  // > 6 digits ⇒ ≥ 1,000,000 whole tokens.
  if (integerPart.length > 6) {
    return `${compactScale(integerPart, 6)}M`;
  }

  // > 3 digits ⇒ ≥ 1,000 whole tokens.
  if (integerPart.length > 3) {
    return `${compactScale(integerPart, 3)}K`;
  }

  // Fall through to full formatting for small values.
  return formatTokenBalanceFull(raw, decimals);
}
