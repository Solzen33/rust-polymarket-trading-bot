import Link from "next/link";
import { fetchClosedPositionsForUser, fetchSportsTopTraders } from "../../../lib/polymarket";
import { TraderHistoryChart } from "./TraderHistoryChart";
import { TraderDateRangeLinks } from "./TraderDateRangeLinks";

type Params = { wallet: string };
type SearchParams = { days?: string };

export default async function TraderDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const wallet = params.wallet;
  const days = Math.min(90, Math.max(1, parseInt(searchParams.days ?? "7", 10) || 7));
  const [positions, leaderboard] = await Promise.all([
    fetchClosedPositionsForUser(wallet, days),
    fetchSportsTopTraders(50),
  ]);
  const entry = leaderboard.find((e) => e.proxyWallet.toLowerCase() === wallet.toLowerCase());
  const name = entry && (entry.userName || "").trim() ? entry.userName : wallet.slice(0, 10) + "…";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-white">{name}</h1>
          <p className="mt-1 text-xs text-slate-400">
            Proxy wallet: <span className="font-mono">{wallet}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Latest ended market state — last {days} day{days !== 1 ? "s" : ""} (cumulative & per-trade PnL).
          </p>
          <TraderDateRangeLinks wallet={wallet} currentDays={days} />
        </div>
        <Link href="/traders" className="text-xs text-slate-400 hover:text-slate-200">
          ← Back to leaderboard
        </Link>
      </div>

      <div className="rounded-lg border border-slate-800 bg-surface/80 p-3">
        <TraderHistoryChart positions={positions} />
      </div>

      <div className="rounded-lg border border-slate-800 bg-surface/80">
        <div className="max-h-[60vh] overflow-auto">
          <table className="min-w-full text-left text-xs text-slate-300">
            <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Market</th>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2 text-right">Realized PnL</th>
            </tr>
            </thead>
            <tbody>
            {positions.map((p) => {
              const d = new Date(p.timestamp * 1000);
              const when = d.toISOString().replace("T", " ").slice(0, 16);
              return (
                <tr key={`${p.conditionId}-${p.timestamp}`} className="border-t border-slate-800/70">
                  <td className="px-3 py-2 text-slate-400">{when}</td>
                  <td className="px-3 py-2">
                    <span className="line-clamp-1 text-xs">{p.title}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-400">{p.outcome}</td>
                  <td className="px-3 py-2 text-right text-emerald-400">
                    {p.realizedPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              );
            })}
            {positions.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-xs text-slate-500">
                  No closed positions in this period.
                </td>
              </tr>
            )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

