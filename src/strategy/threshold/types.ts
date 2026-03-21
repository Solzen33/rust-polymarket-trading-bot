/**
 * Shared types for the UP/DOWN threshold strategy (buy on cross, TP/SL per position).
 * Prices are Polymarket-style decimals in [0, 1] (e.g. 0.45 = 45¢).
 */

import type { TradingAssetKey } from "../../trading-assets.js";

export type TokenSide = "UP" | "DOWN";

export type PositionStatus = "open" | "closed";

export type CloseReason =
  | "take_profit"
  | "stop_loss"
  | "period_rollover"
  | "late_take_profit"
  | "late_stop_loss";

/** Standard = 0.45 cross + TP/SL; late_phase = last N seconds, 0.85 buy → 0.95 sell. */
export type PositionEntryKind = "standard" | "late_phase";

export interface Position {
  id: string;
  /** Which underlying 15m market (btc / eth / solana / xrp). */
  assetKey: TradingAssetKey;
  /** Gamma slug at entry (e.g. btc-updown-15m-1739462400). */
  marketSlug: string;
  tokenSide: TokenSide;
  tokenId: string;
  conditionId: string;
  /** Mid price at entry signal (0–1). */
  buyPrice: number;
  /** How this position was opened (affects exit rules). */
  entryKind: PositionEntryKind;
  shares: number;
  openedAtMs: number;
  periodTimestamp: number;
  status: PositionStatus;
  closedAtMs?: number;
  closeReason?: CloseReason;
  closePrice?: number;
  /** Optional CLOB order id for live mode. */
  buyOrderId?: string;
  sellOrderId?: string;
}
