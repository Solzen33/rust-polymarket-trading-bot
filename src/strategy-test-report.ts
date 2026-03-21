/**
 * Strategy test report from JSONL history (UTC). Run: `npm run report` or `npx tsx src/strategy-test-report.ts`
 *
 *   npx tsx src/strategy-test-report.ts --history-dir ./history
 *   npx tsx src/strategy-test-report.ts --scale 100
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { HISTORY_KIND_TRADE_CLOSE, type TradeCloseHistoryRow } from "./trading-history.js";

const LABEL_W = 22;

function padLabel(label: string): string {
  return `${label.padEnd(LABEL_W)}`;
}

function fmtNum(n: number, decimals: number, withSign = false): string {
  const s = n.toFixed(decimals);
  if (!withSign) return s;
  if (n > 0) return `+${s}`;
  return s;
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function parseArgs(): { historyDir: string; scale: number; marketsAsTrades: boolean } {
  const argv = process.argv.slice(2);
  let historyDir = join(process.cwd(), "history");
  let scale = 100;
  let marketsAsTrades = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--history-dir") historyDir = argv[++i] ?? historyDir;
    else if (a === "--scale") scale = Number(argv[++i] ?? "100") || 1;
    else if (a === "--markets-as-trades") marketsAsTrades = true;
  }
  return { historyDir, scale, marketsAsTrades };
}

async function loadTradeCloses(dir: string): Promise<TradeCloseHistoryRow[]> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files = names.filter((n) => n.endsWith(".jsonl"));
  const out: TradeCloseHistoryRow[] = [];
  for (const f of files) {
    const text = await readFile(join(dir, f), "utf-8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const row = JSON.parse(t) as { kind?: string };
        if (row.kind === HISTORY_KIND_TRADE_CLOSE) {
          out.push(row as TradeCloseHistoryRow);
        }
      } catch {
        /* skip bad line */
      }
    }
  }
  return out;
}

interface DayAgg {
  pnl: number;
  trades: number;
  wins: number;
}

function aggregate(
  trades: TradeCloseHistoryRow[],
  scale: number,
  marketsAsTrades: boolean
): void {
  if (trades.length === 0) {
    console.log("No trade_close rows found. Run the bot to build history under history/*.jsonl");
    return;
  }

  const uniqueConditions = new Set(trades.map((t) => t.conditionId)).size;
  const markets = marketsAsTrades ? trades.length : uniqueConditions;
  const upTrades = trades.filter((t) => t.side === "UP");
  const downTrades = trades.filter((t) => t.side === "DOWN");
  const wins = trades.filter((t) => t.pnl > 0);

  const totalCostRaw = trades.reduce((s, t) => s + t.cost, 0);
  const totalPnlRaw = trades.reduce((s, t) => s + t.pnl, 0);

  const totalCost = totalCostRaw * scale;
  const totalPnl = totalPnlRaw * scale;
  const avgCost = (totalCostRaw / trades.length) * scale;
  const avgPnl = (totalPnlRaw / trades.length) * scale;

  const winRate = (wins.length / trades.length) * 100;
  /** Without on-chain resolution in history, align with profitable-trade rate (sample uses same value). */
  const directionalAccuracy = winRate;

  console.log("");
  console.log(padLabel("mode:") + "15m");
  console.log(padLabel("markets:") + fmtInt(markets));
  console.log(padLabel("trades:") + fmtInt(trades.length));
  console.log(padLabel("up_trades:") + fmtInt(upTrades.length));
  console.log(padLabel("down_trades:") + fmtInt(downTrades.length));
  console.log(padLabel("directional_accuracy:") + `${directionalAccuracy.toFixed(2)}%`);
  console.log(padLabel("win_rate:") + `${winRate.toFixed(2)}%`);
  console.log(padLabel("avg_cost_per_trade:") + fmtNum(avgCost, 4));
  console.log(padLabel("total_cost:") + fmtNum(totalCost, 4));
  console.log(padLabel("avg_pnl_per_trade:") + fmtNum(avgPnl, 4, true));
  console.log(padLabel("total_pnl:") + fmtNum(totalPnl, 4, true));
  console.log("");

  const byDay = new Map<string, DayAgg>();
  for (const t of trades) {
    const day = new Date(t.closedAtMs).toISOString().slice(0, 10);
    let g = byDay.get(day);
    if (!g) {
      g = { pnl: 0, trades: 0, wins: 0 };
      byDay.set(day, g);
    }
    g.pnl += t.pnl * scale;
    g.trades += 1;
    if (t.pnl > 0) g.wins += 1;
  }

  const days = [...byDay.keys()].sort();
  console.log("Daily PnL (UTC):");
  for (const d of days) {
    const g = byDay.get(d)!;
    const wr = g.trades > 0 ? (g.wins / g.trades) * 100 : 0;
    console.log(
      `  ${d}  pnl=${fmtNum(g.pnl, 4, true)}  trades=${g.trades}  win_rate=${wr.toFixed(2)}%`
    );
  }
  console.log("");
}

const { historyDir, scale, marketsAsTrades } = parseArgs();
loadTradeCloses(historyDir)
  .then((trades) => aggregate(trades, scale, marketsAsTrades))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
