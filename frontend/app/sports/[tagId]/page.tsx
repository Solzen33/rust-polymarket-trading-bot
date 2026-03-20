import Link from "next/link";
import { fetchSports, fetchLiveMarketsByTagId } from "../../../lib/polymarket";
import { LiveSlugCards } from "./LiveSlugCards";

type Params = { tagId: string };

export default async function SportLivePage({ params }: { params: Params }) {
  const tagId = decodeURIComponent(params.tagId);
  const [sports, markets] = await Promise.all([
    fetchSports(),
    fetchLiveMarketsByTagId(tagId, 50),
  ]);
  const sport = sports.find((s) => s.tagId === tagId || String(s.id) === tagId);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link
          href="/sports"
          className="rounded px-2 py-1 text-sm text-slate-400 hover:bg-slate-800 hover:text-white"
          aria-label="Back to Sports list"
        >
          ← Back to Sports
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-sm font-semibold text-white">
          {sport?.label ?? tagId}
        </span>
      </div>
      <h1 className="text-lg font-semibold text-white">
        Live slugs — {sport?.label ?? tagId}
      </h1>
      <p className="text-xs text-slate-400">
        Click a card to open market state and real-time chart.
      </p>
      <LiveSlugCards slugs={markets} />
      {markets.length === 0 && (
        <p className="text-sm text-slate-500">No live markets for this sport.</p>
      )}
    </div>
  );
}
