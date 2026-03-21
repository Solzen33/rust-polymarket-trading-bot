/**
 * Loads `config.json`: Polymarket API URLs and wallet / optional CLOB API credentials.
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { DEFAULT_TRADING_TOGGLES, type TradingToggles } from "./trading-assets.js";

export interface PolymarketConfig {
  gamma_api_url: string;
  clob_api_url: string;
  api_key: string | null;
  api_secret: string | null;
  api_passphrase: string | null;
  /** Required for live trading; optional for read-only simulation. */
  private_key: string | null;
  proxy_wallet_address: string | null;
  signature_type: number | null;
}

export interface Config {
  polymarket: PolymarketConfig;
  /** Which 15m crypto UP/DOWN markets to trade (each gets its own strategy state). */
  trading: TradingToggles;
}

const DEFAULT_CONFIG: Config = {
  polymarket: {
    gamma_api_url: "https://gamma-api.polymarket.com",
    clob_api_url: "https://clob.polymarket.com",
    api_key: null,
    api_secret: null,
    api_passphrase: null,
    private_key: null,
    proxy_wallet_address: null,
    signature_type: null,
  },
  trading: { ...DEFAULT_TRADING_TOGGLES },
};

function emptyToNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

export function loadConfig(configPath: string = "config.json"): Config {
  const path = join(process.cwd(), configPath);
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }
  const content = readFileSync(path, "utf-8");
  const parsed = JSON.parse(content) as Partial<Config>;

  const polymarket: PolymarketConfig = {
    ...DEFAULT_CONFIG.polymarket,
    ...(parsed.polymarket ?? {}),
  };
  polymarket.api_key = emptyToNull(polymarket.api_key ?? undefined);
  polymarket.api_secret = emptyToNull(polymarket.api_secret ?? undefined);
  polymarket.api_passphrase = emptyToNull(polymarket.api_passphrase ?? undefined);
  polymarket.private_key = emptyToNull(polymarket.private_key ?? undefined);
  polymarket.proxy_wallet_address = emptyToNull(polymarket.proxy_wallet_address ?? undefined);

  const trading: TradingToggles = {
    ...DEFAULT_TRADING_TOGGLES,
    ...(parsed.trading ?? {}),
  };

  return { polymarket, trading };
}
