/**
 * Append-only trade history: one JSON line per event under `history/YYYY-MM-DD.jsonl` (UTC day of close).
 */

import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { Position, PositionEntryKind } from "./strategy/threshold/types.js";
import type { TradingAssetKey } from "./trading-assets.js";

export const HISTORY_KIND_TRADE_CLOSE = "trade_close" as const;
export const HISTORY_KIND_SESSION = "session" as const;

export interface TradeCloseHistoryRow {
  kind: typeof HISTORY_KIND_TRADE_CLOSE;
  v: 1;
  /** ISO-8601 when the row was written */
  recordedAt: string;
  simulation: boolean;
  assetKey: TradingAssetKey;
  marketSlug: string;
  periodTimestamp: number;
  conditionId: string;
  positionId: string;
  entryKind: PositionEntryKind;
  side: "UP" | "DOWN";
  shares: number;
  buyPrice: number;
  closePrice: number;
  closeReason: string;
  cost: number;
  proceeds: number;
  pnl: number;
  openedAtMs: number;
  closedAtMs: number;
  buyOrderId?: string;
  sellOrderId?: string;
}

export interface SessionHistoryRow {
  kind: typeof HISTORY_KIND_SESSION;
  v: 1;
  recordedAt: string;
  simulation: boolean;
  assets: TradingAssetKey[];
}

export type HistoryRow = TradeCloseHistoryRow | SessionHistoryRow;

function utcDayFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export class TradeHistoryWriter {
  private readonly dir: string;
  private chain: Promise<void> = Promise.resolve();

  constructor(options?: { historyDir?: string }) {
    this.dir = options?.historyDir ?? join(process.cwd(), "history");
  }

  private enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.then(task).catch((e) => {
      console.error("[history] write failed:", e);
    });
  }

  async appendSession(row: Omit<SessionHistoryRow, "kind" | "v" | "recordedAt">): Promise<void> {
    const full: SessionHistoryRow = {
      kind: HISTORY_KIND_SESSION,
      v: 1,
      recordedAt: new Date().toISOString(),
      ...row,
    };
    const day = utcDayFromMs(Date.now());
    const path = join(this.dir, `${day}.jsonl`);
    const line = `${JSON.stringify(full)}\n`;
    await mkdir(this.dir, { recursive: true });
    await appendFile(path, line, "utf8");
  }

  /** Queue a trade_close row (file chosen by closedAtMs UTC date). */
  appendTradeClose(
    closed: Position,
    meta: { simulation: boolean }
  ): void {
    if (closed.status !== "closed") return;
    const closePrice = closed.closePrice ?? closed.buyPrice;
    const cost = closed.buyPrice * closed.shares;
    const proceeds = closePrice * closed.shares;
    const pnl = proceeds - cost;
    const closedAt = closed.closedAtMs ?? Date.now();

    const row: TradeCloseHistoryRow = {
      kind: HISTORY_KIND_TRADE_CLOSE,
      v: 1,
      recordedAt: new Date().toISOString(),
      simulation: meta.simulation,
      assetKey: closed.assetKey,
      marketSlug: closed.marketSlug,
      periodTimestamp: closed.periodTimestamp,
      conditionId: closed.conditionId,
      positionId: closed.id,
      entryKind: closed.entryKind,
      side: closed.tokenSide,
      shares: closed.shares,
      buyPrice: closed.buyPrice,
      closePrice,
      closeReason: closed.closeReason ?? "period_rollover",
      cost,
      proceeds,
      pnl,
      openedAtMs: closed.openedAtMs,
      closedAtMs: closedAt,
      buyOrderId: closed.buyOrderId,
      sellOrderId: closed.sellOrderId,
    };

    const day = utcDayFromMs(closedAt);
    const path = join(this.dir, `${day}.jsonl`);
    const line = `${JSON.stringify(row)}\n`;

    this.enqueue(async () => {
      await mkdir(this.dir, { recursive: true });
      await appendFile(path, line, "utf8");
    });
  }
}
