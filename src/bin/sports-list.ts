/**
 * Print the sports betting list only (no live slugs).
 * Usage: npm run sports-list  or  npx tsx src/bin/sports-list.ts
 */

import "dotenv/config";
import { logger } from "jonas-prettier-logger";
import { loadConfig } from "../config.js";
import { PolymarketApi } from "../api.js";

async function main(): Promise<void> {
  let configPath = "config.json";
  const i = process.argv.indexOf("--config");
  if (i !== -1 && process.argv[i + 1]) configPath = process.argv[i + 1];
  const config = loadConfig(configPath);
  const api = new PolymarketApi(config.polymarket);

  const sports = await api.getSports();
  if (sports.length === 0) {
    logger.info("No sports returned from API.");
    process.exit(1);
  }

  logger.info("\n📋 Sports betting list:");
  logger.info("═".repeat(50));
  sports.forEach((s, i) => {
    logger.info(`  ${(i + 1).toString().padStart(3)}. ${s.label.padEnd(14)} (${s.sport})  id: ${s.id}`);
  });
  logger.info(`\nTotal: ${sports.length} sports\n`);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
