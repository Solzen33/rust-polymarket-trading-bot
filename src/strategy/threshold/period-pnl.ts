/**
 * Aggregate realized PnL for one 15m period from closed positions (same periodTimestamp).
 * Uses mid-based tracking: pnl ≈ (closePrice - buyPrice) * shares per leg.
 */

import type { CloseReason, Position, TokenSide } from "./types.js";

export interface PositionPnlLine {
  positionId: string;
  side: TokenSide;
  shares: number;
  buyPrice: number;
  closePrice: number;
  closeReason: CloseReason;
  /** Notional cost (buy side): buyPrice * shares */
  cost: number;
  /** Notional proceeds proxy: closePrice * shares */
  proceeds: number;
  pnl: number;
  openedAtMs: number;
  closedAtMs: number;
}

export interface PeriodPnlSummary {
  periodTimestamp: number;
  slug: string;
  /** e.g. BTC / ETH — shown in the PnL banner */
  assetLabel?: string;
  periodStartIso: string;
  lines: PositionPnlLine[];
  totalPnl: number;
  totalCost: number;
  totalProceeds: number;
  bySide: Record<TokenSide, { count: number; pnl: number; cost: number; proceeds: number }>;
  byReason: Record<CloseReason, { count: number; pnl: number }>;
  /** Still open for this period (should be empty after rollover tick) */
  openLeftoverCount: number;
}

const REASONS: CloseReason[] = ["take_profit", "stop_loss", "period_rollover", "late_take_profit"];
const SIDES: TokenSide[] = ["UP", "DOWN"];

function emptyByReason(): Record<CloseReason, { count: number; pnl: number }> {
  const o = {} as Record<CloseReason, { count: number; pnl: number }>;
  for (const r of REASONS) o[r] = { count: 0, pnl: 0 };
  return o;
}

function emptyBySide(): Record<TokenSide, { count: number; pnl: number; cost: number; proceeds: number }> {
  const o = {} as Record<TokenSide, { count: number; pnl: number; cost: number; proceeds: number }>;
  for (const s of SIDES) o[s] = { count: 0, pnl: 0, cost: 0, proceeds: 0 };
  return o;
}

export interface BuildPeriodPnlOptions {
  /** Full market slug for this period, e.g. `eth-updown-15m-1739462400`. */
  marketSlug: string;
  assetLabel?: string;
}

/** Build summary for one ended period from all known positions. */
export function buildPeriodPnlSummary(
  allPositions: readonly Position[],
  periodTimestamp: number,
  options?: BuildPeriodPnlOptions
): PeriodPnlSummary {
  const slug = options?.marketSlug ?? `market-${periodTimestamp}`;
  const assetLabel = options?.assetLabel;
  const closed = allPositions.filter(
    (p) => p.periodTimestamp === periodTimestamp && p.status === "closed"
  );
  const openLeftover = allPositions.filter(
    (p) => p.periodTimestamp === periodTimestamp && p.status === "open"
  );

  const byReason = emptyByReason();
  const bySide = emptyBySide();

  const lines: PositionPnlLine[] = [];
  let totalPnl = 0;
  let totalCost = 0;
  let totalProceeds = 0;

  for (const p of closed) {
    const closePrice = p.closePrice ?? p.buyPrice;
    const reason = p.closeReason ?? "period_rollover";
    const cost = p.buyPrice * p.shares;
    const proceeds = closePrice * p.shares;
    const pnl = proceeds - cost;

    const line: PositionPnlLine = {
      positionId: p.id,
      side: p.tokenSide,
      shares: p.shares,
      buyPrice: p.buyPrice,
      closePrice,
      closeReason: reason,
      cost,
      proceeds,
      pnl,
      openedAtMs: p.openedAtMs,
      closedAtMs: p.closedAtMs ?? p.openedAtMs,
    };
    lines.push(line);

    totalPnl += pnl;
    totalCost += cost;
    totalProceeds += proceeds;

    byReason[reason].count += 1;
    byReason[reason].pnl += pnl;

    bySide[p.tokenSide].count += 1;
    bySide[p.tokenSide].pnl += pnl;
    bySide[p.tokenSide].cost += cost;
    bySide[p.tokenSide].proceeds += proceeds;
  }

  lines.sort((a, b) => a.closedAtMs - b.closedAtMs);

  return {
    periodTimestamp,
    slug,
    periodStartIso: new Date(periodTimestamp * 1000).toISOString(),
    lines,
    totalPnl,
    totalCost,
    totalProceeds,
    bySide,
    byReason,
    openLeftoverCount: openLeftover.length,
  };
}

