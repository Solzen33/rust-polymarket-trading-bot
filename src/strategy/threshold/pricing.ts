import type { TokenPrice } from "../../types.js";

/** Mid from CLOB best bid/ask; null if either side missing. */
export function midFromTokenPrice(tp: TokenPrice | null): number | null {
  if (!tp || tp.bid == null || tp.ask == null) return null;
  return (tp.bid + tp.ask) / 2;
}

/** True when price crosses from strictly below `level` to at/above `level`. */
export function crossedAbove(
  previousMid: number | null,
  currentMid: number | null,
  level: number
): boolean {
  if (currentMid == null) return false;
  if (previousMid == null) return false;
  return previousMid < level && currentMid >= level;
}
