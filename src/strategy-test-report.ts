import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import axios from "axios";
import { loadConfig } from "./config.js";
import type { TokenType } from "./types.js";

interface HistoryOrder {
  token_type: TokenType;
  period_timestamp: number;
  price: number;
  shares: number;
  notional: number;
}

interface HistoryEntry {
  timestamp: string;
  orderCount: number;
  totalNotional: number;
  orders: HistoryOrder[];
}

interface ReportRow {
  pnl: number;
  trades: number;
  wins: number;
}

type Direction = "Up" | "Down";

interface MarketResult {
  winner: Direction | null;
}

function parseArgs(): { historyDir: string; configPath: string } {
  const args = process.argv.slice(2);
  let historyDir = "history";
  let configPath = "config.json";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--history-dir") historyDir = args[++i] ?? historyDir;
    else if (args[i] === "-c" || args[i] === "--config") configPath = args[++i] ?? configPath;
  }
  return { historyDir, configPath };
}

function tokenTypeDirection(t: TokenType): Direction {
  return t.endsWith("Up") ? "Up" : "Down";
}

function tokenTypeAsset(t: TokenType): "btc" | "eth" | "sol" | "xrp" {
  if (t.startsWith("Btc")) return "btc";
  if (t.startsWith("Eth")) return "eth";
  if (t.startsWith("Solana")) return "sol";
  return "xrp";
}

function utcDayFromPeriod(periodTs: number): string {
  return new Date(periodTs * 1000).toISOString().slice(0, 10);
}

function formatSigned(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(4)}`;
}

function pct(v: number): string {
  return `${v.toFixed(2)}%`;
}

async function readHistoryOrders(historyDir: string): Promise<HistoryOrder[]> {
  const files = (await readdir(historyDir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const all: HistoryOrder[] = [];
  for (const file of files) {
    const text = await readFile(join(historyDir, file), "utf8");
    const lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const line of lines) {
      const entry = JSON.parse(line) as HistoryEntry;
      if (Array.isArray(entry.orders)) {
        for (const order of entry.orders) {
          if (
            order &&
            typeof order.token_type === "string" &&
            typeof order.period_timestamp === "number" &&
            typeof order.price === "number" &&
            typeof order.shares === "number" &&
            typeof order.notional === "number"
          ) {
            all.push(order);
          }
        }
      }
    }
  }
  return all;
}

async function getMarketResult(
  gammaUrl: string,
  clobUrl: string,
  asset: "btc" | "eth" | "sol" | "xrp",
  periodTs: number
): Promise<MarketResult> {
  const slug = `${asset}-updown-15m-${periodTs}`;
  const gammaBase = gammaUrl.replace(/\/$/, "");
  const clobBase = clobUrl.replace(/\/$/, "");

  const ev = await axios.get<{ markets?: Array<{ conditionId?: string; condition_id?: string }> }>(
    `${gammaBase}/events/slug/${encodeURIComponent(slug)}`,
    { timeout: 15_000 }
  );
  const first = ev.data?.markets?.[0];
  const conditionId = String(first?.conditionId ?? first?.condition_id ?? "");
  if (!conditionId) return { winner: null };

  const m = await axios.get<{ closed?: boolean; tokens?: Array<{ outcome?: string; winner?: boolean }> }>(
    `${clobBase}/markets/${conditionId}`,
    { timeout: 15_000 }
  );
  const closed = Boolean(m.data?.closed);
  const tokens = Array.isArray(m.data?.tokens) ? m.data.tokens : [];
  const winnerToken = tokens.find((t) => Boolean(t.winner));
  const outcome = String(winnerToken?.outcome ?? "");
  const winner = /up/i.test(outcome) ? "Up" : /down/i.test(outcome) ? "Down" : null;
  if (!closed || winner === null) return { winner: null };
  return { winner };
}

async function main(): Promise<void> {
  const { historyDir, configPath } = parseArgs();
  const cfg = loadConfig(configPath);
  const orders = await readHistoryOrders(historyDir);
  if (orders.length === 0) {
    console.log(`No orders found in ${historyDir}`);
    return;
  }

  const marketCache = new Map<string, MarketResult>();
  const dayRows = new Map<string, ReportRow>();
  let trades = 0;
  let upTrades = 0;
  let downTrades = 0;
  let wins = 0;
  let totalCost = 0;
  let totalPnl = 0;
  const seenMarkets = new Set<string>();

  for (const o of orders) {
    const asset = tokenTypeAsset(o.token_type);
    const direction = tokenTypeDirection(o.token_type);
    const marketKey = `${asset}:${o.period_timestamp}`;
    seenMarkets.add(marketKey);

    let market = marketCache.get(marketKey);
    if (!market) {
      try {
        market = await getMarketResult(cfg.polymarket.gamma_api_url, cfg.polymarket.clob_api_url, asset, o.period_timestamp);
      } catch {
        market = { winner: null };
      }
      marketCache.set(marketKey, market);
    }
    if (market.winner === null) continue;

    const isWin = market.winner === direction;
    const pnl = isWin ? o.shares * (1 - o.price) : -o.shares * o.price;
    const day = utcDayFromPeriod(o.period_timestamp);
    const row = dayRows.get(day) ?? { pnl: 0, trades: 0, wins: 0 };
    row.pnl += pnl;
    row.trades += 1;
    row.wins += isWin ? 1 : 0;
    dayRows.set(day, row);

    trades += 1;
    upTrades += direction === "Up" ? 1 : 0;
    downTrades += direction === "Down" ? 1 : 0;
    wins += isWin ? 1 : 0;
    totalCost += o.notional;
    totalPnl += pnl;
  }

  if (trades === 0) {
    console.log("No resolved markets yet. Run this again after markets resolve.");
    return;
  }

  const accuracy = (wins / trades) * 100;
  console.log(`mode:                 15m`);
  console.log(`markets:              ${seenMarkets.size.toLocaleString()}`);
  console.log(`trades:               ${trades.toLocaleString()}`);
  console.log(`up_trades:            ${upTrades.toLocaleString()}`);
  console.log(`down_trades:          ${downTrades.toLocaleString()}`);
  console.log(`directional_accuracy: ${pct(accuracy)}`);
  console.log(`win_rate:             ${pct(accuracy)}`);
  console.log(`avg_cost_per_trade:   ${(totalCost / trades).toFixed(4)}`);
  console.log(`total_cost:           ${totalCost.toFixed(4)}`);
  console.log(`avg_pnl_per_trade:    ${formatSigned(totalPnl / trades)}`);
  console.log(`total_pnl:            ${formatSigned(totalPnl)}`);
  console.log("");
  console.log("Daily PnL (UTC):");

  const days = [...dayRows.keys()].sort();
  for (const day of days) {
    const r = dayRows.get(day)!;
    const wr = r.trades > 0 ? (r.wins / r.trades) * 100 : 0;
    console.log(
      `  ${day}  pnl=${formatSigned(r.pnl)}  trades=${String(r.trades).padStart(3, " ")}  win_rate=${pct(wr)}`
    );
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});

