import type { ClobClient } from "@polymarket/clob-client";
import { placeLimitOrder } from "../../clob.js";
import type { TokenSide } from "./types.js";

export interface OrderResult {
  orderId: string;
  status: string;
}

/**
 * Executes CLOB orders for the threshold strategy (simulation vs live).
 */
export interface IThresholdExecutor {
  buy(
    tokenId: string,
    tokenSide: TokenSide,
    limitPrice: number,
    shares: number
  ): Promise<OrderResult>;
  sell(
    tokenId: string,
    tokenSide: TokenSide,
    limitPrice: number,
    shares: number
  ): Promise<OrderResult>;
}

/** Dry-run: records intent only (caller still updates PositionManager). */
export class SimulationThresholdExecutor implements IThresholdExecutor {
  async buy(
    _tokenId: string,
    _tokenSide: TokenSide,
    _limitPrice: number,
    _shares: number
  ): Promise<OrderResult> {
    return { orderId: `sim-buy-${Date.now()}`, status: "simulated" };
  }

  async sell(
    _tokenId: string,
    _tokenSide: TokenSide,
    _limitPrice: number,
    _shares: number
  ): Promise<OrderResult> {
    return { orderId: `sim-sell-${Date.now()}`, status: "simulated" };
  }
}

function roundSize(shares: number): number {
  return Math.round(shares * 100) / 100;
}

function roundPrice(p: number): number {
  return Math.round(p * 100) / 100;
}

/** Live GTC limit orders via existing CLOB helper. */
export class LiveThresholdExecutor implements IThresholdExecutor {
  constructor(private readonly client: ClobClient) {}

  async buy(
    tokenId: string,
    _tokenSide: TokenSide,
    limitPrice: number,
    shares: number
  ): Promise<OrderResult> {
    const r = await placeLimitOrder(this.client, {
      tokenId,
      side: "BUY",
      price: roundPrice(limitPrice),
      size: roundSize(shares),
      tickSize: "0.01",
      negRisk: false,
    });
    return { orderId: r.orderID, status: r.status };
  }

  async sell(
    tokenId: string,
    _tokenSide: TokenSide,
    limitPrice: number,
    shares: number
  ): Promise<OrderResult> {
    const r = await placeLimitOrder(this.client, {
      tokenId,
      side: "SELL",
      price: roundPrice(limitPrice),
      size: roundSize(shares),
      tickSize: "0.01",
      negRisk: false,
    });
    return { orderId: r.orderID, status: r.status };
  }
}
