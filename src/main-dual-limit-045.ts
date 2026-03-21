/**
 * @fileoverview Polymarket Dual Limit-Start Bot (TypeScript).
 *
 * At each new 15-minute period start (first ~2s), places limit BUYs for Up/Down on BTC and optional
 * ETH/SOL/XRP at `trading.dual_limit_price` (e.g. $0.45). Port of Rust `main_dual_limit_045`.
 *
 * **CLI:** `--simulation` | `--no-simulation` (live), `-c` / `--config` path.
 * **Auth:** `polymarket.private_key` required for both modes (CLOB `getOk`); simulation never sends orders.
 * **Outputs:** logs, and simulation summaries via `simulation-history.ts` → `history/`.
 */
import { loadConfig, parseArgs } from "./config.js";
import { PolymarketApi } from "./api.js";
import { createClobClient } from "./clob.js";
import { Trader } from "./trader.js";
import { fetchSnapshot, formatPrices, currentPeriodTimestamp } from "./monitor.js";
import { saveSimulationResult } from "./simulation-history.js";
import logger from "./logger.js";
import type { Market, MarketSnapshot, BuyOpportunity, TokenType } from "./types.js";

/** Default limit price if `trading.dual_limit_price` is unset. */
const LIMIT_PRICE = 0.45;
/** 15 minutes in seconds (Polymarket crypto up/down period length). */
const PERIOD_DURATION = 900;

/** Placeholder market when discovery fails or asset is disabled — keeps snapshot shape valid. */
function disabledMarket(conditionId: string, slug: string, question: string): Market {
  return {
    conditionId,
    slug,
    question,
    active: false,
    closed: true,
  };
}

/**
 * Find active `{prefix}-updown-15m-{period}` market via Gamma; may walk back prior periods for BTC/ETH.
 */
async function discoverMarket(
  api: PolymarketApi,
  name: string,
  slugPrefixes: string[],
  currentTime: number,
  seenIds: Set<string>,
  includePrevious: boolean
): Promise<Market> {
  const roundedTime = Math.floor(currentTime / 900) * 900;
  for (let i = 0; i < slugPrefixes.length; i++) {
    const prefix = slugPrefixes[i];
    if (i > 0) logger.trace(`Trying ${name} market with slug prefix '${prefix}'...`);
    let slug = `${prefix}-updown-15m-${roundedTime}`;
    try {
      const market = await api.getMarketBySlug(slug);
      if (!seenIds.has(market.conditionId) && market.active && !market.closed) {
        logger.info(`Found ${name} market by slug: ${market.slug} | Condition ID: ${market.conditionId}`);
        return market;
      }
    } catch {
      // try previous periods
    }
    if (includePrevious) {
      for (let offset = 1; offset <= 3; offset++) {
        const tryTime = roundedTime - offset * 900;
        slug = `${prefix}-updown-15m-${tryTime}`;
        try {
          const market = await api.getMarketBySlug(slug);
          if (!seenIds.has(market.conditionId) && market.active && !market.closed) {
            logger.info(`Found ${name} market by slug: ${market.slug} | Condition ID: ${market.conditionId}`);
            return market;
          }
        } catch {
          /* skip */
        }
      }
    }
  }
  throw new Error(`Could not find active ${name} 15-minute up/down market (tried: ${slugPrefixes.join(", ")})`);
}

