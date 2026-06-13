export enum FailoverReason {
  AUTH = "auth",
  BILLING = "billing",
  RATE_LIMIT = "rate_limit",
  OVERLOADED = "overloaded",
  SERVER_ERROR = "server_error",
  TIMEOUT = "timeout",
  CONTEXT_OVERFLOW = "context_overflow",
  UNKNOWN = "unknown",
}

export interface ClassifiedError {
  reason: FailoverReason;
  statusCode?: number;
  message: string;
  retryable: boolean;
  shouldCompress: boolean;
  shouldRotateCredential: boolean;
  cooldownMs?: number;
}

const BILLING_PATTERNS = [
  /insufficient credits/i,
  /insufficient_quota/i,
  /insufficient balance/i,
  /credit balance/i,
  /credits have been exhausted/i,
  /top up your credits/i,
  /payment required/i,
  /billing hard limit/i,
];

const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /rate_limit/i,
  /too many requests/i,
  /retry after/i,
  /throttled/i,
  /quota exceeded/i,
];

const AUTH_PATTERNS = [
  /invalid api key/i,
  /incorrect api key/i,
  /unauthorized/i,
  /invalid_api_key/i,
  /authentication failed/i,
  /key is invalid/i,
  /unauthorized user/i,
];

const CONTEXT_OVERFLOW_PATTERNS = [
  /context_length_exceeded/i,
  /max_tokens/i,
  /maximum context length/i,
  /context window/i,
  /too long/i,
  /exceeds the limit/i,
  /maximum prompt tokens/i,
  /input tokens/i,
  /prompt_tokens/i,
];

const OVERLOADED_PATTERNS = [
  /overloaded/i,
  /too busy/i,
  /temporary outage/i,
  /rate limit of the model server/i,
  /capacity/i,
];

const TIMEOUT_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /deadline exceeded/i,
  /request timeout/i,
];

export class ErrorDoctor {
  /**
   * Classifies any API error message / status code into a Structured recovery response.
   */
  public static classify(
    errorMsg: string,
    statusCode?: number,
  ): ClassifiedError {
    const msg = errorMsg || "";

    // 1. Check HTTP status code
    if (statusCode) {
      if (statusCode === 429) {
        return {
          reason: FailoverReason.RATE_LIMIT,
          statusCode,
          message: msg,
          retryable: true,
          shouldCompress: false,
          shouldRotateCredential: true,
          cooldownMs: 60000 * 2, // 2-minute cooldown for rate limits
        };
      }
      if (statusCode === 402) {
        return {
          reason: FailoverReason.BILLING,
          statusCode,
          message: msg,
          retryable: true,
          shouldCompress: false,
          shouldRotateCredential: true,
          cooldownMs: 60000 * 60 * 24, // 24-hour cooldown for exhausted quota
        };
      }
      if (statusCode === 401 || statusCode === 403) {
        return {
          reason: FailoverReason.AUTH,
          statusCode,
          message: msg,
          retryable: true,
          shouldCompress: false,
          shouldRotateCredential: true,
          cooldownMs: 60000 * 60 * 24 * 365, // Permanent cooldown for invalid key
        };
      }
      if (statusCode === 413) {
        return {
          reason: FailoverReason.CONTEXT_OVERFLOW,
          statusCode,
          message: msg,
          retryable: true,
          shouldCompress: true,
          shouldRotateCredential: false,
        };
      }
      if (statusCode === 503 || statusCode === 504 || statusCode === 529) {
        return {
          reason: FailoverReason.OVERLOADED,
          statusCode,
          message: msg,
          retryable: true,
          shouldCompress: false,
          shouldRotateCredential: false,
          cooldownMs: 5000, // wait 5 seconds before retry
        };
      }
    }

    // 2. Check message matching patterns
    if (BILLING_PATTERNS.some((p) => p.test(msg))) {
      return {
        reason: FailoverReason.BILLING,
        statusCode,
        message: msg,
        retryable: true,
        shouldCompress: false,
        shouldRotateCredential: true,
        cooldownMs: 60000 * 60 * 24,
      };
    }

    if (RATE_LIMIT_PATTERNS.some((p) => p.test(msg))) {
      return {
        reason: FailoverReason.RATE_LIMIT,
        statusCode,
        message: msg,
        retryable: true,
        shouldCompress: false,
        shouldRotateCredential: true,
        cooldownMs: 60000 * 2,
      };
    }

    if (AUTH_PATTERNS.some((p) => p.test(msg))) {
      return {
        reason: FailoverReason.AUTH,
        statusCode,
        message: msg,
        retryable: true,
        shouldCompress: false,
        shouldRotateCredential: true,
        cooldownMs: 60000 * 60 * 24 * 365,
      };
    }

    if (CONTEXT_OVERFLOW_PATTERNS.some((p) => p.test(msg))) {
      return {
        reason: FailoverReason.CONTEXT_OVERFLOW,
        statusCode,
        message: msg,
        retryable: true,
        shouldCompress: true,
        shouldRotateCredential: false,
      };
    }

    if (OVERLOADED_PATTERNS.some((p) => p.test(msg))) {
      return {
        reason: FailoverReason.OVERLOADED,
        statusCode,
        message: msg,
        retryable: true,
        shouldCompress: false,
        shouldRotateCredential: false,
        cooldownMs: 5000,
      };
    }

    if (TIMEOUT_PATTERNS.some((p) => p.test(msg))) {
      return {
        reason: FailoverReason.TIMEOUT,
        statusCode,
        message: msg,
        retryable: true,
        shouldCompress: false,
        shouldRotateCredential: false,
        cooldownMs: 2000,
      };
    }

    // 3. Fallback to unknown
    return {
      reason: FailoverReason.UNKNOWN,
      statusCode,
      message: msg,
      retryable: false,
      shouldCompress: false,
      shouldRotateCredential: false,
    };
  }
}
