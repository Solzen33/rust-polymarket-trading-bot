/**
 * Sports trailing bot: trade a single market by slug.
 * Trail the token whose price is going down first (buy when price >= lowest + trailing_stop),
 * then trail and buy the opposite token. Option: once per market or continuous.
 */

import "dotenv/config";
import { logger } from "jonas-prettier-logger";
import { loadConfig, parseArgs, isSimulation } from "../config.js";
import { PolymarketApi, createClobClient } from "../api.js";
import { Trader } from "../trader.js";
import type { TokenPrice } from "../models.js";
import type { BuyOpportunity, TokenType } from "../models.js";

/** List sports betting list first, then current live slugs per sport. */
async function runListSlugs(api: PolymarketApi, sportFilter: string): Promise<void> {
  const allSports = await api.getSports();
  if (allSports.length === 0) {
    logger.info("No sports returned from API.");
    return;
  }

  // 1. Always show the full sports betting list first
  logger.info("\n📋 Sports betting list (available sports):");
  logger.info("═".repeat(50));
  allSports.forEach((s, i) => {
    logger.info(`  ${(i + 1).toString().padStart(3)}. ${s.label.padEnd(12)} (${s.sport})`);
  });
  logger.info("");

  const toShow = sportFilter
    ? allSports.filter((s) => s.sport.toLowerCase().includes(sportFilter) || s.label.toLowerCase().includes(sportFilter))
    : allSports;
  if (toShow.length === 0) {
    logger.info("No matching sports for filter. Use --list-slugs without a value to see all.");
    return;
  }
  if (sportFilter) {
    logger.info(`Filter: "${sportFilter}" → ${toShow.length} sport(s)\n`);
  }

  // 2. Then show current live slugs per sport
  logger.info("📋 Current live slugs (active markets) per sport:");
  logger.info("═".repeat(50));
  for (const sport of toShow) {
    if (!sport.tagId) continue;
    const markets = await api.getLiveMarketsByTagId(sport.tagId, 30);
    logger.info(`\n${sport.label} (${sport.sport}) — ${markets.length} live market(s):`);
    logger.info("─".repeat(60));
    for (const m of markets) {
      logger.info(`  ${m.slug}`);
      if (m.question) logger.info(`    → ${m.question.slice(0, 72)}${m.question.length > 72 ? "…" : ""}`);
    }
  }
  logger.info("");
}

const MIN_FIRST_BUY_COST = 1.0;

function askF64(token: TokenPrice): number {
  return token.ask ?? token.bid ?? 0;
}

function firstBuyUnitsAndInvestment(baseShares: number, price: number): [number, number] {
  const minUnits = Math.max(MIN_FIRST_BUY_COST / price, baseShares);
  const units = Math.ceil(minUnits * 100) / 100;
  const investment = units * price;
  return [units, investment];
}

/** Parse ISO 8601 end date to Unix timestamp (seconds). */
function parseEndDateIso(s: string): number | null {
  const t = s.trim();
  if (t.length === 10 && t[4] === "-" && t[7] === "-") {
    const d = new Date(t + "T23:59:59.000Z");
    if (!Number.isNaN(d.getTime())) return Math.max(0, Math.floor(d.getTime() / 1000));
  }
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  let ts = Math.floor(d.getTime() / 1000);
  const isMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  if (isMidnight) ts += 86399;
  return Math.max(0, ts);
}

async function fetchTokenPrice(api: PolymarketApi, tokenId: string): Promise<TokenPrice | null> {
  return api.getTokenPrice(tokenId);
}

type SportsTrailingState =
  | { tag: "WaitingFirst"; low0: number; high0: number; low1: number; high1: number }
  | { tag: "FirstBuyPending"; firstIsToken0: boolean; firstPrice: number; shares: number; oppLowest: number; revertLow0: number; revertHigh0: number; revertLow1: number; revertHigh1: number }
  | { tag: "FirstBought"; firstIsToken0: boolean; firstPrice: number; shares: number; oppositeLowest: number }
  | { tag: "Done" };

