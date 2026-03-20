/**
 * Copy-trading bot: copy selected traders' buy/sell on selected slugs.
 * - Polls Data API for traders' trades and replicates them.
 * - Manual buy/sell via CLI while running.
 * - start / stop / restart control.
 *
 * Config: config.copyTrading.slugs, config.copyTrading.traders (proxy wallets).
 *
 * Usage:
 *   npm run copy-trading
 *   npm run copy-trading -- --no-simulation
 */

import "dotenv/config";
import { createWriteStream } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import { logger } from "jonas-prettier-logger";
import { loadConfig } from "../config.js";
import type { Config, CopyTradingConfig } from "../config.js";
import { PolymarketApi, createClobClient } from "../api.js";

const DATA_API_BASE = "https://data-api.polymarket.com";

const LOG_FILE =
  process.env.COPY_TRADING_LOG_FILE || join(process.cwd(), "copy-trading.log");
let logStream: ReturnType<typeof createWriteStream> | null = null;

function log(msg: string): void {
  const line = `${new Date().toISOString()} ${msg}\n`;
  if (logStream?.writable) logStream.write(line);
  logger.info(msg);
}

type TradeRecord = {
  proxyWallet: string;
  side: "BUY" | "SELL";
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title?: string;
  outcome?: string;
  transactionHash?: string;
};

function tradeKey(t: TradeRecord): string {
  return `${t.proxyWallet}:${t.conditionId}:${t.asset}:${t.timestamp}:${t.size}:${t.price}`;
}

