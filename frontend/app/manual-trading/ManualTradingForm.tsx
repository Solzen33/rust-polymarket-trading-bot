"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchLiveMarketsByTagId, fetchSports } from "../../lib/polymarket";

export function ManualTradingForm() {
  const [slug, setSlug] = useState("");
  const [sports, setSports] = useState<Array<{ id: number; sport: string; label: string; tagId: string }>>([]);
  const [selectedTagId, setSelectedTagId] = useState<string>("");
  const [liveMarkets, setLiveMarkets] = useState<Array<{ slug: string; question: string; eventTitle?: string }>>([]);
  const [loadingSports, setLoadingSports] = useState(false);
  const [loadingLive, setLoadingLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoadingSports(true);
      try {
        const s = await fetchSports();
        if (!cancelled) setSports(s);
      } finally {
        if (!cancelled) setLoadingSports(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!selectedTagId) {
        setLiveMarkets([]);
        return;
      }
      setLoadingLive(true);
      try {
        const options = await fetchLiveMarketsByTagId(selectedTagId, 50);
        if (!cancelled) setLiveMarkets(options);
      } catch {
        if (!cancelled) setLiveMarkets([]);
      } finally {
        if (!cancelled) setLoadingLive(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedTagId]);

  const slugTrimmed = slug.trim();
  const liveMarketSelectValue = useMemo(() => {
    if (!slugTrimmed) return "";
    return liveMarkets.some((m) => m.slug === slugTrimmed) ? slugTrimmed : "";
  }, [liveMarkets, slugTrimmed]);

  return (
    <div className="rounded-lg border border-slate-800 bg-surface/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[220px]">
          <label className="block text-xs font-medium text-slate-300">Sport</label>
          <select
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200"
            value={selectedTagId}
            onChange={(e) => setSelectedTagId(e.target.value)}
            disabled={loadingSports}
          >
            <option value="">{loadingSports ? "Loading sports..." : "Select a sport (optional)"}</option>
            {sports
              .filter((s) => s.tagId)
              .map((s) => (
                <option key={s.id} value={s.tagId}>
                  {s.label} ({s.sport})
                </option>
              ))}
          </select>
        </div>

        <div className="min-w-[320px] flex-1">
          <label className="block text-xs font-medium text-slate-300">Current live market</label>
          <select
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200"
            value={liveMarketSelectValue}
            onChange={(e) => setSlug(e.target.value)}
            disabled={!selectedTagId || loadingLive || liveMarkets.length === 0}
          >
            <option value="">
              {!selectedTagId
                ? "Select a sport first"
                : loadingLive
                  ? "Loading live markets..."
                  : liveMarkets.length === 0
                    ? "No live markets found"
                    : "Select a live market (fills slug below)"}
            </option>
            {liveMarkets.map((m) => (
              <option key={m.slug} value={m.slug}>
                {(m.question || m.slug).slice(0, 80)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="mt-4 block text-xs font-medium text-slate-300">Market slug</label>
      <input
        type="text"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        placeholder="e.g. will-the-oklahoma-city-thunder-win-the-2026-nba-finals"
        className="mt-1 w-full rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 placeholder-slate-500"
      />
      <div className="mt-3 flex gap-2">
        <Link
          href={slugTrimmed ? `/markets/${encodeURIComponent(slugTrimmed)}` : "#"}
          className={`rounded px-4 py-2 text-sm ${slugTrimmed ? "bg-accent text-white hover:bg-accent-soft" : "cursor-not-allowed bg-slate-700 text-slate-500"}`}
        >
          View market & chart
        </Link>
        <a
          href={`https://polymarket.com/event/${slugTrimmed}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`rounded border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 ${slugTrimmed ? "" : "pointer-events-none opacity-50"}`}
        >
          Open on Polymarket
        </a>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        To place orders from this app, the backend would need to expose order endpoints. For now use{" "}
        <code className="rounded bg-slate-800 px-1">npm run manual-trading:live -- &lt;slug&gt;</code> in the repo root.
      </p>
    </div>
  );
}