/** Discover ETH/BTC/SOL/XRP 15m markets according to `enable_*` flags. */
async function getOrDiscoverMarkets(
  api: PolymarketApi,
  enableEth: boolean,
  enableSolana: boolean,
  enableXrp: boolean
): Promise<{ eth: Market; btc: Market; solana: Market; xrp: Market }> {
  const now = Math.floor(Date.now() / 1000);
  const seenIds = new Set<string>();

  const eth = enableEth
    ? await discoverMarket(api, "ETH", ["eth"], now, seenIds, true).catch(() => {
        logger.warn("Could not discover ETH market - using fallback");
        return disabledMarket("dummy_eth_fallback", "eth-updown-15m-fallback", "ETH Trading Disabled");
      })
    : disabledMarket("dummy_eth_fallback", "eth-updown-15m-fallback", "ETH Trading Disabled");
  seenIds.add(eth.conditionId);

  logger.trace("Discovering BTC market...");
  const btc = await discoverMarket(api, "BTC", ["btc"], now, seenIds, true).catch(() => {
    logger.warn("Could not discover BTC market - using fallback");
    return disabledMarket("dummy_btc_fallback", "btc-updown-15m-fallback", "BTC Trading Disabled");
  });
  seenIds.add(btc.conditionId);

  const solana = enableSolana
    ? await discoverMarket(api, "Solana", ["solana", "sol"], now, seenIds, false).catch(() => {
        logger.warn("Could not discover Solana market - using fallback");
        return disabledMarket("dummy_solana_fallback", "solana-updown-15m-fallback", "Solana Trading Disabled");
      })
    : disabledMarket("dummy_solana_fallback", "solana-updown-15m-fallback", "Solana Trading Disabled");

  const xrp = enableXrp
    ? await discoverMarket(api, "XRP", ["xrp"], now, seenIds, false).catch(() => {
        logger.warn("Could not discover XRP market - using fallback");
        return disabledMarket("dummy_xrp_fallback", "xrp-updown-15m-fallback", "XRP Trading Disabled");
      })
    : disabledMarket("dummy_xrp_fallback", "xrp-updown-15m-fallback", "XRP Trading Disabled");

  return { eth, btc, solana, xrp };
}

/** Build one {@link BuyOpportunity} per Up/Down token for enabled assets at period start. */
function buildOpportunities(
  snapshot: MarketSnapshot,
  limitPrice: number,
  enableEth: boolean,
  enableSolana: boolean,
  enableXrp: boolean
): BuyOpportunity[] {
  const opps: BuyOpportunity[] = [];
  const period = snapshot.period_timestamp;
  const timeRem = snapshot.time_remaining_seconds;
  const timeElapsed = PERIOD_DURATION - timeRem;

  const add = (conditionId: string, tokenId: string, tokenType: TokenType) => {
    opps.push({
      condition_id: conditionId,
      token_id: tokenId,
      token_type: tokenType,
      bid_price: limitPrice,
      period_timestamp: period,
      time_remaining_seconds: timeRem,
      time_elapsed_seconds: timeElapsed,
      use_market_order: false,
    });
  };

  if (snapshot.btc_market.up_token) add(snapshot.btc_market.condition_id, snapshot.btc_market.up_token.token_id, "BtcUp");
  if (snapshot.btc_market.down_token) add(snapshot.btc_market.condition_id, snapshot.btc_market.down_token.token_id, "BtcDown");
  if (enableEth) {
    if (snapshot.eth_market.up_token) add(snapshot.eth_market.condition_id, snapshot.eth_market.up_token.token_id, "EthUp");
    if (snapshot.eth_market.down_token) add(snapshot.eth_market.condition_id, snapshot.eth_market.down_token.token_id, "EthDown");
  }
  if (enableSolana) {
    if (snapshot.solana_market.up_token) add(snapshot.solana_market.condition_id, snapshot.solana_market.up_token.token_id, "SolanaUp");
    if (snapshot.solana_market.down_token) add(snapshot.solana_market.condition_id, snapshot.solana_market.down_token.token_id, "SolanaDown");
  }
  if (enableXrp) {
    if (snapshot.xrp_market.up_token) add(snapshot.xrp_market.condition_id, snapshot.xrp_market.up_token.token_id, "XrpUp");
    if (snapshot.xrp_market.down_token) add(snapshot.xrp_market.condition_id, snapshot.xrp_market.down_token.token_id, "XrpDown");
  }
  return opps;
}