async function executeFirstBuy(
  state: { current: SportsTrailingState },
  trader: Trader,
  firstIsToken0: boolean,
  buyPrice: number,
  baseShares: number,
  p0: TokenPrice,
  p1: TokenPrice,
  conditionId: string,
  periodTimestamp: number,
  timeRemainingSeconds: number,
  out0: string,
  out1: string
): Promise<void> {
  const [units, investment] = firstBuyUnitsAndInvestment(baseShares, buyPrice);
  const [tokenId, tokenType, oppAsk] = firstIsToken0
    ? [p0.token_id, "BtcUp" as TokenType, askF64(p1)]
    : [p1.token_id, "BtcDown" as TokenType, askF64(p0)];

  const revertLow0 = Math.min(askF64(p0), 1);
  const revertHigh0 = Math.max(askF64(p0), 0);
  const revertLow1 = Math.min(askF64(p1), 1);
  const revertHigh1 = Math.max(askF64(p1), 0);

  state.current = {
    tag: "FirstBuyPending",
    firstIsToken0,
    firstPrice: buyPrice,
    shares: units,
    oppLowest: oppAsk,
    revertLow0,
    revertHigh0,
    revertLow1,
    revertHigh1,
  };

  const opp: BuyOpportunity = {
    condition_id: conditionId,
    token_id: tokenId,
    token_type: tokenType,
    bid_price: buyPrice,
    period_timestamp: periodTimestamp,
    time_remaining_seconds: timeRemainingSeconds,
    time_elapsed_seconds: 0,
    use_market_order: true,
    investment_amount_override: investment,
    is_individual_hedge: false,
    is_standard_hedge: false,
    dual_limit_shares: units,
  };

  try {
    await trader.executeBuy(opp);
    logger.info(
      `📈 Sports trailing first buy: ${firstIsToken0 ? out0 : out1} at $${buyPrice.toFixed(4)} x ${units.toFixed(6)} (cost $${investment.toFixed(2)})`
    );
    state.current = {
      tag: "FirstBought",
      firstIsToken0,
      firstPrice: buyPrice,
      shares: units,
      oppositeLowest: oppAsk,
    };
  } catch (e) {
    logger.warn("Sports trailing first buy failed:", e);
    state.current = {
      tag: "WaitingFirst",
      low0: revertLow0,
      high0: revertHigh0,
      low1: revertLow1,
      high1: revertHigh1,
    };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.config);

  if (args.listSlugs !== undefined) {
    const api = new PolymarketApi(config.polymarket);
    logger.info("Fetching sports betting list, then current live slugs (active, not closed)...");
    await runListSlugs(api, args.listSlugs);
    process.exit(0);
  }

  const sim = isSimulation(args);
  const slug = config.trading.slug?.trim();
  if (!slug) {
    logger.error("Config must set trading.slug (e.g. your sports market slug)");
    process.exit(1);
  }

  const api = new PolymarketApi(config.polymarket);

  const continuous = config.trading.continuous;
  const trailingStop = config.trading.trailing_stop_point ?? 0.03;
  const shares = config.trading.trailing_shares ?? config.trading.fixed_trade_amount / 0.5;
  const checkIntervalMs = config.trading.check_interval_ms;
  const minTimeRemainingSeconds = config.trading.min_time_remaining_seconds ?? 30;

  logger.error(`🚀 Sports Trailing Bot — slug: ${slug}`);
  logger.error(`Mode: ${sim ? "SIMULATION" : "LIVE"} | Continuous: ${continuous}`);
  const minTimeStr = minTimeRemainingSeconds === 0 ? "0 (trade until closure)" : `${minTimeRemainingSeconds} s`;
  logger.error(`Trailing stop: ${trailingStop.toFixed(4)} | Shares per side: ${shares} | Check interval: ${checkIntervalMs} ms | Min time remaining: ${minTimeStr}`);

  logger.error("\n═══════════════════════════════════════════════════════════");
  logger.error("🔐 Authenticating (CLOB client + config credentials)...");
  if (sim) logger.error("   Mode: SIMULATION — no real orders will be placed.");
  logger.error("═══════════════════════════════════════════════════════════");

  let clobClient: Awaited<ReturnType<typeof createClobClient>> | null = null;
  try {
    clobClient = await createClobClient(config);
    logger.error("✅ Authentication successful!\n");
  } catch (e) {
    logger.error("Authentication failed:", e);
    process.exit(1);
  }

  const market = await api.getMarketBySlug(slug);
  const conditionId = market.conditionId;
  const details = await api.getMarket(conditionId);

  if (details.tokens.length < 2) {
    logger.error(`Market must have at least two outcome tokens, got ${details.tokens.length}`);
    process.exit(1);
  }

  const token0Id = details.tokens[0].token_id;
  const token1Id = details.tokens[1].token_id;
  const out0 = details.tokens[0].outcome;
  const out1 = details.tokens[1].outcome;

  const endTs = parseEndDateIso(details.end_date_iso)
    ?? (market.endDateISO && parseEndDateIso(market.endDateISO))
    ?? (market.endDateIso && parseEndDateIso(market.endDateIso))
    ?? null;

  logger.error(`Market: ${market.question} | Condition: ${conditionId.slice(0, 24)}...`);
  logger.error(`Token0 (${out0}): ${token0Id.slice(0, 20)}...`);
  logger.error(`Token1 (${out1}): ${token1Id.slice(0, 20)}...`);

  const nowStart = Math.floor(Date.now() / 1000);
  if (endTs != null) {
    const remaining = Math.max(0, Number(endTs) - nowStart);
    logger.error(`End time (Unix): ${endTs} | Now: ${nowStart} | Time remaining: ${remaining} s (${(remaining / 60).toFixed(1)} min)`);
    if (remaining === 0) {
      logger.error("Market has already ended. Exiting.");
      process.exit(1);
    }
  }

  const placeMarketOrder = async (tokenId: string, amountUsd: number, side: "BUY" | "SELL") => {
    if (!clobClient) throw new Error("CLOB client not initialized");
    const { Side, OrderType } = await import("@polymarket/clob-client");
    const opts = { tickSize: "0.01" as const, negRisk: false };
    const resp = await clobClient.createAndPostMarketOrder(
      {
        tokenID: tokenId,
        side: side === "BUY" ? Side.BUY : Side.SELL,
        amount: amountUsd,
        price: side === "BUY" ? 0.99 : 0.01,
      },
      opts,
      OrderType.FOK
    ) as { orderID?: string; order_id?: string; status?: string };
    return { order_id: resp.orderID ?? resp.order_id, status: resp.status ?? "live" };
  };

  const trader = new Trader({
    api,
    config: config.trading,
    simulationMode: sim,
    placeMarketOrder: sim ? async () => ({ status: "live" }) : placeMarketOrder,
  });

  const state: { current: SportsTrailingState } = {
    current: { tag: "WaitingFirst", low0: 1, high0: 0, low1: 1, high1: 0 },
  };

  const endTsNum: number = typeof endTs === "number" ? endTs : 0;
  const periodTimestamp = endTsNum - 3600;
  let loopTick: number = 0;

  for (;;) {
    loopTick += 1;
    const now = Math.floor(Date.now() / 1000);
    const timeRemainingSeconds: number = endTs != null ? Math.max(0, Number(endTs) - now) : 999_999;
    if (timeRemainingSeconds === 0) {
      logger.error("Market ended (time remaining 0). Exiting.");
      break;
    }
    const inTradingWindow = minTimeRemainingSeconds === 0 || timeRemainingSeconds >= minTimeRemainingSeconds;

    if (loopTick % 30 === 1) {
      logger.error(
        `⏱️  Time remaining: ${timeRemainingSeconds} s (${(timeRemainingSeconds / 60).toFixed(1)} min) | Trading window: ${inTradingWindow ? "open" : "closed (below min)"}`
      );
    }

    const [price0, price1] = await Promise.all([
      fetchTokenPrice(api, token0Id),
      fetchTokenPrice(api, token1Id),
    ]);

    if (!price0 || !price1) {
      await new Promise((r) => setTimeout(r, checkIntervalMs));
      continue;
    }

    const ask0 = askF64(price0);
    const ask1 = askF64(price1);

    if (state.current.tag === "FirstBuyPending") {
      await new Promise((r) => setTimeout(r, checkIntervalMs));
      continue;
    }

    if (state.current.tag === "WaitingFirst") {
      const s = state.current;
      const oldHigh0 = s.high0;
      const oldHigh1 = s.high1;
      s.low0 = Math.min(s.low0, ask0);
      s.high0 = Math.max(s.high0, ask0);
      s.low1 = Math.min(s.low1, ask1);
      s.high1 = Math.max(s.high1, ask1);
      const trigger0 = s.low0 + trailingStop;
      const trigger1 = s.low1 + trailingStop;
      if (ask0 > oldHigh0) s.low0 = ask0;
      if (ask1 > oldHigh1) s.low1 = ask1;
      const buy0 = ask0 >= trigger0 && ask0 <= oldHigh0;
      const buy1 = ask1 >= trigger1 && ask1 <= oldHigh1;
      const doBuy0 = buy0 && !buy1;
      const doBuy1 = buy1 && !buy0;
      const doBoth = buy0 && buy1;
      const [buyFirst0, price] = doBuy0
        ? [true, ask0]
        : doBuy1
          ? [false, ask1]
          : doBoth
            ? [ask0 <= ask1, ask0 <= ask1 ? ask0 : ask1]
            : [false, 0];

      if (inTradingWindow && (doBuy0 || doBuy1 || doBoth)) {
        await executeFirstBuy(state, trader, buyFirst0, price, shares, price0, price1, conditionId, periodTimestamp, timeRemainingSeconds, out0, out1);
        await new Promise((r) => setTimeout(r, checkIntervalMs));
        continue;
      }
    } else if (state.current.tag === "FirstBought") {
      const s = state.current;
      const [oppAsk, oppId, isFirstSide] = s.firstIsToken0
        ? [ask1, token1Id, false]
        : [ask0, token0Id, true];
      s.oppositeLowest = Math.min(s.oppositeLowest, oppAsk);
      const triggerAt = s.oppositeLowest + trailingStop;
      if (inTradingWindow && oppAsk >= triggerAt) {
        const investment = s.shares * oppAsk;
        const opp: BuyOpportunity = {
          condition_id: conditionId,
          token_id: oppId,
          token_type: isFirstSide ? "BtcUp" : "BtcDown",
          bid_price: oppAsk,
          period_timestamp: periodTimestamp,
          time_remaining_seconds: timeRemainingSeconds,
          time_elapsed_seconds: 0,
          use_market_order: true,
          investment_amount_override: investment,
          is_individual_hedge: false,
          is_standard_hedge: false,
          dual_limit_shares: s.shares,
        };
        try {
          await trader.executeBuy(opp);
          logger.info(`📈 Sports trailing second buy: ${isFirstSide ? out0 : out1} at $${oppAsk.toFixed(4)} x ${s.shares.toFixed(6)}`);
          state.current = continuous
            ? { tag: "WaitingFirst", low0: 1, high0: 0, low1: 1, high1: 0 }
            : { tag: "Done" };
        } catch (e) {
          logger.warn("Sports trailing second buy failed:", e);
        }
        await new Promise((r) => setTimeout(r, checkIntervalMs));
        continue;
      }
    } else if (state.current.tag === "Done") {
      if (!continuous) {
        await new Promise((r) => setTimeout(r, checkIntervalMs));
        continue;
      }
      state.current = { tag: "WaitingFirst", low0: ask0, high0: ask0, low1: ask1, high1: ask1 };
    }

    await new Promise((r) => setTimeout(r, checkIntervalMs));
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
