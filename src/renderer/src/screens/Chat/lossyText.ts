// @lat: [[chat-commands#Slash command execution#Completion text reconciliation]]

/**
 * A CJK "word" is usually 1-2 characters, so a fixed 3-character run is
 * much weaker evidence of genuine continuity there than in English (where
 * it is often most of a word): the small effective alphabet per position
 * lets an unrelated run recur by coincidence. `DENSE_SCRIPT_MIN_RUN` asks
 * for a longer, exponentially rarer run once dense-script text is involved.
 */
// A hand-enumerated range table is a fragile way to answer "is this
// character CJK ideographic": it silently omits whichever block nobody
// thought to add (Extensions C-I and the Compatibility Ideographs
// Supplement, missed here originally). \p{Script=...} is the Unicode
// database itself, so it can't go stale the same way. Han alone covers
// every Unified/Extension/Compatibility ideograph block, BMP and
// supplementary plane; Hiragana/Katakana/Hangul are separate scripts and
// stay listed explicitly.
const DENSE_SCRIPT_RE =
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
// Known limitation: a genuine chunk-dropped copy whose surviving contiguous
// run between two drops is shorter than this can be missed (false negative,
// the damaged stream is not reconciled). Lowering the run for dense-script
// text reopens the false positive this constant exists to prevent (#793):
// unrelated CJK text can share a 3-char run by coincidence, and a synthetic
// counterexample sits at a similar coverage (0.31) to a genuine short-run
// chunk-drop (0.54), so a coverage-gated fallback is not a safe fix without
// real streaming data to calibrate the threshold against.
const DENSE_SCRIPT_MIN_RUN = 6;

function isDenseScriptChar(char: string): boolean {
  return DENSE_SCRIPT_RE.test(char);
}

function isDenseScriptHeavy(s: string): boolean {
  const chars = [...s];
  if (chars.length === 0) return false;
  const denseCount = chars.filter(isDenseScriptChar).length;
  return denseCount / chars.length > 0.3;
}

/**
 * Detect whether `partial` looks like a chunk-dropped copy of `full`.
 *
 * A stream assembled with dropped delta chunks is a concatenation of
 * **contiguous substrings** of the canonical text, in order — e.g.
 * "! What are we working on?" for "Hey! What are we working on today?", or
 * "Sat planet from the Sun" for "Saturn is the sixth planet from the Sun".
 *
 * A plain character-subsequence test is too loose: unrelated English
 * sentences often embed as scattered 1–2 character fragments, which would
 * make a genuine pre-tool-call segment (or a distinct short reasoning
 * segment) look like a damaged copy and get erased. So the match is greedy
 * over runs: every matched segment must be at least `minRun` characters
 * (the last segment may be shorter — a trailing "?" survives chunking), with
 * arbitrary gaps between runs. On top of the shape test, callers get
 * coverage guards: the partial must be non-trivial (≥ `minLength`) and cover
 * a substantial share of the full text (≥ `minCoverage`), so a tiny
 * fragment can never cancel a long canonical text.
 *
 * Inputs are expected to be whitespace-normalized by the caller.
 */
export function isLossyChunkCopy(
  partial: string,
  full: string,
  {
    minRun,
    minLength = 12,
    minCoverage = 0.3,
  }: { minRun?: number; minLength?: number; minCoverage?: number } = {},
): boolean {
  if (!partial || !full) return false;
  if (partial.length < minLength) return false;
  if (partial.length >= full.length) return false;
  if (partial.length < minCoverage * full.length) return false;

  const run =
    minRun ??
    (isDenseScriptHeavy(partial) || isDenseScriptHeavy(full)
      ? DENSE_SCRIPT_MIN_RUN
      : 3);

  // `run` counts CHARACTERS, and a JS string index counts UTF-16 code
  // units: a supplementary-plane ideograph (Extension B and later) is a
  // surrogate pair, two code units per character. Indexing `partial`/`full`
  // directly would silently measure a "6-unit" probe as 3 real ideographs
  // for exactly the dense-script text this run length exists to protect.
  // Work over code-point arrays instead so `probeLen`/`len` below are
  // character counts, matching what `run` means.
  const partialChars = [...partial];
  const fullChars = [...full];

  let i = 0; // position in partialChars
  let j = 0; // position in fullChars
  while (i < partialChars.length) {
    const remaining = partialChars.length - i;
    const probeLen = Math.min(run, remaining);
    const at = indexOfSeq(fullChars, partialChars, i, probeLen, j);
    if (at < 0) return false;
    // A short trailing probe (the final run) may be under `run`; any other
    // run must anchor with at least `run` matching characters.
    if (probeLen < run && remaining > probeLen) return false;
    // Extend the run as far as the two texts agree.
    let len = probeLen;
    while (
      i + len < partialChars.length &&
      at + len < fullChars.length &&
      partialChars[i + len] === fullChars[at + len]
    ) {
      len++;
    }
    i += len;
    j = at + len;
  }
  return true;
}

// Find the first index >= `from` in `haystack` where the `len`-character
// slice `needle[start..start+len)` occurs contiguously, character by
// character (never joining back to a string, which would reintroduce the
// UTF-16-code-unit measurement `isLossyChunkCopy` exists to avoid).
function indexOfSeq(
  haystack: string[],
  needle: string[],
  start: number,
  len: number,
  from: number,
): number {
  outer: for (let k = from; k <= haystack.length - len; k++) {
    for (let m = 0; m < len; m++) {
      if (haystack[k + m] !== needle[start + m]) continue outer;
    }
    return k;
  }
  return -1;
}
