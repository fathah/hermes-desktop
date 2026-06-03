// ids.ts — id generation + block factory. Ported from data.jsx (uid, blk).
import type { Block, BlockType } from "../types";

let _id = 0;
const _seed = Math.random().toString(36).slice(2, 6);

/** Monotonic, per-session-unique id with a short prefix (matches prototype). */
export const uid = (p = "b"): string => `${p}${_seed}${++_id}`;

/** Block factory. `extra` carries type-specific fields (done, emoji, view, …). */
export const blk = (
  type: BlockType,
  text = "",
  extra: Partial<Block> = {},
): Block => ({
  id: uid(),
  type,
  text,
  ...extra,
});
