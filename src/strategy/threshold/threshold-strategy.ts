import type { TokenPrice } from "../../types.js";
import type { ThresholdStrategyConfig } from "./config.js";
import { crossedAbove, midFromTokenPrice } from "./pricing.js";
import { PositionManager } from "./position-manager.js";
import type { IThresholdExecutor } from "./threshold-executor.js";
import type { TradingAssetKey } from "../../trading-assets.js";
import type { CloseReason, PositionEntryKind, TokenSide } from "./types.js";

export interface StrategyLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface TickContext {
  periodTimestamp: number;
  timeRemainingSeconds: number;
  marketSlug: string;
  assetKey: TradingAssetKey;
  conditionId: string;
  upTokenId: string;
  downTokenId: string;
  upPrice: TokenPrice | null;
  downPrice: TokenPrice | null;
}

/**
 * Automated buy/sell on UP and DOWN mids: buy on upward cross of `buyPrice`,
 * take profit / stop loss per open position independently.
 * Late phase (default last 5 min): buy on cross of `latePhaseBuyPrice`; sell at `latePhaseSellPrice` or stop at `latePhaseStopLossPrice`.
 * At most **one position per side** (UP/DOWN) at a time — no new buy until that side is
 * closed in the tracker (after a successful exit sell, or period rollover / settlement handling).
 */
export class ThresholdStrategy {
  private lastUpMid: number | null = null;
  private lastDownMid: number | null = null;
  private lastPeriod: number | null = null;
  /** Separate cross baselines for late-phase entries (only updated inside the late window). */
  private lateLastUpMid: number | null = null;
  private lateLastDownMid: number | null = null;

  constructor(
    readonly config: ThresholdStrategyConfig,
    readonly positions: PositionManager,
    private readonly executor: IThresholdExecutor,
    private readonly log: StrategyLogger
  ) {}

  /** Call when the 15m market period changes: reset cross state and flatten tracked opens. */
  async onMarketStart(ctx: {
    marketSlug: string;
    periodTimestamp: number;
    timeRemainingSeconds: number;
    upMid: number | null;
    downMid: number | null;
  }): Promise<void> {
    const open = this.positions.getOpen();
    if (open.length > 0) {
      this.log.warn(
        `market start | period=${ctx.periodTimestamp} | rolling ${open.length} open position(s) (period_rollover)`
      );
      for (const p of open) {
        const mid = p.tokenSide === "UP" ? ctx.upMid : ctx.downMid;
        const exitPx = mid ?? p.buyPrice;
        try {
          const r = await this.executor.sell(p.tokenId, p.tokenSide, exitPx, p.shares);
          this.positions.close(p.id, "period_rollover", exitPx, r.orderId);
        } catch (e) {
          this.log.error(`period rollover sell failed for ${p.id}: ${String(e)} — closing in tracker anyway`);
          this.positions.close(p.id, "period_rollover", exitPx);
        }
      }
    }

    this.lastPeriod = ctx.periodTimestamp;
    this.lastUpMid = ctx.upMid;
    this.lastDownMid = ctx.downMid;
    this.lateLastUpMid = null;
    this.lateLastDownMid = null;
    this.log.info(
      `market start | ${ctx.marketSlug} | period=${ctx.periodTimestamp} | time_remaining=${ctx.timeRemainingSeconds}s | up_mid=${ctx.upMid ?? "n/a"} down_mid=${ctx.downMid ?? "n/a"}`
    );
  }

