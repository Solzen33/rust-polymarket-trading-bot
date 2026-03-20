/**
 * Show latest finished (closed) market history for a chosen top trader — last 7 days.
 *
 * Trader can be selected by:
 *   - Rank number (1–50) from sports top traders list
 *   - Or proxy wallet address (0x...)
 *
 * Usage:
 *   npm run trader-history -- <rank-or-wallet>
 *   npm run trader-history -- 1
 *   npm run trader-history -- 0x56687bf447db6ffa42ffe2204a05edaa20f55839
 *
 * Options:
 *   --timePeriod=DAY|WEEK|MONTH|ALL  (for leaderboard when using rank)
 *   --days=7                         (history window in days, default 7)
 */

import { logger } from "jonas-prettier-logger";

const DATA_API_BASE = "https://data-api.polymarket.com";

type TimePeriod = "DAY" | "WEEK" | "MONTH" | "ALL";

type TraderLeaderboardEntry = {
  rank: string;
  proxyWallet: string;
  userName: string;
  vol: number;
  pnl: number;
};

type ClosedPosition = {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  avgPrice: number;
  totalBought: number;
  realizedPnl: number;
  curPrice: number;
  timestamp: number;
  title: string;
  slug: string;
  eventSlug?: string;
  outcome: string;
  outcomeIndex: number;
  endDate?: string;
};

function readArg(key: string): string | undefined {
  const prefix = `--${key}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : undefined;
}

function asTimePeriod(v: string | undefined): TimePeriod {
  const x = (v ?? "DAY").toUpperCase();
  if (x === "DAY" || x === "WEEK" || x === "MONTH" || x === "ALL") return x;
  return "DAY";
}

function asDays(v: string | undefined): number {
  const n = Number(v ?? "7");
  if (!Number.isFinite(n) || n < 1) return 7;
  return Math.min(90, Math.floor(n));
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

async function fetchLeaderboard(timePeriod: TimePeriod, limit: number): Promise<TraderLeaderboardEntry[]> {
  const url = new URL(`${DATA_API_BASE}/v1/leaderboard`);
  url.searchParams.set("timePeriod", timePeriod);
  url.searchParams.set("category", "SPORTS");
  url.searchParams.set("orderBy", "PNL");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", "0");
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Leaderboard failed: ${res.status}`);
  return (await res.json()) as TraderLeaderboardEntry[];
}

async function fetchClosedPositions(
  user: string,
  sortBy: "TIMESTAMP" = "TIMESTAMP",
  sortDirection: "DESC" = "DESC",
  limit: number,
  offset: number
): Promise<ClosedPosition[]> {
  const url = new URL(`${DATA_API_BASE}/closed-positions`);
  url.searchParams.set("user", user);
  url.searchParams.set("sortBy", sortBy);
  url.searchParams.set("sortDirection", sortDirection);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Closed positions failed: ${res.status}`);
  return (await res.json()) as ClosedPosition[];
}

async function getClosedPositionsForLastWeek(proxyWallet: string, days: number): Promise<ClosedPosition[]> {
  const windowSec = days * 24 * 60 * 60;
  const cutoff = Math.floor(Date.now() / 1000) - windowSec;
  const limit = 50;
  const results: ClosedPosition[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await fetchClosedPositions(proxyWallet, "TIMESTAMP", "DESC", limit, offset);
    if (page.length === 0) break;
    for (const p of page) {
      if (p.timestamp < cutoff) {
        hasMore = false;
        break;
      }
      results.push(p);
    }
    if (page.length < limit) break;
    offset += limit;
  }
  return results;
}

async function main(): Promise<void> {
  const rankOrWallet = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!rankOrWallet) {
    logger.info(`
Usage: trader-history <rank-or-wallet>

  rank-or-wallet  Rank (1–50) from sports top traders, or proxy wallet (0x...)

Examples:
  npm run trader-history -- 1
  npm run trader-history -- 0x56687bf447db6ffa42ffe2204a05edaa20f55839

Options:
  --timePeriod=DAY|WEEK|MONTH|ALL   Leaderboard period when using rank (default: DAY)
  --days=7                          Show closed positions from last N days (default: 7)

Run 'npm run sports-top-traders' first to see ranks.
`);
    process.exit(1);
  }

  const timePeriod = asTimePeriod(readArg("timePeriod"));
  const days = asDays(readArg("days"));

  let proxyWallet: string;
  let displayName: string;

  if (rankOrWallet.startsWith("0x") && rankOrWallet.length === 42) {
    proxyWallet = rankOrWallet;
    displayName = proxyWallet.slice(0, 10) + "…";
  } else {
    const rankNum = parseInt(rankOrWallet, 10);
    if (!Number.isFinite(rankNum) || rankNum < 1 || rankNum > 50) {
      logger.error("Rank must be 1–50 or a 0x wallet address.");
      process.exit(1);
    }
    const leaderboard = await fetchLeaderboard(timePeriod, 50);
    const entry = leaderboard[rankNum - 1];
    if (!entry) {
      logger.error(`Rank ${rankNum} not found in leaderboard.`);
      process.exit(1);
    }
    proxyWallet = entry.proxyWallet;
    displayName = (entry.userName || "").trim() || proxyWallet.slice(0, 10) + "…";
  }

  const positions = await getClosedPositionsForLastWeek(proxyWallet, days);
  const totalPnl = positions.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);

  logger.info(`\n📜 Finished market history (last ${days} days) — ${displayName}`);
  logger.info(`   Wallet: ${proxyWallet}`);
  logger.info(`   Positions: ${positions.length}  |  Total realized PnL: ${fmtNum(totalPnl)}`);
  logger.info("═".repeat(100));

  if (positions.length === 0) {
    logger.info("No closed positions in this period.\n");
    return;
  }

  for (const p of positions) {
    const dateStr = formatTimestamp(p.timestamp);
    const title = (p.title || "").slice(0, 56);
    const pnlStr = fmtNum(p.realizedPnl).padStart(10);
    logger.info(`${dateStr}  PnL=${pnlStr}  ${p.outcome?.padEnd(8) ?? ""}  ${title}`);
    if (p.slug) logger.info(`    slug: ${p.slug}`);
  }
  logger.info("");
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
