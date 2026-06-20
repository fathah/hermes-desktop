/**
 * StreamRedactor detects and redacts sensitive API keys or tokens in a stream of chunks.
 * Uses a sliding window buffer to handle secrets that might be split across arbitrary chunk boundaries.
 */
export class StreamRedactor {
  private secrets: string[];
  private buffer = "";

  constructor(
    secrets: string[],
    options: { redactShortSecrets?: boolean } = {},
  ) {
    this.secrets = secrets.filter((s) => {
      if (typeof s !== "string" || !s.trim()) return false;
      return options.redactShortSecrets || s.trim().length > 8;
    });
  }

  /**
   * Process an incoming stream chunk, buffering potential matches and redacting fully matched secrets.
   * Returns the safe chunk subset that can be emitted immediately.
   */
  public process(chunk: string): { chunkToEmit: string } {
    if (this.secrets.length === 0) {
      return { chunkToEmit: chunk };
    }

    this.buffer += chunk;

    // First, redact any complete secrets in the buffer
    for (const secret of this.secrets) {
      this.buffer = this.buffer.replaceAll(secret, "[REDACTED]");
    }

    // Check for partial matches at the end of the buffer.
    // If the end of the buffer matches the start of any secret,
    // we must hold back that portion of the buffer.
    let maxOverlap = 0;
    for (const secret of this.secrets) {
      // We only care about prefix overlaps up to secret.length - 1
      for (
        let len = Math.min(this.buffer.length, secret.length - 1);
        len > 0;
        len--
      ) {
        const bufferSuffix = this.buffer.slice(-len);
        const secretPrefix = secret.slice(0, len);
        if (bufferSuffix === secretPrefix) {
          if (len > maxOverlap) {
            maxOverlap = len;
          }
          break; // Found the longest overlap for this secret
        }
      }
    }

    const flushLength = this.buffer.length - maxOverlap;
    if (flushLength > 0) {
      const chunkToEmit = this.buffer.slice(0, flushLength);
      this.buffer = this.buffer.slice(flushLength);
      return { chunkToEmit };
    }

    return { chunkToEmit: "" };
  }

  /**
   * Flush any remaining buffered content after redacting any full secrets.
   */
  public flush(): string {
    let final = this.buffer;
    for (const secret of this.secrets) {
      final = final.replaceAll(secret, "[REDACTED]");
    }
    this.buffer = "";
    return final;
  }
}
