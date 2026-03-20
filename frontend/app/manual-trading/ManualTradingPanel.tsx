"use client";

import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";

const API_BASE = typeof window !== "undefined" ? (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "") : "";

export function ManualTradingPanel() {
  const [slug, setSlug] = useState("");
  const [market, setMarket] = useState<{ question?: string; tokens?: { token_id: string; outcome: string }[] } | null>(null);
  const [selectedTokenId, setSelectedTokenId] = useState("");
  const [amount, setAmount] = useState("10");
  const [loading, setLoading] = useState(false);

  const loadMarket = async () => {
    const s = slug.trim();
    if (!s) {
      toast.error("Enter a slug");
      return;
    }
    if (!API_BASE) {
      toast.error("Set NEXT_PUBLIC_API_URL for backend");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/markets/${encodeURIComponent(s)}`);
      if (!res.ok) throw new Error(res.statusText);
      const data = (await res.json()) as { question?: string; tokens?: { token_id: string; outcome: string }[] };
      setMarket(data);
      setSelectedTokenId(data.tokens?.[0]?.token_id ?? "");
    } catch (e) {
      toast.error(`Failed: ${(e as Error).message}`);
      setMarket(null);
    } finally {
      setLoading(false);
    }
  };

  const placeOrder = (side: "BUY" | "SELL") => {
    const amt = parseFloat(amount);
    if (!selectedTokenId || !Number.isFinite(amt) || amt <= 0) {
      toast.error("Load market, select outcome, and enter amount.");
      return;
    }
    toast(`Manual ${side} $${amt} on selected outcome (configure backend for live orders)`);
  };

  return (
    <div className="space-y-6 rounded-lg border border-slate-800 bg-surface/80 p-4">
      <section>
        <h2 className="text-sm font-semibold text-slate-200">1. Enter or select live slug</h2>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            placeholder="e.g. will-the-oklahoma-city-thunder-win-the-2026-nba-finals"
            className="flex-1 rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 placeholder-slate-500"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadMarket()}
          />
          <button
            type="button"
            onClick={loadMarket}
            disabled={loading}
            className="rounded bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-soft disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load market"}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Use <Link href="/sports" className="text-accent hover:underline">Sports</Link> to find live slugs.
        </p>
      </section>

      {market && (
        <>
          <section>
            <h2 className="text-sm font-semibold text-slate-200">2. Market</h2>
            <p className="mt-1 text-sm text-slate-300">{market.question ?? slug}</p>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-200">3. Select outcome & amount</h2>
            <div className="mt-2 flex flex-wrap gap-4">
              <div>
                <label className="block text-xs text-slate-400">Outcome (token)</label>
                <select
                  className="mt-0.5 rounded border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-200"
                  value={selectedTokenId}
                  onChange={(e) => setSelectedTokenId(e.target.value)}
                >
                  {market.tokens?.map((t) => (
                    <option key={t.token_id} value={t.token_id}>
                      {t.outcome}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400">Amount (USD)</label>
                <input
                  type="number"
                  min={0.1}
                  step={0.5}
                  className="mt-0.5 w-24 rounded border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-200"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-200">4. Place order</h2>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => placeOrder("BUY")}
                className="rounded bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => placeOrder("SELL")}
                className="rounded bg-rose-800 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
              >
                Sell
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              For live orders, run the CLI: <code className="rounded bg-slate-800 px-1">npm run manual-trading:live -- {slug.slice(0, 30)}…</code>
            </p>
          </section>
        </>
      )}
    </div>
  );
}
