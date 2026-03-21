import { createClobClient, placeLimitOrder } from "./clob.js";
import type { PolymarketApi } from "./api.js";
import type { Config } from "./config.js";
import type { BuyOpportunity, TokenType } from "./types.js";
import { tokenTypeDisplayName } from "./types.js";
import logger from "./logger.js";

export interface SimulationOrderRecord {
  token_type: TokenType;
  period_timestamp: number;
  price: number;
  shares: number;
  notional: number;
}

export interface SimulationSummary {
  orderCount: number;
  totalNotional: number;
  orders: SimulationOrderRecord[];
}

interface PendingTrade {
  token_id: string;
  condition_id: string;
  token_type: TokenType;
  market_timestamp: number;
  sold: boolean;
}

export class Trader {
  private api: PolymarketApi;
  private config: Config["trading"];
  private simulation: boolean;
  private pendingTrades: Map<string, PendingTrade> = new Map();
  /** Simulation-only: log of all simulated orders for summary */
  private simulationOrders: SimulationOrderRecord[] = [];

  constructor(api: PolymarketApi, config: Config["trading"], simulation: boolean) {
    this.api = api;
    this.config = config;
    this.simulation = simulation;
  }

  /** Check if we already have an active (unsold) position for this period + token type */
  hasActivePosition(periodTimestamp: number, tokenType: TokenType): boolean {
    for (const trade of this.pendingTrades.values()) {
      if (
        trade.market_timestamp === periodTimestamp &&
        trade.token_type === tokenType &&
        !trade.sold
      ) {
        return true;
      }
    }
    return false;
  }

  /** Execute limit buy: place order on CLOB or simulate */
  async executeLimitBuy(
    opportunity: BuyOpportunity,
    limitPrice: number,
    sharesOverride: number | null
  ): Promise<void> {
    const fixedAmount = this.config.fixed_trade_amount;
    const units = sharesOverride ?? fixedAmount / opportunity.bid_price;
    const investmentAmount = units * opportunity.bid_price;

    logger.info(
      "PLACING LIMIT BUY ORDER - " +
        `Token: ${tokenTypeDisplayName(opportunity.token_type)}, ` +
        `Token ID: ${opportunity.token_id}, ` +
        `Limit Price: $${limitPrice.toFixed(2)}, ` +
        `Size: ${units.toFixed(2)} shares, ` +
        `Investment: $${investmentAmount.toFixed(2)}`
    );

    if (this.simulation) {
      logger.info("SIMULATION MODE - Limit order NOT placed");
      const key = `${opportunity.period_timestamp}_${opportunity.token_id}_limit`;
      this.pendingTrades.set(key, {
        token_id: opportunity.token_id,
        condition_id: opportunity.condition_id,
        token_type: opportunity.token_type,
        market_timestamp: opportunity.period_timestamp,
        sold: false,
      });
      this.simulationOrders.push({
        token_type: opportunity.token_type,
        period_timestamp: opportunity.period_timestamp,
        price: limitPrice,
        shares: units,
        notional: investmentAmount,
      });
      return;
    }

    const pk = this.api.getPrivateKey();
    if (!pk) throw new Error("private_key required for live trading");
    const cfg = {
      gamma_api_url: "https://gamma-api.polymarket.com",
      clob_api_url: this.api.getClobUrl(),
      api_key: null,
      api_secret: null,
      api_passphrase: null,
      private_key: pk,
      proxy_wallet_address: this.api.getProxyWalletAddress(),
      signature_type: null,
    } as Config["polymarket"];
    const client = await createClobClient(cfg);
    const size = Math.round(units * 100) / 100;
    const price = Math.round(limitPrice * 100) / 100;
    const result = await placeLimitOrder(client, {
      tokenId: opportunity.token_id,
      side: "BUY",
      price,
      size,
      tickSize: "0.01",
      negRisk: false,
    });
    logger.info(`LIMIT BUY PLACED - Order ID: ${result.orderID} Status: ${result.status}`);
    const key = `${opportunity.period_timestamp}_${opportunity.token_id}_limit`;
    this.pendingTrades.set(key, {
      token_id: opportunity.token_id,
      condition_id: opportunity.condition_id,
      token_type: opportunity.token_type,
      market_timestamp: opportunity.period_timestamp,
      sold: false,
    });
  }

  /** Simulation-only: return summary of all simulated orders this run */
  getSimulationSummary(): SimulationSummary {
    const orders = [...this.simulationOrders];
    const totalNotional = orders.reduce((sum, o) => sum + o.notional, 0);
    return {
      orderCount: orders.length,
      totalNotional,
      orders,
    };
  }

  isSimulation(): boolean {
    return this.simulation;
  }
}