  /** One evaluation step (call each poll tick). */
  async onTick(ctx: TickContext): Promise<void> {
    const upMid = midFromTokenPrice(ctx.upPrice);
    const downMid = midFromTokenPrice(ctx.downPrice);

    if (this.lastPeriod === null || ctx.periodTimestamp !== this.lastPeriod) {
      await this.onMarketStart({
        marketSlug: ctx.marketSlug,
        periodTimestamp: ctx.periodTimestamp,
        timeRemainingSeconds: ctx.timeRemainingSeconds,
        upMid,
        downMid,
      });
    }

    const inLatePhase =
      this.config.latePhaseEnabled &&
      ctx.timeRemainingSeconds <= this.config.latePhaseWindowSeconds;

    const closedSides = await this.checkExitsForOpenPositions(upMid, downMid);
    /** After a sell, align cross baselines to current mid so we don't re-buy the same tick. */
    for (const side of closedSides) {
      const mid = side === "UP" ? upMid : downMid;
      if (mid == null) continue;
      if (side === "UP") {
        this.lastUpMid = mid;
        if (inLatePhase) this.lateLastUpMid = mid;
      } else {
        this.lastDownMid = mid;
        if (inLatePhase) this.lateLastDownMid = mid;
      }
    }

    const allowNewBuys = ctx.timeRemainingSeconds > this.config.minRemainingSeconds;

    if (!allowNewBuys) {
      if (crossedAbove(this.lastUpMid, upMid, this.config.buyPrice)) {
        this.log.info(
          `skipped buy UP | price crossed ${this.config.buyPrice} but remaining_time=${ctx.timeRemainingSeconds}s <= min=${this.config.minRemainingSeconds}s`
        );
      }
      if (crossedAbove(this.lastDownMid, downMid, this.config.buyPrice)) {
        this.log.info(
          `skipped buy DOWN | price crossed ${this.config.buyPrice} but remaining_time=${ctx.timeRemainingSeconds}s <= min=${this.config.minRemainingSeconds}s`
        );
      }
    } else {
      await this.tryBuyOnCross(
        ctx.assetKey,
        ctx.marketSlug,
        "standard",
        "UP",
        ctx.upTokenId,
        ctx.conditionId,
        ctx.periodTimestamp,
        upMid
      );
      await this.tryBuyOnCross(
        ctx.assetKey,
        ctx.marketSlug,
        "standard",
        "DOWN",
        ctx.downTokenId,
        ctx.conditionId,
        ctx.periodTimestamp,
        downMid
      );
    }

    if (inLatePhase) {
      await this.tryLateBuyOnCross(
        ctx.assetKey,
        ctx.marketSlug,
        "UP",
        ctx.upTokenId,
        ctx.conditionId,
        ctx.periodTimestamp,
        upMid
      );
      await this.tryLateBuyOnCross(
        ctx.assetKey,
        ctx.marketSlug,
        "DOWN",
        ctx.downTokenId,
        ctx.conditionId,
        ctx.periodTimestamp,
        downMid
      );
    }

    if (upMid != null) this.lastUpMid = upMid;
    if (downMid != null) this.lastDownMid = downMid;

    if (inLatePhase) {
      if (upMid != null) this.lateLastUpMid = upMid;
      if (downMid != null) this.lateLastDownMid = downMid;
    } else {
      this.lateLastUpMid = null;
      this.lateLastDownMid = null;
    }
  }

  private lateShares(): number {
    return this.config.latePhaseSharesPerOrder ?? this.config.sharesPerOrder;
  }

  private async checkExitsForOpenPositions(
    upMid: number | null,
    downMid: number | null
  ): Promise<Set<TokenSide>> {
    const closedSides = new Set<TokenSide>();
    const open = this.positions.getOpen();
    for (const p of open) {
      const mid = p.tokenSide === "UP" ? upMid : downMid;
      if (mid == null) continue;

      if (p.entryKind === "late_phase") {
        if (mid >= this.config.latePhaseSellPrice) {
          const exitPrice = this.config.latePhaseSellPrice;
          try {
            const r = await this.executor.sell(p.tokenId, p.tokenSide, exitPrice, p.shares);
            this.positions.close(p.id, "late_take_profit", exitPrice, r.orderId);
            this.log.info(
              `late phase take profit | id=${p.id} side=${p.tokenSide} mid=${mid.toFixed(4)} limit=${exitPrice} shares=${p.shares} order=${r.orderId}`
            );
          } catch (e) {
            this.log.error(`late phase sell failed for position ${p.id}: ${String(e)}`);
          }
        } else if (mid <= this.config.latePhaseStopLossPrice) {
          const exitPrice = this.config.latePhaseStopLossPrice;
          try {
            const r = await this.executor.sell(p.tokenId, p.tokenSide, exitPrice, p.shares);
            this.positions.close(p.id, "late_stop_loss", exitPrice, r.orderId);
            closedSides.add(p.tokenSide);
            this.log.info(
              `late phase stop loss | id=${p.id} side=${p.tokenSide} mid=${mid.toFixed(4)} limit=${exitPrice} shares=${p.shares} order=${r.orderId}`
            );
          } catch (e) {
            this.log.error(`late phase stop sell failed for position ${p.id}: ${String(e)}`);
          }
        }
        continue;
      }

      let reason: CloseReason | null = null;
      let exitPrice = mid;

      if (mid >= this.config.takeProfitPrice) {
        reason = "take_profit";
        exitPrice = this.config.takeProfitPrice;
      } else if (mid <= this.config.stopLossPrice) {
        reason = "stop_loss";
        exitPrice = this.config.stopLossPrice;
      }

      if (!reason) continue;

      try {
        const r = await this.executor.sell(p.tokenId, p.tokenSide, exitPrice, p.shares);
        this.positions.close(p.id, reason, exitPrice, r.orderId);
        if (reason === "take_profit") {
          this.log.info(
            `sell executed (take profit) | id=${p.id} side=${p.tokenSide} mid=${mid.toFixed(4)} limit=${exitPrice} shares=${p.shares} order=${r.orderId}`
          );
        } else {
          this.log.info(
            `stop loss triggered | id=${p.id} side=${p.tokenSide} mid=${mid.toFixed(4)} limit=${exitPrice} shares=${p.shares} order=${r.orderId}`
          );
        }
      } catch (e) {
        this.log.error(`sell failed for position ${p.id}: ${String(e)}`);
      }
    }
    return closedSides;
  }

