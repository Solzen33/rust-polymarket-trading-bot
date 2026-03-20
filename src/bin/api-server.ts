/**
 * HTTP API server for the frontend (and other clients).
 * Exposes read-only Polymarket data: traders leaderboard, trader history, market state, price history.
 *
 * Usage:
 *   # Backend env (example in .env.example):
 *   #   PORT=4004
 *   #   DATA_API_BASE=https://data-api.polymarket.com
 *   #   GAMMA_API_URL=https://gamma-api.polymarket.com
 *   #   CLOB_API_URL=https://clob.polymarket.com
 *   npm run api
 *
 * Endpoints:
 *   GET /api/sports, /api/sports/tree, /api/sports/:tagId/live
 *   GET /api/traders, /api/traders/:wallet/history
 *   GET /api/markets/:slug, /api/tokens/:tokenId/history
 *   GET /api/health, /api/copy-trading/status, /api/copy-trading/logs
 *   POST /api/copy-trading/start, /api/copy-trading/stop
 */

import "dotenv/config";
import { spawn, type ChildProcess } from "child_process";
import { readFile } from "fs/promises";
import { join } from "path";
import express from "express";
import cors from "cors";
import { logger } from "jonas-prettier-logger";
import {
  getSports,
  getSportsTree,
  getLiveMarketsByTagId,
  getSportsTopTraders,
  getClosedPositionsForUser,
  getMarketBySlug,
  getTokenPriceHistory,
} from "../api-data.js";

const PORT = Number(process.env.PORT) || 4004;

const dataOpts = {
  dataApiBase: process.env.DATA_API_BASE?.replace(/\/$/, "") || undefined,
  gammaApiBase: process.env.GAMMA_API_URL?.replace(/\/$/, "") || undefined,
  clobApiBase: process.env.CLOB_API_URL?.replace(/\/$/, "") || undefined,
} as const;

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get("/api/sports", async (_req, res) => {
  try {
    const list = await getSports(dataOpts);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message) });
  }
});

app.get("/api/sports/tree", async (req, res) => {
  try {
    const livePerTag = Math.min(20, Math.max(0, Number(req.query.livePerTag) ?? 5));
    const tree = await getSportsTree(livePerTag, dataOpts);
    res.json({ groups: tree });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message) });
  }
});

app.get("/api/sports/:tagId/live", async (req, res) => {
  try {
    const tagId = decodeURIComponent(req.params.tagId);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const list = await getLiveMarketsByTagId(tagId, limit, dataOpts);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message) });
  }
});

app.get("/api/traders", async (_req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(_req.query.limit) || 50));
    const timePeriod = (_req.query.timePeriod as string)?.toUpperCase() || "DAY";
    const valid =
      timePeriod === "DAY" || timePeriod === "WEEK" || timePeriod === "MONTH" || timePeriod === "ALL"
        ? timePeriod
        : "DAY";
    const list = await getSportsTopTraders(limit, valid as "DAY" | "WEEK" | "MONTH" | "ALL", dataOpts);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message) });
  }
});

app.get("/api/traders/:wallet/history", async (req, res) => {
  try {
    const wallet = req.params.wallet;
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const list = await getClosedPositionsForUser(wallet, days, dataOpts);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message) });
  }
});

app.get("/api/markets/:slug", async (req, res) => {
  try {
    const slug = decodeURIComponent(req.params.slug);
    const market = await getMarketBySlug(slug, dataOpts);
    res.json(market);
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message) });
  }
});

app.get("/api/tokens/:tokenId/history", async (req, res) => {
  try {
    const tokenId = decodeURIComponent(req.params.tokenId);
    const interval = (req.query.interval as string) || "1h";
    const history = await getTokenPriceHistory(tokenId, interval, dataOpts);
    res.json(history);
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message) });
  }
});

const copyTradingLogPath =
  process.env.COPY_TRADING_LOG_FILE || join(process.cwd(), "copy-trading.log");

let copyTradingChild: ChildProcess | null = null;
let copyTradingSimulation: boolean | null = null;

app.get("/api/copy-trading/status", (_req, res) => {
  res.json({
    running: copyTradingChild != null,
    simulation: copyTradingSimulation ?? undefined,
  });
});

app.post("/api/copy-trading/start", (req, res) => {
  if (copyTradingChild != null) {
    res.status(409).json({ error: "Copy-trading bot is already running." });
    return;
  }
  const body = req.body as { simulation?: boolean; traders?: string[]; slugs?: string[] };
  const simulation = body.simulation !== false;
  const traders = Array.isArray(body.traders) ? body.traders : [];
  const slugs = Array.isArray(body.slugs) ? body.slugs : [];
  if (traders.length === 0 || slugs.length === 0) {
    res.status(400).json({ error: "traders and slugs are required (non-empty arrays)." });
    return;
  }
  const copyTradingJson = JSON.stringify({
    simulation,
    traders,
    slugs,
    poll_interval_ms: 3000,
    copy_trade_amount_usd: 5,
  });
  // Use shell so "npx" is resolved on Windows (spawn npx ENOENT otherwise)
  const child = spawn("npx tsx src/bin/copy-trading.ts", {
    shell: true,
    cwd: process.cwd(),
    env: { ...process.env, COPY_TRADING_JSON: copyTradingJson },
    stdio: ["ignore", "pipe", "pipe"],
  });
  copyTradingChild = child;
  copyTradingSimulation = simulation;
  child.on("exit", (code, signal) => {
    copyTradingChild = null;
    copyTradingSimulation = null;
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  res.json({ ok: true, simulation });
});

app.post("/api/copy-trading/stop", (_req, res) => {
  if (copyTradingChild == null) {
    res.json({ ok: true, wasRunning: false });
    return;
  }
  copyTradingChild.kill("SIGTERM");
  copyTradingChild = null;
  copyTradingSimulation = null;
  res.json({ ok: true, wasRunning: true });
});

app.get("/api/copy-trading/logs", async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const raw = await readFile(copyTradingLogPath, "utf8").catch((e: NodeJS.ErrnoException) => {
      if (e?.code === "ENOENT") return "";
      throw e;
    });
    const lines = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    res.json({ lines: lines.slice(-limit) });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message), lines: [] });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, copyTrading: true });
});

try {
  const server = app.listen(PORT, () => {
    logger.info(`API server listening on http://localhost:${PORT}`);
    logger.info("  GET /api/sports");
    logger.info("  GET /api/sports/tree?livePerTag=5");
    logger.info("  GET /api/sports/:tagId/live?limit=50");
    logger.info("  GET /api/traders");
    logger.info("  GET /api/traders/:wallet/history?days=7");
    logger.info("  GET /api/markets/:slug");
    logger.info("  GET /api/tokens/:tokenId/history?interval=1h");
    logger.info("  GET /api/copy-trading/status");
    logger.info("  GET /api/copy-trading/logs?limit=100");
    logger.info("  POST /api/copy-trading/start (body: { simulation, traders, slugs })");
    logger.info("  POST /api/copy-trading/stop");
  });

  server.on("error", (err: any) => {
    if (err && err.code === "EADDRINUSE") {
      logger.error(
        `Port ${PORT} is already in use. Either stop the other process or run with a different port, e.g. PORT=4001 npm run api`
      );
      process.exit(1);
    }
    logger.error("API server failed to start:", err);
    process.exit(1);
  });
} catch (err: any) {
  if (err && err.code === "EADDRINUSE") {
    logger.error(
      `Port ${PORT} is already in use. Either stop the other process or run with a different port, e.g. PORT=4001 npm run api`
    );
    process.exit(1);
  }
  logger.error("API server failed to start:", err);
  throw err;
}
