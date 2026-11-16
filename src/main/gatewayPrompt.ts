import type { BrowserWindow } from "electron";
import { showPasswordDialog } from "./askpass";
import type { GatewayServerRequest } from "../shared/gateway-server-requests";

/**
 * Mid-turn gateway credential prompts (`sudo.request` / `secret.request`).
 *
 * Unlike `clarify.request` — which renders an inline card in the chat
 * transcript — a sudo password or a secret value is sensitive and must NEVER
 * land in scrollback. So these reuse the installer's hardened askpass modal
 * (`showPasswordDialog`): CSP-locked `default-src 'none'`, sandboxed, ephemeral
 * data-URL, the value never persisted.
 *
 * Gateway protocol (NousResearch/hermes-agent, tui_gateway/server.py), keyed by
 * request_id:
 *   sudo.request   {}                          -> sudo.respond   { request_id, password }
 *   secret.request { prompt, env_var, ... }     -> secret.respond { request_id, value }
 * An empty answer is a safe "skip": the gateway treats secret.request as
 * skipped and lets a terminal sudo prompt fail cleanly, so cancel maps to "".
 */

let parentWindowGetter: () => BrowserWindow | null = () => null;

/** Wire the provider that returns the window to parent the modal to. Called
 *  once from index.ts after the main window is created. */
export function setGatewayPromptParent(
  getter: () => BrowserWindow | null,
): void {
  parentWindowGetter = getter;
}

/**
 * Prompt for the sudo password. Resolves with the password, or "" if the user
 * cancels (safe skip — terminal sudo then fails cleanly rather than hanging).
 */
export async function promptSudoPassword(
  signal?: AbortSignal,
): Promise<string> {
  const parent = parentWindowGetter();
  const value = await showPasswordDialog(
    parent,
    "An agent command needs administrator (sudo) access to continue. " +
      "Your password is sent only to the requesting Hermes Agent's sudo prompt and is never stored.",
    {
      title: "Administrator Password Required",
      heading: "Hermes needs your sudo password",
      signal,
    },
  );
  return value ?? "";
}

/**
 * Prompt for a named secret the agent requested (e.g. an API key it needs to
 * store). Resolves with the value, or "" if the user cancels (safe skip — the
 * gateway records the secret as skipped).
 */
export async function promptSecretValue(
  envVar: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const parent = parentWindowGetter();
  const detail =
    (prompt && prompt.trim()) ||
    `The agent is requesting a value for ${envVar || "a secret"}.`;
  const value = await showPasswordDialog(parent, detail, {
    title: "Secret Required",
    heading: envVar
      ? `Hermes needs a value for ${envVar}`
      : "Hermes needs a secret value",
    signal,
  });
  return value ?? "";
}

/** Sensitive RPC answers stay between this main-process modal and Agent. */
export async function collectGatewayRequestValue(
  request: GatewayServerRequest,
  signal?: AbortSignal,
): Promise<{ value: string } | null> {
  if (signal?.aborted) return null;
  if (request.method === "sudo") {
    return { value: await promptSudoPassword(signal) };
  }
  if (request.method === "secret") {
    if (
      typeof request.params.env_var !== "string" ||
      request.params.env_var.length > 256
    )
      return null;
    return {
      value: await promptSecretValue(
        request.params.env_var,
        typeof request.params.prompt === "string"
          ? request.params.prompt.slice(0, 16_384)
          : "",
        signal,
      ),
    };
  }
  if (
    request.method === "vault.unlock_prompt" ||
    request.method === "vault.code"
  ) {
    const detail =
      request.method === "vault.unlock_prompt"
        ? `Unlock ${typeof request.params.display_name === "string" ? request.params.display_name.slice(0, 256) : "the requested password manager"}.`
        : `Enter the one-time code for ${typeof request.params.site === "string" ? request.params.site.slice(0, 256) : "the requested site"}.`;
    return { value: await promptSecretValue("", detail, signal) };
  }
  return null;
}