  private async tryBuyOnCross(
    assetKey: TradingAssetKey,
    marketSlug: string,
    entryKind: PositionEntryKind,
    side: TokenSide,
    tokenId: string,
    conditionId: string,
    periodTimestamp: number,
    currentMid: number | null
  ): Promise<void> {
    const prev = side === "UP" ? this.lastUpMid : this.lastDownMid;
    if (!crossedAbove(prev, currentMid, this.config.buyPrice)) return;
    if (currentMid == null) return;

    try {
      const r = await this.executor.buy(tokenId, side, this.config.buyPrice, this.config.sharesPerOrder);
      const pos = this.positions.open({
        assetKey,
        marketSlug,
        entryKind,
        tokenSide: side,
        tokenId,
        conditionId,
        buyPrice: currentMid,
        shares: this.config.sharesPerOrder,
        periodTimestamp,
        buyOrderId: r.orderId,
      });
      this.log.info(
        `buy executed | id=${pos.id} side=${side} entry_mid=${currentMid.toFixed(4)} limit=${this.config.buyPrice} shares=${this.config.sharesPerOrder} order=${r.orderId}`
      );
    } catch (e) {
      this.log.error(`buy failed ${side}: ${String(e)}`);
    }
  }

  private async tryLateBuyOnCross(
    assetKey: TradingAssetKey,
    marketSlug: string,
    side: TokenSide,
    tokenId: string,
    conditionId: string,
    periodTimestamp: number,
    currentMid: number | null
  ): Promise<void> {
    if (this.positions.getOpenForSide(side).length > 0) {
      if (crossedAbove(side === "UP" ? this.lateLastUpMid : this.lateLastDownMid, currentMid, this.config.latePhaseBuyPrice)) {
        this.log.info(
          `skipped late buy ${side} | already hold an open ${side} position (buy again only after that position is sold)`
        );
      }
      return;
    }

    const prev = side === "UP" ? this.lateLastUpMid : this.lateLastDownMid;
    if (!crossedAbove(prev, currentMid, this.config.latePhaseBuyPrice)) return;
    if (currentMid == null) return;

    const sh = this.lateShares();
    try {
      const r = await this.executor.buy(tokenId, side, this.config.latePhaseBuyPrice, sh);
      const pos = this.positions.open({
        assetKey,
        marketSlug,
        entryKind: "late_phase",
        tokenSide: side,
        tokenId,
        conditionId,
        buyPrice: currentMid,
        shares: sh,
        periodTimestamp,
        buyOrderId: r.orderId,
      });
      this.log.info(
        `late phase buy | id=${pos.id} side=${side} entry_mid=${currentMid.toFixed(4)} limit=${this.config.latePhaseBuyPrice} shares=${sh} order=${r.orderId}`
      );
    } catch (e) {
      this.log.error(`late phase buy failed ${side}: ${String(e)}`);
    }
  }
}
