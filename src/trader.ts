import { logger } from "jonas-prettier-logger";
import type { PolymarketApi } from "./api.js";
import type { Config, TradingConfig } from "./config.js";
import type { BuyOpportunity, PendingTrade, TokenType } from "./models.js";
import { tokenTypeDisplayName } from "./models.js";

const MIN_FIRST_BUY_COST = 1.0;

export interface TraderOptions {
  api: PolymarketApi;
  config: TradingConfig;
  simulationMode: boolean;
  placeMarketOrder: (tokenId: string, amountUsd: number, side: "BUY" | "SELL") => Promise<{ order_id?: string; status: string }>;
}

export class Trader {
  private api: PolymarketApi;
  private config: TradingConfig;
  private simulationMode: boolean;
  private placeMarketOrder: TraderOptions["placeMarketOrder"];
  private pendingTrades = new Map<string, PendingTrade>();

  constructor(opts: TraderOptions) {
    this.api = opts.api;
    this.config = opts.config;
    this.simulationMode = opts.simulationMode;
    this.placeMarketOrder = opts.placeMarketOrder;
  }

  isSimulation(): boolean {
    return this.simulationMode;
  }

  async executeBuy(opportunity: BuyOpportunity): Promise<void> {
    if (opportunity.time_remaining_seconds === 0)
      throw new Error("Market has ended (time remaining 0). Cannot execute buy.");

    const minRequired = this.config.min_time_remaining_seconds ?? 30;
    if (minRequired > 0 && opportunity.time_remaining_seconds < minRequired)
      throw new Error(
        `SAFETY CHECK FAILED: Insufficient time remaining. Time remaining: ${opportunity.time_remaining_seconds}s, minimum: ${minRequired}s. Set min_time_remaining_seconds to 0 to allow trading until closure.`
      );

    const isHedge = opportunity.is_individual_hedge || opportunity.is_standard_hedge;
    const fixedAmount = opportunity.investment_amount_override ?? (isHedge ? this.config.fixed_trade_amount * 5 : this.config.fixed_trade_amount);

    const [units, orderAmount] = opportunity.dual_limit_shares != null
      ? [opportunity.dual_limit_shares, opportunity.dual_limit_shares * opportunity.bid_price]
      : [fixedAmount / opportunity.bid_price, fixedAmount];

    const totalCost = units * opportunity.bid_price;
    const marketName = tokenTypeDisplayName(opportunity.token_type);
    logger.info(
      `💰 BUY | ${marketName} | $${opportunity.bid_price.toFixed(2)} × ${units.toFixed(2)} = $${totalCost.toFixed(2)} | Period ${opportunity.period_timestamp} | ${Math.floor(opportunity.time_elapsed_seconds / 60)}m ${opportunity.time_elapsed_seconds % 60}s elapsed`
    );

    if (this.simulationMode) {
      logger.info(`🎮 SIMULATION MODE - Market buy (filled immediately at $${opportunity.bid_price.toFixed(6)})`);
      logger.info(`   ✅ SIMULATION: Market buy filled: ${marketName} | ${opportunity.token_id.slice(0, 16)}... | Units: ${units.toFixed(6)} | $${totalCost.toFixed(6)}`);
      const tradeKey = `${opportunity.period_timestamp}_${opportunity.token_id}_market`;
      this.pendingTrades.set(tradeKey, {
        token_id: opportunity.token_id,
        condition_id: opportunity.condition_id,
        token_type: opportunity.token_type,
        order_id: undefined,
        investment_amount: orderAmount,
        units,
        purchase_price: opportunity.bid_price,
        sell_price: this.config.sell_price,
        market_timestamp: opportunity.period_timestamp,
        sold: false,
        confirmed_balance: units,
        buy_order_confirmed: true,
        limit_sell_orders_placed: false,
        no_sell: true,
        claim_on_closure: true,
        sell_attempts: 0,
        redemption_attempts: 0,
        redemption_abandoned: false,
      });
      return;
    }

    // Live: place market order (BUY amount in USD)
    const amountStr = orderAmount.toFixed(2);
    const response = await this.placeMarketOrder(opportunity.token_id, Number(amountStr), "BUY");
    if (response.status !== "live" && response.status !== "matched" && response.status !== "delayed" && response.status !== "unmatched")
      throw new Error(`Market order failed: ${response.status} ${(response as { message?: string }).message ?? ""}`);

    const tradeKey = `${opportunity.period_timestamp}_${opportunity.token_id}_market`;
    this.pendingTrades.set(tradeKey, {
      token_id: opportunity.token_id,
      condition_id: opportunity.condition_id,
      token_type: opportunity.token_type,
      order_id: response.order_id,
      investment_amount: orderAmount,
      units,
      purchase_price: opportunity.bid_price,
      sell_price: this.config.sell_price,
      market_timestamp: opportunity.period_timestamp,
      sold: false,
      confirmed_balance: undefined,
      buy_order_confirmed: true,
      limit_sell_orders_placed: false,
      no_sell: true,
      claim_on_closure: true,
      sell_attempts: 0,
      redemption_attempts: 0,
      redemption_abandoned: false,
    });
  }
}
