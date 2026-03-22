/**
 * Append-only trade history: one JSON line per event under `history/YYYY-MM-DD.jsonl` (UTC day of close).
 */

import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { Position, PositionEntryKind } from "./strategy/threshold/types.js";
import type { PeriodPnlSummary } from "./strategy/threshold/period-pnl.js";
import type { TradingAssetKey } from "./trading-assets.js";

export const HISTORY_KIND_TRADE_CLOSE = "trade_close" as const;
export const HISTORY_KIND_SESSION = "session" as const;
export const HISTORY_KIND_PERIOD_PNL = "period_pnl" as const;

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
  /** Cumulative realized PnL for this asset since this bot process started. */
  sessionTotalPnlAsset: number;
  /** Cumulative realized PnL across all assets since this bot process started. */
  sessionTotalPnlAll: number;
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

/** One 15m window aggregate (written when the bot rolls into the next period). */
export interface PeriodPnlHistoryRow {
  kind: typeof HISTORY_KIND_PERIOD_PNL;
  v: 1;
  recordedAt: string;
  simulation: boolean;
  assetKey: TradingAssetKey;
  /** From a closed position in this period, if any */
  conditionId: string;
  periodTimestamp: number;
  marketSlug: string;
  assetLabel?: string;
  periodStartIso: string;
  totalPnl: number;
  totalCost: number;
  totalProceeds: number;
  tradeCount: number;
  bySide: PeriodPnlSummary["bySide"];
  byReason: PeriodPnlSummary["byReason"];
  lines: PeriodPnlSummary["lines"];
  openLeftoverCount: number;
  /** Cumulative realized PnL for this asset after this 15m window (session). */
  sessionTotalPnlAsset: number;
  /** Cumulative realized PnL across all assets after this window (session). */
  sessionTotalPnlAll: number;
}

export type HistoryRow = TradeCloseHistoryRow | SessionHistoryRow | PeriodPnlHistoryRow;

function utcDayFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export class TradeHistoryWriter {
  private readonly dir: string;
  private chain: Promise<void> = Promise.resolve();
  /** Running sum of `pnl` per asset for this process (updated on each `trade_close`). */
  private readonly sessionPnlByAsset = new Map<TradingAssetKey, number>();
  /** Running sum of `pnl` across all assets for this process. */
  private sessionPnlAll = 0;

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

    const prevAsset = this.sessionPnlByAsset.get(closed.assetKey) ?? 0;
    const sessionTotalPnlAsset = prevAsset + pnl;
    this.sessionPnlByAsset.set(closed.assetKey, sessionTotalPnlAsset);
    this.sessionPnlAll += pnl;

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
      sessionTotalPnlAsset,
      sessionTotalPnlAll: this.sessionPnlAll,
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

  /** Queue a period_pnl row (UTC day of write, same file convention as session). */
  appendPeriodPnl(
    summary: PeriodPnlSummary,
    meta: { simulation: boolean; assetKey: TradingAssetKey; conditionId: string }
  ): void {
    const row: PeriodPnlHistoryRow = {
      kind: HISTORY_KIND_PERIOD_PNL,
      v: 1,
      recordedAt: new Date().toISOString(),
      simulation: meta.simulation,
      assetKey: meta.assetKey,
      conditionId: meta.conditionId,
      periodTimestamp: summary.periodTimestamp,
      marketSlug: summary.slug,
      assetLabel: summary.assetLabel,
      periodStartIso: summary.periodStartIso,
      totalPnl: summary.totalPnl,
      totalCost: summary.totalCost,
      totalProceeds: summary.totalProceeds,
      tradeCount: summary.lines.length,
      bySide: summary.bySide,
      byReason: summary.byReason,
      lines: summary.lines,
      openLeftoverCount: summary.openLeftoverCount,
      sessionTotalPnlAsset: this.sessionPnlByAsset.get(meta.assetKey) ?? 0,
      sessionTotalPnlAll: this.sessionPnlAll,
    };

    const day = utcDayFromMs(Date.now());
    const path = join(this.dir, `${day}.jsonl`);
    const line = `${JSON.stringify(row)}\n`;

    this.enqueue(async () => {
      await mkdir(this.dir, { recursive: true });
      await appendFile(path, line, "utf8");
    });
  }
}
