/**
 * Multi-asset 15m UP/DOWN threshold bot (BTC / ETH / SOL / XRP): buy on cross of `buyPrice`, per-position TP/SL.
 *
 *   npx tsx src/main.ts --simulation
 *   npx tsx src/main.ts --no-simulation
 *   npx tsx src/main.ts -c config.json --threshold-config threshold-strategy.config.example.json
 */

import { readFileSync, existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { PolymarketApi } from "./api.js";
import { createClobClient } from "./clob.js";
import { currentPeriodTimestamp, PERIOD_SEC } from "./period.js";
import type { Market, TokenPrice } from "./types.js";
import logger from "./logger.js";
import {
  ASSET_META,
  enabledAssetKeys,
  type TradingAssetKey,
} from "./trading-assets.js";
import {
  ThresholdStrategy,
  PositionManager,
  SimulationThresholdExecutor,
  LiveThresholdExecutor,
  mergeThresholdConfig,
  midFromTokenPrice,
  buildPeriodPnlSummary,
  formatPeriodPnlBanner,
  type ThresholdStrategyConfig,
  type TickContext,
} from "./strategy/threshold/index.js";
import { TradeHistoryWriter } from "./trading-history.js";

const strategyLog = {
  info: (msg: string) => logger.info(msg),
  warn: (msg: string) => logger.warn(msg),
  error: (msg: string) => logger.error(msg),
};

function parseArgs(): {
  simulation: boolean;
  configPath: string;
  thresholdConfigPath: string | null;
} {
  const argv = process.argv.slice(2);
  let simulation = true;
  let configPath = "config.json";
  let thresholdConfigPath: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-simulation" || a === "--live") simulation = false;
    else if (a === "--simulation") simulation = true;
    else if (a === "-c" || a === "--config") configPath = argv[++i] ?? configPath;
    else if (a === "--threshold-config") thresholdConfigPath = argv[++i] ?? null;
  }
  return { simulation, configPath, thresholdConfigPath };
}

function fmtPx(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 0.1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(5);
}

