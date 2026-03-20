import { fetchMarketStateBySlug, fetchTokenHistory } from "../../../lib/polymarket";
import { BackLink } from "./BackLink";
import { MarketChart } from "./MarketChart";

type Params = { slug: string };

export default async function MarketPage({ params }: { params: Params }) {
  const slug = decodeURIComponent(params.slug);
  let details: Awaited<ReturnType<typeof fetchMarketStateBySlug>>;
  let tokens: Awaited<ReturnType<typeof fetchMarketStateBySlug>>["tokens"] = [];
  const histories: Record<string, Awaited<ReturnType<typeof fetchTokenHistory>>> = {};

  try {
    details = await fetchMarketStateBySlug(slug);
    tokens = details.tokens ?? [];

    await Promise.all(
      tokens.map(async (t) => {
        histories[t.token_id] = await fetchTokenHistory(t.token_id, "1h");
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-white">Market error</h1>
            <p className="mt-1 text-xs text-slate-400">
              Slug: <span className="font-mono">{slug}</span>
            </p>
          </div>
          <BackLink />
        </div>
        <div className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-200">
          Failed to load market: {msg}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-white line-clamp-2">
            {details.question ?? "Market"}
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Slug: <span className="font-mono">{slug}</span>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Condition: <span className="font-mono">{details.condition_id}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">End time: {details.end_date_iso}</p>
        </div>
        <BackLink />
      </div>

      <div className="rounded-lg border border-slate-800 bg-surface/80 p-3">
        <h2 className="mb-2 text-xs font-semibold text-slate-200">Price history</h2>
        <MarketChart details={details} histories={histories} />
      </div>

      <div className="rounded-lg border border-slate-800 bg-surface/80">
        <table className="min-w-full text-left text-xs text-slate-300">
          <thead className="bg-surface">
            <tr>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2">Token ID</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.token_id} className="border-t border-slate-800/70">
                <td className="px-3 py-2">{t.outcome}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{t.token_id}</td>
              </tr>
            ))}
            {tokens.length === 0 && (
              <tr>
                <td colSpan={2} className="px-3 py-4 text-center text-xs text-slate-500">
                  No tokens for this market.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