function fmtMoney(n: number): string {
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(4)}`;
}

/** Multi-line banner for logs. */
export function formatPeriodPnlBanner(s: PeriodPnlSummary): string[] {
  const out: string[] = [];
  const sep = "─".repeat(72);
  out.push(sep);
  const who = s.assetLabel ? `[${s.assetLabel}] ` : "";
  out.push(
    `MARKET END PnL | ${who}${s.slug} | start_utc=${s.periodStartIso} | trades=${s.lines.length}`
  );
  if (s.lines.length === 0) {
    out.push("  (no closed positions in this period)");
    out.push(`  TOTAL PnL: ${fmtMoney(0)}  (cost 0.0000 → proceeds 0.0000)`);
    out.push(sep);
    return out;
  }

  out.push(
    "  id (short) | side | sh | entry_mid | exit_px | reason           | cost    → proceeds | PnL"
  );
  for (const L of s.lines) {
    const idShort = L.positionId.slice(0, 8);
    const reasonPad = L.closeReason.padEnd(13);
    out.push(
      `  ${idShort}… | ${L.side.padEnd(4)} | ${String(L.shares).padStart(2)} | ` +
        `${L.buyPrice.toFixed(4).padStart(9)} | ${L.closePrice.toFixed(4).padStart(7)} | ${reasonPad} | ` +
        `${L.cost.toFixed(4).padStart(7)} → ${L.proceeds.toFixed(4).padStart(8)} | ${fmtMoney(L.pnl)}`
    );
  }

  out.push(
    `  BY SIDE   | UP: n=${s.bySide.UP.count} PnL=${fmtMoney(s.bySide.UP.pnl)} ` +
      `(cost ${s.bySide.UP.cost.toFixed(4)} → ${s.bySide.UP.proceeds.toFixed(4)}) | ` +
      `DOWN: n=${s.bySide.DOWN.count} PnL=${fmtMoney(s.bySide.DOWN.pnl)} ` +
      `(cost ${s.bySide.DOWN.cost.toFixed(4)} → ${s.bySide.DOWN.proceeds.toFixed(4)})`
  );
  out.push(
    `  BY EXIT  | TP=${s.byReason.take_profit.count} (${fmtMoney(s.byReason.take_profit.pnl)}) | ` +
      `SL=${s.byReason.stop_loss.count} (${fmtMoney(s.byReason.stop_loss.pnl)}) | ` +
      `late95=${s.byReason.late_take_profit.count} (${fmtMoney(s.byReason.late_take_profit.pnl)}) | ` +
      `lateSL=${s.byReason.late_stop_loss.count} (${fmtMoney(s.byReason.late_stop_loss.pnl)}) | ` +
      `rollover=${s.byReason.period_rollover.count} (${fmtMoney(s.byReason.period_rollover.pnl)})`
  );
  out.push(
    `  TOTAL     | PnL=${fmtMoney(s.totalPnl)} | cost ${s.totalCost.toFixed(4)} → proceeds ${s.totalProceeds.toFixed(4)}`
  );

  if (s.openLeftoverCount > 0) {
    out.push(
      `  WARNING: ${s.openLeftoverCount} position(s) still OPEN for this period (tracker desync?)`
    );
  }
  out.push(sep);
  return out;
}