function formatTimeRemaining(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function logSelectedMarketPrices(
  label: string,
  slug: string,
  timeRemainingSeconds: number,
  up: TokenPrice,
  down: TokenPrice
): void {
  const upMid = midFromTokenPrice(up);
  const downMid = midFromTokenPrice(down);
  logger.info(
    `[${label}] ${slug} | ` +
      `UP bid/ask/mid ${fmtPx(up.bid)}/${fmtPx(up.ask)}/${fmtPx(upMid)} | ` +
      `DOWN bid/ask/mid ${fmtPx(down.bid)}/${fmtPx(down.ask)}/${fmtPx(downMid)} | ` +
      `⏱ ${formatTimeRemaining(timeRemainingSeconds)}`
  );
}

function loadThresholdOverrides(path: string | null): Partial<ThresholdStrategyConfig> {
  if (!path || !existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Partial<ThresholdStrategyConfig>;
  } catch (e) {
    logger.warn(`Could not load threshold config ${path}: ${String(e)}`);
    return {};
  }
}

async function fetchBooksForMarket(api: PolymarketApi, market: Market): Promise<{
  up: TokenPrice | null;
  down: TokenPrice | null;
}> {
  const tokens = market.tokens ?? [];
  let upId: string | null = null;
  let downId: string | null = null;
  for (const t of tokens) {
    const id = t.tokenId ?? t.token_id ?? "";
    const outcome = (t.outcome ?? "").toUpperCase();
    if (outcome.includes("UP") || outcome === "1") upId = id;
    else if (outcome.includes("DOWN") || outcome === "0") downId = id;
  }
  async function book(tokenId: string): Promise<TokenPrice> {
    const b = await api.getOrderBook(tokenId);
    const bidPrices = (b.bids ?? []).map((x) => parseFloat(x.price)).filter((n) => Number.isFinite(n));
    const askPrices = (b.asks ?? []).map((x) => parseFloat(x.price)).filter((n) => Number.isFinite(n));
    const bestBid = bidPrices.length > 0 ? Math.max(...bidPrices) : null;
    const bestAsk = askPrices.length > 0 ? Math.min(...askPrices) : null;
    return { token_id: tokenId, bid: bestBid, ask: bestAsk };
  }
  const [upPx, downPx] = await Promise.all([
    upId ? book(upId) : Promise.resolve(null),
    downId ? book(downId) : Promise.resolve(null),
  ]);
  return { up: upPx, down: downPx };
}

/** Discover active 15m market for slug prefix `{prefix}-{periodTs}` (tries current + previous periods). */
async function discoverUpDown15m(api: PolymarketApi, slugPrefix: string): Promise<Market | null> {
  const now = Math.floor(Date.now() / 1000);
  const rounded = Math.floor(now / PERIOD_SEC) * PERIOD_SEC;
  for (let offset = 0; offset <= 4; offset++) {
    const t = rounded - offset * PERIOD_SEC;
    const slug = `${slugPrefix}-${t}`;
    try {
      const m = await api.getMarketBySlug(slug);
      if (m.active && !m.closed) {
        if (!m.tokens?.length) {
          const clob = await api.getMarketByConditionId(m.conditionId);
          m.tokens = clob.tokens as Market["tokens"];
        }
        return m;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

interface AssetRunner {
  key: TradingAssetKey;
  slugPrefix: string;
  label: string;
  positions: PositionManager;
  strategy: ThresholdStrategy;
  cachedMarket: Market | null;
  cachedPeriod: number | null;
}

async function main(): Promise<void> {
  const { simulation, configPath, thresholdConfigPath } = parseArgs();
  const rootConfig = loadConfig(configPath);
  const thresholdCfg = mergeThresholdConfig(loadThresholdOverrides(thresholdConfigPath));

  if (!simulation && !rootConfig.polymarket.private_key) {
    logger.error("Live mode requires polymarket.private_key in config.json");
    process.exit(1);
  }

  const api = new PolymarketApi(rootConfig.polymarket);

  let executor: SimulationThresholdExecutor | LiveThresholdExecutor;
  if (simulation) {
    executor = new SimulationThresholdExecutor();
  } else {
    const clobClient = await createClobClient(rootConfig.polymarket);
    await clobClient.getOk();
    logger.info("CLOB session OK");
    executor = new LiveThresholdExecutor(clobClient);
  }

  const assets = enabledAssetKeys(rootConfig.trading);
  const runners: AssetRunner[] = assets.map((key) => {
    const meta = ASSET_META[key];
    const positions = new PositionManager();
    return {
      key,
      slugPrefix: meta.slugPrefix,
      label: meta.label,
      positions,
      strategy: new ThresholdStrategy(thresholdCfg, positions, executor, strategyLog),
      cachedMarket: null,
      cachedPeriod: null,
    };
  });

  const historyWriter = new TradeHistoryWriter();
  await historyWriter.appendSession({ simulation, assets });
  for (const r of runners) {
    r.positions.setOnClosed((closed) => {
      historyWriter.appendTradeClose(closed, { simulation });
    });
  }

  logger.info(
    `Threshold strategy | assets=${assets.map((k) => ASSET_META[k].label).join(",")} | simulation=${simulation} | ` +
      `std: buy>=${thresholdCfg.buyPrice} TP=${thresholdCfg.takeProfitPrice} SL=${thresholdCfg.stopLossPrice} ` +
      `minRemain=${thresholdCfg.minRemainingSeconds}s shares=${thresholdCfg.sharesPerOrder} | ` +
      `late: ${thresholdCfg.latePhaseEnabled ? `last<=${thresholdCfg.latePhaseWindowSeconds}s buy>=${thresholdCfg.latePhaseBuyPrice} TP>=${thresholdCfg.latePhaseSellPrice} SL<=${thresholdCfg.latePhaseStopLossPrice}` : "off"}`
  );

  let lastSuccessfulPeriod: number | null = null;

  for (;;) {
    try {
      const period = currentPeriodTimestamp();
      const now = Math.floor(Date.now() / 1000);
      const timeRemaining = Math.max(0, period + PERIOD_SEC - now);

      let anyOk = false;

      for (const r of runners) {
        if (r.cachedPeriod !== period || !r.cachedMarket) {
          const m = await discoverUpDown15m(api, r.slugPrefix);
          if (!m) {
            r.cachedMarket = null;
            r.cachedPeriod = period;
            logger.warn(`[${r.label}] No active market for prefix ${r.slugPrefix} (period ${period})`);
            continue;
          }
          r.cachedMarket = m;
          r.cachedPeriod = period;
          logger.info(`[${r.label}] Using market slug=${m.slug} condition=${m.conditionId}`);
        }

        const market = r.cachedMarket;
        if (!market) continue;

        const { up, down } = await fetchBooksForMarket(api, market);
        const upId = up?.token_id ?? "";
        const downId = down?.token_id ?? "";
        if (!upId || !downId || !up || !down) {
          logger.warn(`[${r.label}] Missing UP/DOWN token ids or books; skipping this tick`);
          continue;
        }

        const tick: TickContext = {
          periodTimestamp: period,
          timeRemainingSeconds: timeRemaining,
          marketSlug: market.slug,
          assetKey: r.key,
          conditionId: market.conditionId,
          upTokenId: upId,
          downTokenId: downId,
          upPrice: up,
          downPrice: down,
        };

        logSelectedMarketPrices(r.label, market.slug, timeRemaining, up, down);
        await r.strategy.onTick(tick);
        anyOk = true;
      }

      if (anyOk && lastSuccessfulPeriod !== null && lastSuccessfulPeriod !== period) {
        for (const r of runners) {
          const slugForPeriod = `${r.slugPrefix}-${lastSuccessfulPeriod}`;
          const summary = buildPeriodPnlSummary(r.positions.getAll(), lastSuccessfulPeriod, {
            marketSlug: slugForPeriod,
            assetLabel: r.label,
          });
          for (const line of formatPeriodPnlBanner(summary)) {
            logger.info(line);
          }
          const conditionId =
            r.positions
              .getAll()
              .find(
                (p) => p.periodTimestamp === lastSuccessfulPeriod && p.status === "closed"
              )?.conditionId ?? "";
          historyWriter.appendPeriodPnl(summary, {
            simulation,
            assetKey: r.key,
            conditionId,
          });
          r.positions.pruneClosed(2000);
        }
      }
      if (anyOk) {
        lastSuccessfulPeriod = period;
      }
    } catch (e) {
      logger.error(`tick error: ${String(e)}`);
    }

    await new Promise((res) => setTimeout(res, thresholdCfg.checkIntervalMs));
  }
}

main().catch((e) => {
  logger.error(String(e));
  process.exit(1);
});
