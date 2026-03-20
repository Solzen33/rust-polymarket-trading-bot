import Link from "next/link";
import { fetchSports } from "../../lib/polymarket";

export const revalidate = 120;

export default async function SportsPage() {
  const sports = await fetchSports();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Sports list</h1>
        <p className="mt-1 text-xs text-slate-400">
          Click a sport to see its live markets.
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-300">All sports</h2>
        <ul className="grid grid-cols-4 gap-1">
          {sports.map((s) => (
            <li key={s.id} className="min-w-0">
              <Link
                href={`/sports/${encodeURIComponent(s.tagId || String(s.id))}`}
                className="block overflow-hidden rounded-lg border border-slate-800 bg-surface/80 px-4 py-3 text-sm text-slate-200 transition hover:border-accent/50 hover:bg-surface"
                title={`${s.label} (${s.sport})`}
              >
                <span className="block truncate font-medium">
                  {s.label}
                  <span className="ml-2 text-xs text-slate-500">({s.sport})</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {sports.length === 0 && (
          <p className="text-sm text-slate-500">No sports returned.</p>
        )}
      </section>
    </div>
  );
}