async function main(): Promise<void> {
  const { simulation, config: configPath } = parseArgs();
  const config = loadConfig(configPath);

  logger.info("Starting Polymarket Dual Limit-Start Bot (TypeScript)");
  logger.info("Mode: " + (simulation ? "SIMULATION" : "PRODUCTION"));
  if (simulation) {
    logger.info("No real orders will be placed. Simulated orders are tracked for summary.");
    logger.info("Simulation uses the same polymarket.private_key as live (wallet is verified; orders stay simulated).");
  }
  const limitPrice = config.trading.dual_limit_price ?? LIMIT_PRICE;
  const limitShares = config.trading.dual_limit_shares ?? null;
  logger.info(`Strategy: At market start, place limit buys for BTC, ETH, SOL, XRP Up/Down at $${limitPrice.toFixed(2)}`);
  logger.info(limitShares != null ? `Shares per order (config): ${limitShares}` : "Shares per order: fixed_trade_amount / price");
  const extras: string[] = [];
  if (config.trading.enable_eth_trading) extras.push("ETH");
  if (config.trading.enable_solana_trading) extras.push("Solana");
  if (config.trading.enable_xrp_trading) extras.push("XRP");
  logger.info("Trading enabled for BTC and " + (extras.length ? extras.join(", ") : "no additional") + " 15-minute markets");

  const api = new PolymarketApi(config.polymarket);
  logger.info("═══════════════════════════════════════════════════════════");
  logger.info("Authenticating with Polymarket CLOB API (required for simulation and live)...");
  logger.info("═══════════════════════════════════════════════════════════");
  if (!config.polymarket.private_key) {
    logger.error("polymarket.private_key is required in config.json for both simulation and live trading.");
    throw new Error("private_key is required");
  }
  try {
    const client = await createClobClient(config.polymarket);
    await client.getOk();
    logger.info("Successfully authenticated with Polymarket CLOB API");
    logger.info("Wallet (private_key): OK — using EOA from config");
    logger.info("CLOB API key: from config, or derived/created from the wallet when omitted");
    if (simulation) {
      logger.info("Simulation mode: limit orders will be logged only (no real CLOB orders).");
    } else {
      logger.info("Live mode: real limit orders will be sent to Polymarket.");
    }
  } catch (e) {
    logger.error("Authentication failed: " + String(e));
    throw e;
  }
  logger.info("Authentication successful!");
  logger.info("═══════════════════════════════════════════════════════════");

  logger.info("Discovering BTC, ETH, Solana, XRP markets...");
  const { eth, btc, solana, xrp } = await getOrDiscoverMarkets(
    api,
    config.trading.enable_eth_trading,
    config.trading.enable_solana_trading,
    config.trading.enable_xrp_trading
  );

  const trader = new Trader(api, config.trading, simulation);
  let ethMarket = eth;
  let btcMarket = btc;
  let solanaMarket = solana;
  let xrpMarket = xrp;

  let lastPlacedPeriod: number | null = null;
  let lastSeenPeriod: number | null = null;
  let currentMarketPeriod: number | null = null;
  const checkIntervalMs = config.trading.check_interval_ms ?? 1000;

  logger.info("Starting market monitoring...");
  const now = Math.floor(Date.now() / 1000);
  const period = currentPeriodTimestamp();
  const nextPeriodStart = period + PERIOD_DURATION;
  const secondsUntilNext = nextPeriodStart - now;
  logger.info(`Current market period: ${period}, next period starts in ${secondsUntilNext} seconds`);
  currentMarketPeriod = period;

  if (btcMarket.tokens?.length) {
    const up = btcMarket.tokens.find((t) => /up|1/i.test(t.outcome ?? ""));
    const down = btcMarket.tokens.find((t) => /down|0/i.test(t.outcome ?? ""));
    const upId = up?.tokenId ?? up?.token_id;
    const downId = down?.tokenId ?? down?.token_id;
    if (upId) logger.info(`BTC Up token_id: ${upId}`);
    if (downId) logger.info(`BTC Down token_id: ${downId}`);
  }

  for (;;) {
    const snapshot = await fetchSnapshot(api, ethMarket, btcMarket, solanaMarket, xrpMarket);
    logger.info(formatPrices(snapshot));

    // If the 15-minute period rolled over, refresh markets so we get the new condition IDs/token IDs.
    if (currentMarketPeriod === null || snapshot.period_timestamp !== currentMarketPeriod) {
      currentMarketPeriod = snapshot.period_timestamp;
      logger.info(`Detected new 15-minute period (${currentMarketPeriod}) - refreshing markets for latest tokens...`);
      const refreshed = await getOrDiscoverMarkets(
        api,
        config.trading.enable_eth_trading,
        config.trading.enable_solana_trading,
        config.trading.enable_xrp_trading
      );
      ethMarket = refreshed.eth;
      btcMarket = refreshed.btc;
      solanaMarket = refreshed.solana;
      xrpMarket = refreshed.xrp;
      // Continue loop so next tick uses fresh markets + order books
      await new Promise((r) => setTimeout(r, checkIntervalMs));
      continue;
    }

    if (snapshot.time_remaining_seconds === 0) {
      await new Promise((r) => setTimeout(r, checkIntervalMs));
      continue;
    }

    if (lastSeenPeriod === null) {
      lastSeenPeriod = snapshot.period_timestamp;
      await new Promise((r) => setTimeout(r, checkIntervalMs));
      continue;
    }
    if (lastSeenPeriod !== snapshot.period_timestamp) {
      lastSeenPeriod = snapshot.period_timestamp;
    }

    const timeElapsed = PERIOD_DURATION - snapshot.time_remaining_seconds;
    if (timeElapsed > 2) {
      await new Promise((r) => setTimeout(r, checkIntervalMs));
      continue;
    }

    if (lastPlacedPeriod === snapshot.period_timestamp) {
      await new Promise((r) => setTimeout(r, checkIntervalMs));
      continue;
    }
    lastPlacedPeriod = snapshot.period_timestamp;

    const opportunities = buildOpportunities(
      snapshot,
      limitPrice,
      config.trading.enable_eth_trading,
      config.trading.enable_solana_trading,
      config.trading.enable_xrp_trading
    );
    if (opportunities.length === 0) {
      await new Promise((r) => setTimeout(r, checkIntervalMs));
      continue;
    }

    logger.info(`Market start detected - placing limit buys at $${limitPrice.toFixed(2)}`);
    let placedThisRound = 0;
    for (const opp of opportunities) {
      if (trader.hasActivePosition(opp.period_timestamp, opp.token_type)) continue;
      try {
        await trader.executeLimitBuy(opp, limitPrice, limitShares);
        placedThisRound++;
      } catch (e) {
        logger.error("Error executing limit buy: " + String(e));
      }
    }

    if (simulation && placedThisRound > 0) {
      const summary = trader.getSimulationSummary();
      logger.info(
        `Simulation summary (this run): ${summary.orderCount} order(s), total notional $${summary.totalNotional.toFixed(2)}`
      );
      try {
        const thisRoundOrders = summary.orders.slice(-placedThisRound);
        const roundNotional = thisRoundOrders.reduce((s, o) => s + o.notional, 0);
        const savedPath = await saveSimulationResult({
          orderCount: thisRoundOrders.length,
          totalNotional: roundNotional,
          orders: thisRoundOrders,
        });
        logger.info(`Saved to ${savedPath}`);
      } catch (e) {
        logger.warn("Failed to save simulation history: " + String(e));
      }
    }

    await new Promise((r) => setTimeout(r, checkIntervalMs));
  }
}

main().catch((err) => {
  logger.error(String(err));
  process.exit(1);
});
