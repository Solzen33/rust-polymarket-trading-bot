export interface Market {
  conditionId: string;
  id?: string;
  question: string;
  slug: string;
  endDateISO?: string;
  endDateIso?: string;
  active: boolean;
  closed: boolean;
  tokens?: Token[];
  clobTokenIds?: string;
  outcomes?: string;
}

export interface Token {
  tokenId: string;
  outcome: string;
  price?: number | string;
}

export interface MarketToken {
  outcome: string;
  price: number | string;
  token_id: string;
  winner: boolean;
}

export interface MarketDetails {
  condition_id: string;
  end_date_iso: string;
  tokens: MarketToken[];
  market_slug?: string;
  question?: string;
  [key: string]: unknown;
}

export interface TokenPrice {
  token_id: string;
  bid?: number;
  ask?: number;
}

export function midPrice(tp: TokenPrice): number | undefined {
  if (tp.bid != null && tp.ask != null) return (tp.bid + tp.ask) / 2;
  if (tp.bid != null) return tp.bid;
  if (tp.ask != null) return tp.ask;
  return undefined;
}

export function askPrice(tp: TokenPrice): number {
  return tp.ask ?? tp.bid ?? 0;
}

export interface OrderResponse {
  order_id?: string;
  orderID?: string;
  status: string;
  message?: string;
}

export type TokenType =
  | "BtcUp"
  | "BtcDown"
  | "EthUp"
  | "EthDown"
  | "SolanaUp"
  | "SolanaDown"
  | "XrpUp"
  | "XrpDown";

export function tokenTypeDisplayName(t: TokenType): string {
  const map: Record<TokenType, string> = {
    BtcUp: "BTC Up",
    BtcDown: "BTC Down",
    EthUp: "ETH Up",
    EthDown: "ETH Down",
    SolanaUp: "SOL Up",
    SolanaDown: "SOL Down",
    XrpUp: "XRP Up",
    XrpDown: "XRP Down",
  };
  return map[t] ?? t;
}

export interface BuyOpportunity {
  condition_id: string;
  token_id: string;
  token_type: TokenType;
  bid_price: number;
  period_timestamp: number;
  time_remaining_seconds: number;
  time_elapsed_seconds: number;
  use_market_order: boolean;
  investment_amount_override?: number;
  is_individual_hedge: boolean;
  is_standard_hedge: boolean;
  dual_limit_shares?: number;
}

export interface PendingTrade {
  token_id: string;
  condition_id: string;
  token_type: TokenType;
  order_id?: string;
  investment_amount: number;
  units: number;
  purchase_price: number;
  sell_price: number;
  market_timestamp: number;
  sold: boolean;
  confirmed_balance?: number;
  buy_order_confirmed: boolean;
  limit_sell_orders_placed: boolean;
  no_sell: boolean;
  claim_on_closure: boolean;
  sell_attempts: number;
  redemption_attempts: number;
  redemption_abandoned: boolean;
}
