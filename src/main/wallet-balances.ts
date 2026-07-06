/** On-chain token-balance reads for Base mainnet wallets.
 *
 *  Uses ethers v6's JsonRpcProvider and Contract for read-only calls.
 *  No keys or signing — only balance queries.
 *
 *  // @lat: [[wallet-token-balances#Token Balances]] */

import { JsonRpcProvider, Contract } from "ethers";
import {
  BASE_TOKENS,
  formatTokenBalance,
  formatTokenBalanceFull,
  type TokenBalanceResult,
  type TokenBalancesResponse,
} from "../shared/tokens";

const BASE_RPC_URL = "https://mainnet.base.org";
const RPC_TIMEOUT_MS = 10_000;

/** Minimal ERC-20 ABI — only balanceOf is needed. */
const ERC20_ABI = ["function balanceOf(address owner) view returns (uint256)"];

/** Reject `promise` with a descriptive error if it does not settle within
 *  `ms`. ethers v6's `JsonRpcProvider` has no default per-request timeout, so
 *  without this a hung RPC would leave a balance chip spinning forever. The
 *  timer is `unref`-ed so it never keeps the process alive on its own. */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    (timer as { unref?: () => void }).unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Lazy singleton provider — created once and reused across calls. */
let _provider: JsonRpcProvider | null = null;

function getProvider(): JsonRpcProvider {
  if (!_provider) {
    _provider = new JsonRpcProvider(BASE_RPC_URL, undefined, {
      staticNetwork: true,
      batchMaxCount: 10,
    });
  }
  return _provider;
}

/** Fetch native ETH + all configured ERC-20 token balances for a wallet
 *  address on Base mainnet.
 *
 *  Uses `Promise.allSettled()` so one token failure does not block the
 *  others — each failed token gets an `error` field in its result. */
export async function getTokenBalances(
  address: string,
  timeoutMs: number = RPC_TIMEOUT_MS,
): Promise<TokenBalancesResponse> {
  const provider = getProvider();

  const results = await Promise.allSettled(
    BASE_TOKENS.map(async (token): Promise<TokenBalanceResult> => {
      let raw: string;
      if (token.contractAddress) {
        const contract = new Contract(
          token.contractAddress,
          ERC20_ABI,
          provider,
        );
        const balance = await withTimeout(
          contract.balanceOf(address),
          timeoutMs,
          `${token.symbol} balanceOf`,
        );
        raw = balance.toString();
      } else {
        // Native ETH balance
        const balance = await withTimeout(
          provider.getBalance(address),
          timeoutMs,
          `${token.symbol} balance`,
        );
        raw = balance.toString();
      }
      return {
        tokenId: token.id,
        symbol: token.symbol,
        raw,
        formatted: formatTokenBalance(raw, token.decimals),
        formattedFull: formatTokenBalanceFull(raw, token.decimals),
      };
    }),
  );

  const balances: TokenBalanceResult[] = results.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    const token = BASE_TOKENS[index];
    return {
      tokenId: token.id,
      symbol: token.symbol,
      raw: "0",
      formatted: "0",
      formattedFull: "0",
      error:
        (result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)) || "RPC error",
    };
  });

  return { address, balances, fetchedAt: Date.now() };
}
