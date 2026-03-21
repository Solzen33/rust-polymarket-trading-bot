/**
 * Polymarket 15m UP/DOWN slug prefixes (Gamma): `{prefix}-{periodTimestamp}`.
 */

export type TradingAssetKey = "btc" | "eth" | "solana" | "xrp";

export interface TradingToggles {
  enable_btc_trading: boolean;
  enable_eth_trading: boolean;
  enable_solana_trading: boolean;
  enable_xrp_trading: boolean;
}

/** Conservative default: BTC only. Enable ETH/SOL/XRP in `config.json` → `trading`. */
export const DEFAULT_TRADING_TOGGLES: TradingToggles = {
  enable_btc_trading: true,
  enable_eth_trading: false,
  enable_solana_trading: false,
  enable_xrp_trading: false,
};

export const ASSET_META: Record<
  TradingAssetKey,
  { slugPrefix: string; /** Short label for logs */ label: string }
> = {
  btc: { slugPrefix: "btc-updown-15m", label: "BTC" },
  eth: { slugPrefix: "eth-updown-15m", label: "ETH" },
  /** Polymarket uses `sol-`, not `solana-`, in the slug. */
  solana: { slugPrefix: "sol-updown-15m", label: "SOL" },
  xrp: { slugPrefix: "xrp-updown-15m", label: "XRP" },
};

/** Which assets to run (order = poll order). If all toggles false, defaults to BTC only. */
export function enabledAssetKeys(toggles: TradingToggles): TradingAssetKey[] {
  const keys: TradingAssetKey[] = [];
  if (toggles.enable_btc_trading) keys.push("btc");
  if (toggles.enable_eth_trading) keys.push("eth");
  if (toggles.enable_solana_trading) keys.push("solana");
  if (toggles.enable_xrp_trading) keys.push("xrp");
  return keys.length > 0 ? keys : ["btc"];
}
