// Map a base URL to the PROVIDERS.options `value` it most likely corresponds
// to. Returns null when the URL is empty or doesn't match any known pattern,
// in which case the caller should leave the provider field untouched.
//
// Used by the Add/Edit Model dialog to pre-fill the provider dropdown so
// users entering an Ollama / LM Studio / private-network URL don't end up
// silently saving with the dialog's default (which is OpenRouter) and then
// wonder why the model card displays the wrong provider.
export function detectProviderFromUrl(rawUrl: string): string | null {
  const url = rawUrl.trim().toLowerCase();
  if (!url) return null;

  // Hosted providers — match by hostname.
  if (/(^|\/\/)openrouter\.ai(\/|:|$)/.test(url)) return "openrouter";
  if (/(^|\/\/)api\.anthropic\.com(\/|:|$)/.test(url)) return "anthropic";
  if (/(^|\/\/)api\.openai\.com(\/|:|$)/.test(url)) return "openai";
  if (/(^|\/\/)api\.aimlapi\.com(\/|:|$)/.test(url)) return "aimlapi";
  if (/(^|\/\/)generativelanguage\.googleapis\.com(\/|:|$)/.test(url))
    return "google";
  if (/(^|\/\/)api\.x\.ai(\/|:|$)/.test(url)) return "xai";
  if (/nousresearch\.com/.test(url)) return "nous";
  if (/api\.xiaomimimo\.com/.test(url)) return "xiaomi";
  if (/dashscope(-intl)?\.aliyuncs\.com/.test(url)) return "alibaba";
  if (/api\.minimax(i)?\.(chat|com)/.test(url)) return "minimax";

  // Well-known local-LLM ports on any host — Ollama 11434, LM Studio 1234,
  // Atomic Chat 1337, vLLM 8000, llama.cpp 8080. These run on LAN VMs too, so we don't
  // require a private-IP match for the port-only heuristic.
  if (/:11434(\/|$)/.test(url)) return "ollama";
  if (/:1234(\/|$)/.test(url)) return "lmstudio";
  if (/:1337(\/|$)/.test(url)) return "atomicchat";
  if (/:8000(\/|$)/.test(url)) return "vllm";
  if (/:8080(\/|$)/.test(url)) return "llamacpp";

  // Anything else pointing at a private or loopback address is almost
  // always a self-hosted OpenAI-compatible endpoint. Surface that as the
  // generic custom path when the port does not identify a known local app.
  const host = extractHost(url);
  if (host && isPrivateOrLoopback(host)) return "custom";

  return null;
}

function extractHost(url: string): string | null {
  // Strip scheme and path; accept bare host:port too.
  const stripped = url.replace(/^https?:\/\//, "").split("/")[0];
  if (!stripped) return null;
  return stripped.split(":")[0] || null;
}

function isPrivateOrLoopback(host: string): boolean {
  if (host === "localhost") return true;
  if (host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
  // RFC1918 IPv4 ranges
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  // 172.16.0.0 – 172.31.255.255
  const m = host.match(/^172\.(\d+)\./);
  if (m) {
    const second = parseInt(m[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // .local mDNS hostnames (common for self-hosted home-network services)
  if (/\.local$/.test(host)) return true;
  return false;
}