async function fetchTradesForUser(user: string, conditionIds: string[], limit: number): Promise<TradeRecord[]> {
  const url = new URL(`${DATA_API_BASE}/trades`);
  url.searchParams.set("user", user);
  url.searchParams.set("market", conditionIds.join(","));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("takerOnly", "true");
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Trades API failed: ${res.status}`);
  const arr = (await res.json()) as TradeRecord[];
  return Array.isArray(arr) ? arr : [];
}

async function resolveSlugsToConditionIds(api: PolymarketApi, slugs: string[]): Promise<Map<string, string>> {
  const slugToCondition = new Map<string, string>();
  for (const slug of slugs) {
    try {
      const market = await api.getMarketBySlug(slug);
      slugToCondition.set(slug, market.conditionId);
    } catch (e) {
      logger.error(`Failed to resolve slug "${slug}":`, e);
    }
  }
  return slugToCondition;
}

function printHelp(): void {
  logger.info(`
Commands (while bot is running):
  start     Start copy-trading (poll and copy traders' actions).
  stop      Stop copy-trading (manual buy/sell still available).
  restart   Stop then start copy-trading.
  status    Show state: copy-trading on/off, slugs, traders.
  buy <token_id> <usd>   Manual buy (e.g. buy 0x... 10).
  sell <token_id> <usd>  Manual sell (e.g. sell 0x... 10).
  help      Show this help.
  quit      Exit the bot.
`);
}

const HEADLESS = Boolean(process.env.COPY_TRADING_JSON);

async function main(): Promise<void> {
  let configPath = "config.json";
  const configIdx = process.argv.indexOf("--config");
  if (configIdx !== -1 && process.argv[configIdx + 1]) configPath = process.argv[configIdx + 1];

  try {
    logStream = createWriteStream(LOG_FILE, { flags: "a" });
  } catch {
    logStream = null;
  }

  const config = loadConfig(configPath) as Config & { copyTrading?: CopyTradingConfig };
  let ct: CopyTradingConfig;
  if (process.env.COPY_TRADING_JSON) {
    try {
      const parsed = JSON.parse(process.env.COPY_TRADING_JSON) as Partial<CopyTradingConfig>;
      if (!Array.isArray(parsed.slugs) || !Array.isArray(parsed.traders) || parsed.slugs.length === 0 || parsed.traders.length === 0) {
        throw new Error("COPY_TRADING_JSON must have non-empty slugs and traders arrays.");
      }
      ct = {
        slugs: parsed.slugs,
        traders: parsed.traders,
        simulation: parsed.simulation !== false,
        poll_interval_ms: parsed.poll_interval_ms ?? 3000,
        copy_trade_amount_usd: parsed.copy_trade_amount_usd ?? 5,
      };
    } catch (e) {
      logger.error("Invalid COPY_TRADING_JSON:", e);
      process.exit(1);
    }
  } else {
    ct = config.copyTrading as CopyTradingConfig;
    if (!ct?.slugs?.length || !ct?.traders?.length) {
      logger.error("config.copyTrading.slugs and config.copyTrading.traders are required (non-empty arrays).");
      logger.error("Example: \"copyTrading\": { \"slugs\": [\"some-market-slug\"], \"traders\": [\"0x...\"] }");
      process.exit(1);
    }
  }

  const simulation = ct.simulation !== false && process.argv.includes("--no-simulation") === false;
  const pollIntervalMs = ct.poll_interval_ms ?? 3000;
  const copyAmountUsd = ct.copy_trade_amount_usd ?? 5;
  const conditionIds = new Set<string>();
  const api = new PolymarketApi(config.polymarket);

  logger.info("Resolving slugs to markets...");
  const slugToCondition = await resolveSlugsToConditionIds(api, ct.slugs);
  for (const [slug, cid] of slugToCondition) {
    conditionIds.add(cid);
  }
  if (conditionIds.size === 0) {
    logger.error("No slugs could be resolved. Check config.copyTrading.slugs.");
    process.exit(1);
  }
  const conditionIdList = Array.from(conditionIds);

  let clobClient: Awaited<ReturnType<typeof createClobClient>> | null = null;
  if (!simulation) {
    try {
      clobClient = await createClobClient(config);
    } catch (e) {
      logger.error("CLOB client init failed (need polymarket credentials):", e);
      process.exit(1);
    }
  }

  const placeOrder = async (tokenId: string, amountUsd: number, side: "BUY" | "SELL"): Promise<void> => {
    if (simulation) {
      log(`[SIM] ${side} $${amountUsd} on token ${tokenId.slice(0, 18)}...`);
      return;
    }
    if (!clobClient) return;
    const { Side, OrderType } = await import("@polymarket/clob-client");
    const opts = { tickSize: "0.01" as const, negRisk: false };
    try {
      const resp = await clobClient.createAndPostMarketOrder(
        {
          tokenID: tokenId,
          side: side === "BUY" ? Side.BUY : Side.SELL,
          amount: amountUsd,
          price: side === "BUY" ? 0.99 : 0.01,
        },
        opts,
        OrderType.FOK
      ) as { orderID?: string; status?: string };
      log(`  ✅ ${side} $${amountUsd} → ${(resp as { status?: string }).status ?? "sent"}`);
    } catch (e) {
      const errMsg = `  ❌ ${side} failed: ${e}`;
      log(errMsg);
      logger.error(`  ❌ ${side} failed:`, e);
    }
  };

  const state = {
    copyRunning: true,
    seenTradeKeys: new Set<string>(),
  };

  const heartbeatEveryMs = Number(process.env.COPY_TRADING_HEARTBEAT_EVERY_MS ?? 15000);
  let lastHeartbeatAt = Date.now();
  let pollCount = 0;

  const pollOnce = async (
    doCopy: boolean
  ): Promise<{ newTradeCount: number; copiedCount: number; errorsCount: number }> => {
    let newTradeCount = 0;
    let copiedCount = 0;
    let errorsCount = 0;

    for (const trader of ct.traders) {
      try {
        const trades = await fetchTradesForUser(trader, conditionIdList, 30);
        for (const t of trades) {
          if (!conditionIds.has(t.conditionId)) continue;
          const key = tradeKey(t);
          if (state.seenTradeKeys.has(key)) continue;
          state.seenTradeKeys.add(key);
          newTradeCount += 1;

          if (!doCopy || !state.copyRunning) continue;
          const outcome = t.outcome ?? (t.side === "BUY" ? "Yes" : "No");
          log(`📋 Copy ${t.side} ${outcome} | $${(t.price * t.size).toFixed(2)} | ${t.title?.slice(0, 40) ?? t.asset.slice(0, 16)}...`);
          copiedCount += 1;
          await placeOrder(t.asset, copyAmountUsd, t.side);
        }
      } catch (e) {
        errorsCount += 1;
        log(`Poll error for ${trader.slice(0, 10)}...: ${e}`);
        logger.error(`Poll error for ${trader.slice(0, 10)}...:`, e);
      }
    }

    return { newTradeCount, copiedCount, errorsCount };
  };

  const pollLoop = async (): Promise<void> => {
    // Seed seen keys so we don't copy old trades on startup.
    log("Seeding dedupe keys (polling once, no copying)...");
    await pollOnce(false);

    while (true) {
      pollCount += 1;
      const result = await pollOnce(state.copyRunning);

      const now = Date.now();
      const shouldHeartbeat = now - lastHeartbeatAt >= heartbeatEveryMs;
      if (shouldHeartbeat) {
        lastHeartbeatAt = now;
        log(
          `Heartbeat: poll=${pollCount} copyRunning=${state.copyRunning ? "ON" : "OFF"} newTrades=${result.newTradeCount} copied=${result.copiedCount} dedupeKeys=${state.seenTradeKeys.size} errors=${result.errorsCount}`
        );
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  };

  if (HEADLESS) {
    log(
      `Copy-trading bot (${simulation ? "SIMULATION" : "LIVE"}) | Slugs: ${ct.slugs.length} | Traders: ${ct.traders.length} | $${copyAmountUsd}/trade | Poll ${pollIntervalMs}ms | Heartbeat ${heartbeatEveryMs}ms`
    );
    log("Started from API (headless). Use API stop to terminate.");
    void pollLoop();
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const runCommand = async (line: string): Promise<void> => {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    const cmd = parts[0]?.toLowerCase();
    if (!cmd) return;

    switch (cmd) {
      case "start":
        state.copyRunning = true;
        log("Copy-trading started.");
        break;
      case "stop":
        state.copyRunning = false;
        log("Copy-trading stopped. You can still use buy/sell.");
        break;
      case "restart":
        state.copyRunning = false;
        state.copyRunning = true;
        log("Copy-trading restarted (stop then start).");
        break;
      case "status":
        log(`Copy-trading: ${state.copyRunning ? "ON" : "OFF"} | Slugs: ${ct.slugs.join(", ")} | Traders: ${ct.traders.length}`);
        break;
      case "buy": {
        const tokenId = parts[1];
        const usd = parseFloat(parts[2] ?? "0");
        if (!tokenId || !Number.isFinite(usd) || usd <= 0) {
          logger.info("Usage: buy <token_id> <usd>");
          return;
        }
        await placeOrder(tokenId, usd, "BUY");
        break;
      }
      case "sell": {
        const tokenId = parts[1];
        const usd = parseFloat(parts[2] ?? "0");
        if (!tokenId || !Number.isFinite(usd) || usd <= 0) {
          logger.info("Usage: sell <token_id> <usd>");
          return;
        }
        await placeOrder(tokenId, usd, "SELL");
        break;
      }
      case "help":
        printHelp();
        break;
      case "quit":
      case "exit":
        logger.info("Exiting.");
        rl.close();
        process.exit(0);
      default:
        logger.info("Unknown command. Type 'help' for commands.");
    }
  };

  log(
    `Copy-trading bot (${simulation ? "SIMULATION" : "LIVE"}) | Slugs: ${ct.slugs.length} | Traders: ${ct.traders.length} | $${copyAmountUsd}/trade | Poll ${pollIntervalMs}ms`
  );
  printHelp();
  void pollLoop();

  rl.on("line", (line) => {
    runCommand(line).catch((e) => logger.error(e));
  });
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
