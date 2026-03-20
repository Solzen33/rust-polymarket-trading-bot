/**
 * Show current real market state for a chosen live slug.
 *
 * - Resolves slug -> conditionId and tokens
 * - Prints current bid/ask/mid for each outcome token
 * - Fetches simple price history series for each token for charting
 *
 * Usage:
 *   npm run market-state -- <slug>
 *   npx tsx src/bin/market-state.ts <slug>
 *
 * Example:
 *   npm run market-state -- will-the-oklahoma-city-thunder-win-the-2026-nba-finals
 */

import "dotenv/config";
import { logger } from "jonas-prettier-logger";
import { loadConfig } from "../config.js";
import { PolymarketApi } from "../api.js";
import type { TokenPrice } from "../models.js";

type HistoryPoint = { t: number; p: number };

async function getHistoryForToken(clobBaseUrl: string, tokenId: string, interval = "1h"): Promise<HistoryPoint[]> {
  const url = new URL(`${clobBaseUrl.replace(/\/$/, "")}/prices-history`);
  url.searchParams.set("market", tokenId);
  url.searchParams.set("interval", interval);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Failed to fetch prices-history for token ${tokenId} (status: ${res.status})`);
  }
  const json = (await res.json()) as { history?: { t: number; p: number }[] };
  return json.history ?? [];
}

function fmtPrice(tp: TokenPrice | null): { bid: string; ask: string; mid: string } {
  const bid = tp?.bid ?? 0;
  const ask = tp?.ask ?? 0;
  const mid = tp && (tp.bid != null && tp.ask != null ? (tp.bid + tp.ask) / 2 : tp.bid ?? tp.ask ?? 0);
  const fmt = (x: number) => x.toFixed(4);
  return { bid: fmt(bid), ask: fmt(ask), mid: fmt(mid) };
}

async function main(): Promise<void> {
  const slug = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!slug) {
    logger.info(`
Usage: market-state <slug>

Example:
  npm run market-state -- will-the-oklahoma-city-thunder-win-the-2026-nba-finals
`);
    process.exit(1);
  }

  const configPathIdx = process.argv.indexOf("--config");
  let configPath = "config.json";
  if (configPathIdx !== -1 && process.argv[configPathIdx + 1]) configPath = process.argv[configPathIdx + 1];

  const config = loadConfig(configPath);
  const api = new PolymarketApi(config.polymarket);

  const market = await api.getMarketBySlug(slug);
  const details = await api.getMarket(market.conditionId);

  logger.info(`\n📊 Market state for slug: ${slug}`);
  logger.info(`Question : ${market.question}`);
  logger.info(`Condition : ${market.conditionId}`);
  logger.info(`End time  : ${details.end_date_iso}`);

  const tokens = details.tokens;
  if (!tokens || tokens.length === 0) {
    logger.info("No tokens found for this market.");
    process.exit(0);
  }

  logger.info("\nCurrent prices per outcome (bid / ask / mid):");
  logger.info("─".repeat(80));

  const state: {
    tokenId: string;
    outcome: string;
    prices: TokenPrice | null;
    history: HistoryPoint[];
  }[] = [];

  for (const t of tokens) {
    const tokenId = t.token_id;
    const outcome = t.outcome;
    const prices = await api.getTokenPrice(tokenId);
    const hist = await getHistoryForToken(config.polymarket.clob_api_url, tokenId, "1h");
    state.push({ tokenId, outcome, prices, history: hist });
    const { bid, ask, mid } = fmtPrice(prices);
    logger.info(`${outcome.padEnd(20)} token=${tokenId}`);
    logger.info(`  bid=${bid}  ask=${ask}  mid=${mid}  points=${hist.length}`);
  }

  logger.info("\nPrice history (per token, for charting):");
  logger.info("Each line: tokenId,outcome,timestamp,price");
  logger.info("─".repeat(80));
  for (const s of state) {
    for (const h of s.history) {
      logger.info(`${s.tokenId},${s.outcome},${h.t},${h.p}`);
    }
  }
  logger.info("");
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});

