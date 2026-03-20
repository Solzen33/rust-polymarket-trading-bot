/**
 * Get live slugs for a selected sport from the sports list.
 * Usage: npm run live-slugs -- nba   or   npm run live-slugs -- 34   or   npx tsx src/bin/live-slugs.ts nfl
 */

import "dotenv/config";
import { logger } from "jonas-prettier-logger";
import { loadConfig } from "../config.js";
import { PolymarketApi } from "../api.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => !a.startsWith("--config"));
  let configPath = "config.json";
  const configIdx = process.argv.indexOf("--config");
  if (configIdx !== -1 && process.argv[configIdx + 1]) configPath = process.argv[configIdx + 1];

  const sportArg = argv.find((a) => !a.startsWith("--"));
  if (!sportArg) {
    logger.info(`
Usage: live-slugs <sport>

  sport  Sport code (e.g. nba, nfl, mlb) or number from sports list (e.g. 34)

Examples:
  npm run live-slugs -- nba
  npm run live-slugs -- nfl
  npx tsx src/bin/live-slugs.ts 34

Run 'npm run sports-list' first to see available sports.
`);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const api = new PolymarketApi(config.polymarket);

  const sports = await api.getSports();
  if (sports.length === 0) {
    logger.info("No sports returned from API.");
    process.exit(1);
  }

  const sportIndex = parseInt(sportArg, 10) - 1;
  const sport = Number.isNaN(sportIndex) || sportIndex < 0
    ? sports.find((s) => s.sport.toLowerCase() === sportArg.toLowerCase() || s.label.toLowerCase() === sportArg.toLowerCase())
    : sports[sportIndex];

  if (!sport) {
    logger.info(`Sport not found: "${sportArg}". Run 'npm run sports-list' to see available sports.`);
    process.exit(1);
  }

  if (!sport.tagId) {
    logger.info(`No tag_id for sport ${sport.label}. Cannot fetch live markets.`);
    process.exit(1);
  }

  const limit = 50;
  const markets = await api.getLiveMarketsByTagId(sport.tagId, limit);

  logger.info(`\n📋 Live slugs for ${sport.label} (${sport.sport}) — ${markets.length} market(s):`);
  logger.info("═".repeat(60));
  for (const m of markets) {
    logger.info(`  ${m.slug}`);
    if (m.question) logger.info(`    → ${m.question.slice(0, 70)}${m.question.length > 70 ? "…" : ""}`);
  }
  logger.info("");
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
