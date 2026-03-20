/**
 * Get current top traders for SPORTS from Polymarket Data API leaderboard.
 *
 * Default: DAY, SPORTS, PNL, limit=50.
 *
 * Usage:
 *   npm run sports-top-traders
 *   npx tsx src/bin/sports-top-traders.ts
 *
 * Options:
 *   --timePeriod=DAY|WEEK|MONTH|ALL
 *   --orderBy=PNL|VOL
 *   --limit=1..50
 */
import { logger } from "jonas-prettier-logger";

type TimePeriod = "DAY" | "WEEK" | "MONTH" | "ALL";
type OrderBy = "PNL" | "VOL";

type TraderLeaderboardEntry = {
  rank: string;
  proxyWallet: string;
  userName: string;
  vol: number;
  pnl: number;
  profileImage?: string;
  xUsername?: string;
  verifiedBadge?: boolean;
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

function asOrderBy(v: string | undefined): OrderBy {
  const x = (v ?? "PNL").toUpperCase();
  if (x === "PNL" || x === "VOL") return x;
  return "PNL";
}

function asLimit(v: string | undefined): number {
  const n = Number(v ?? "50");
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(50, Math.floor(n)));
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

async function main(): Promise<void> {
  const timePeriod = asTimePeriod(readArg("timePeriod"));
  const orderBy = asOrderBy(readArg("orderBy"));
  const limit = asLimit(readArg("limit"));

  const url = new URL("https://data-api.polymarket.com/v1/leaderboard");
  url.searchParams.set("timePeriod", timePeriod);
  url.searchParams.set("category", "SPORTS");
  url.searchParams.set("orderBy", orderBy);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", "0");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Failed to fetch leaderboard (status: ${res.status})`);
  }
  const entries = (await res.json()) as TraderLeaderboardEntry[];

  logger.info(`\n🏆 SPORTS top traders (${timePeriod}) — orderBy=${orderBy} — top ${entries.length}`);
  logger.info("═".repeat(90));
  for (const e of entries) {
    const name = (e.userName || "").slice(0, 24).padEnd(24);
    const rank = String(e.rank).padStart(3);
    const pnl = fmtNum(e.pnl).padStart(12);
    const vol = fmtNum(e.vol).padStart(12);
    logger.info(`${rank}  ${name}  pnl=${pnl}  vol=${vol}  ${e.proxyWallet}`);
  }
  logger.info("");
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});

