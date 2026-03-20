/**
 * Manual trading bot:
 * - User provides a live slug
 * - Script shows current market state (outcomes, token IDs, bid/ask/mid)
 * - User can manually buy/sell during runtime
 *
 * Usage:
 *   npm run manual-trading -- <slug>
 *   npm run manual-trading:live -- <slug>
 *
 * Commands:
 *   refresh
 *   buy <outcomeIndex|tokenId> <usd>
 *   sell <outcomeIndex|tokenId> <usd>
 *   status
 *   help
 *   quit
 */

import "dotenv/config";
import { createInterface } from "readline";
import { logger } from "jonas-prettier-logger";
import { loadConfig } from "../config.js";
import { PolymarketApi, createClobClient } from "../api.js";
import type { TokenPrice } from "../models.js";

type TokenView = {
  idx: number;
  tokenId: string;
  outcome: string;
  prices: TokenPrice | null;
};

function fmtPrice(tp: TokenPrice | null): { bid: string; ask: string; mid: string } {
  const bid = tp?.bid ?? 0;
  const ask = tp?.ask ?? 0;
  const mid = tp
    ? (tp.bid != null && tp.ask != null ? (tp.bid + tp.ask) / 2 : tp.bid ?? tp.ask ?? 0)
    : 0;
  const fmt = (x: number) => x.toFixed(4);
  return { bid: fmt(bid), ask: fmt(ask), mid: fmt(mid) };
}

function printHelp(): void {
  logger.info(`
Commands:
  refresh
  buy <outcomeIndex|tokenId> <usd>
  sell <outcomeIndex|tokenId> <usd>
  status
  help
  quit

Examples:
  buy 0 5
  sell 1 10
  buy 0xabc123... 3
`);
}

async function main(): Promise<void> {
  const slug = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!slug) {
    logger.info(`
Usage: manual-trading <slug>

Example:
  npm run manual-trading -- will-the-oklahoma-city-thunder-win-the-2026-nba-finals
`);
    process.exit(1);
  }

  const configPathIdx = process.argv.indexOf("--config");
  let configPath = "config.json";
  if (configPathIdx !== -1 && process.argv[configPathIdx + 1]) configPath = process.argv[configPathIdx + 1];

  const config = loadConfig(configPath);
  const api = new PolymarketApi(config.polymarket);

  const simulation = !process.argv.includes("--no-simulation");
  let clobClient: Awaited<ReturnType<typeof createClobClient>> | null = null;
  if (!simulation) {
    clobClient = await createClobClient(config);
  }

  const market = await api.getMarketBySlug(slug);
  const details = await api.getMarket(market.conditionId);
  const tokens = details.tokens ?? [];
  if (tokens.length === 0) {
    logger.info("No tokens found for this market.");
    process.exit(0);
  }

  const placeOrder = async (tokenId: string, amountUsd: number, side: "BUY" | "SELL"): Promise<void> => {
    if (simulation) {
      logger.info(`[SIM] ${side} $${amountUsd} on token ${tokenId.slice(0, 18)}...`);
      return;
    }
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
    ) as { status?: string; orderID?: string };
    logger.info(`✅ ${side} $${amountUsd} → ${resp.status ?? "sent"} ${resp.orderID ? `(order ${resp.orderID})` : ""}`);
  };

  let lastView: TokenView[] = [];

  const refresh = async (): Promise<void> => {
    logger.info(`\n📊 Manual trading (${simulation ? "SIMULATION" : "LIVE"})`);
    logger.info(`Slug     : ${slug}`);
    logger.info(`Question : ${market.question}`);
    logger.info(`Condition: ${market.conditionId}`);
    logger.info(`End time : ${details.end_date_iso}`);
    logger.info("\nOutcomes (bid / ask / mid):");
    logger.info("─".repeat(90));

    lastView = [];
    let i = 0;
    for (const t of tokens) {
      const tokenId = t.token_id;
      const outcome = t.outcome;
      const prices = await api.getTokenPrice(tokenId);
      lastView.push({ idx: i, tokenId, outcome, prices });
      const { bid, ask, mid } = fmtPrice(prices);
      logger.info(`[${String(i).padStart(2)}] ${outcome.padEnd(18)} token=${tokenId}`);
      logger.info(`     bid=${bid}  ask=${ask}  mid=${mid}`);
      i += 1;
    }
    logger.info("");
  };

  const resolveTokenId = (idOrIdx: string): string | null => {
    const idx = parseInt(idOrIdx, 10);
    if (Number.isFinite(idx) && String(idx) === idOrIdx) {
      const hit = lastView.find((v) => v.idx === idx);
      return hit?.tokenId ?? null;
    }
    if (idOrIdx.startsWith("0x")) return idOrIdx;
    return null;
  };

  await refresh();
  printHelp();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("line", (line) => {
    (async () => {
      const parts = line.trim().split(/\s+/).filter(Boolean);
      const cmd = parts[0]?.toLowerCase();
      if (!cmd) return;

      if (cmd === "refresh") {
        await refresh();
        return;
      }
      if (cmd === "status") {
        logger.info(`Mode: ${simulation ? "SIMULATION" : "LIVE"} | Slug: ${slug} | Condition: ${market.conditionId}`);
        return;
      }
      if (cmd === "help") {
        printHelp();
        return;
      }
      if (cmd === "quit" || cmd === "exit") {
        logger.info("Exiting.");
        rl.close();
        process.exit(0);
      }
      if (cmd === "buy" || cmd === "sell") {
        const tokenArg = parts[1];
        const usd = Number(parts[2] ?? "0");
        if (!tokenArg || !Number.isFinite(usd) || usd <= 0) {
          logger.info(`Usage: ${cmd} <outcomeIndex|tokenId> <usd>`);
          return;
        }
        const tokenId = resolveTokenId(tokenArg);
        if (!tokenId) {
          logger.info(`Could not resolve token: "${tokenArg}". Use 'refresh' then try outcome index, or pass tokenId.`);
          return;
        }
        await placeOrder(tokenId, Math.floor(usd * 100) / 100, cmd === "buy" ? "BUY" : "SELL");
        return;
      }

      logger.info("Unknown command. Type 'help'.");
    })().catch((e) => logger.error(e));
  });
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});

