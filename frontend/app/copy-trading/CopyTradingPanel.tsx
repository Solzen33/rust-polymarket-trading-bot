"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import type { TraderLeaderboardEntry } from "../../lib/polymarket";
import {
  fetchClosedPositionsForUser,
  fetchCopyTradingLogs,
  fetchCopyTradingStatus,
  startCopyTrading,
  stopCopyTrading,
} from "../../lib/polymarket";

type Props = { initialTraders: TraderLeaderboardEntry[] };

export function CopyTradingPanel({ initialTraders }: Props) {
  const [selectedWallets, setSelectedWallets] = useState<Set<string>>(new Set());
  const [slugs, setSlugs] = useState<string[]>([]);
  const [botRunning, setBotRunning] = useState(false);
  const [botSimulation, setBotSimulation] = useState<boolean | null>(null);
  const [botMode, setBotMode] = useState<"simulation" | "real">("simulation");
  const [startingOrStopping, setStartingOrStopping] = useState(false);
  const [liveSlugOptions, setLiveSlugOptions] = useState<{ slug: string; question: string }[]>([]);
  const [selectedOptionSlugs, setSelectedOptionSlugs] = useState<Set<string>>(new Set());
  const [loadingTraderSlugs, setLoadingTraderSlugs] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const loadTraderSlugsReqIdRef = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleTrader = useCallback((wallet: string) => {
    setSelectedWallets((prev) => {
      const next = new Set(prev);
      if (next.has(wallet)) next.delete(wallet);
      else next.add(wallet);
      return next;
    });
  }, []);

  const removeSlug = useCallback((slug: string) => {
    setSlugs((prev) => prev.filter((x) => x !== slug));
  }, []);

  const toggleOptionSlug = useCallback((slug: string) => {
    setSelectedOptionSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const addSelectedSlugs = useCallback(() => {
    const toAdd = [...selectedOptionSlugs].filter((s) => !slugs.includes(s));
    if (toAdd.length === 0) {
      if (selectedOptionSlugs.size > 0) toast("Those slugs are already in your list.");
      return;
    }
    setSlugs((prev) => [...prev, ...toAdd]);
    setSelectedOptionSlugs(new Set());
    toast.success(`Added ${toAdd.length} slug(s).`);
  }, [selectedOptionSlugs, slugs]);

  const addAllOptionSlugs = useCallback(() => {
    const toAdd = liveSlugOptions.map((m) => m.slug).filter((s) => !slugs.includes(s));
    if (toAdd.length === 0) {
      toast("All options are already in your list.");
      return;
    }
    setSlugs((prev) => [...prev, ...toAdd]);
    toast.success(`Added ${toAdd.length} slug(s).`);
  }, [liveSlugOptions, slugs]);

  const loadSlugsFromSelectedTraders = useCallback(async () => {
    if (selectedWallets.size === 0) {
      toast.error("Select at least one trader first.");
      return;
    }
    const reqId = ++loadTraderSlugsReqIdRef.current;
    const wallets = [...selectedWallets];
    setLoadingTraderSlugs(true);
    try {
      const days = 7;
      const seen = new Set<string>();
      const options: { slug: string; question: string }[] = [];
      for (const wallet of wallets) {
        const positions = await fetchClosedPositionsForUser(wallet, days);
        for (const p of positions) {
          if (p.slug && !seen.has(p.slug)) {
            seen.add(p.slug);
            options.push({ slug: p.slug, question: p.title || p.slug });
          }
        }
      }
      if (loadTraderSlugsReqIdRef.current === reqId) {
        setLiveSlugOptions(options);
        setSelectedOptionSlugs(new Set());
        toast.success(`Found ${options.length} slug(s) from selected traders’ recent activity.`);
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      if (loadTraderSlugsReqIdRef.current === reqId) setLoadingTraderSlugs(false);
    }
  }, [selectedWallets]);

  // When selection changes, don't auto-load. Just clear previous options to avoid confusion/stale data.
  useEffect(() => {
    loadTraderSlugsReqIdRef.current += 1;
    setLoadingTraderSlugs(false);
    setLiveSlugOptions([]);
    setSelectedOptionSlugs(new Set());
  }, [selectedWallets]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const { lines } = await fetchCopyTradingLogs(150);
      if (!cancelled) setLogLines(lines);
    };
    void poll();
    const t = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const pollStatus = async () => {
      const status = await fetchCopyTradingStatus();
      if (!cancelled) {
        setBotRunning(status.running);
        setBotSimulation(status.simulation ?? null);
      }
    };
    void pollStatus();
    const t = setInterval(pollStatus, 2500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Scroll only the log container to bottom when new lines arrive (don't scroll the whole page)
  useEffect(() => {
    const el = logContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logLines]);

  /** Parse "2025-03-15T12:34:56.789Z message" -> { time: "12:34:56", msg: "message" }. */
  const parseLogLine = (line: string): { time: string; msg: string } => {
    const iso = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+(.*)$/.exec(line);
    if (iso) {
      const timePart = iso[1].split("T")[1]?.replace("Z", "") ?? iso[1];
      return { time: timePart.slice(0, 8), msg: iso[2] ?? line };
    }
    return { time: "", msg: line };
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-800 bg-surface/80 p-4">
        <h2 className="text-sm font-semibold text-slate-200">1. Select traders (from top trader list)</h2>
        <p className="mt-1 text-xs text-slate-500">Click to toggle. Copy these traders’ buy/sell.</p>
        <div className="mt-2 max-h-48 overflow-y-auto rounded border border-slate-800 p-2">
          <div className="flex flex-col gap-1">
            {initialTraders.map((t, i) => {
              const rank = i + 1;
              const name = (t.userName || "").trim() || t.proxyWallet.slice(0, 10) + "...";
              const on = selectedWallets.has(t.proxyWallet);
              return (
                <button
                  key={t.proxyWallet}
                  type="button"
                  onClick={() => toggleTrader(t.proxyWallet)}
                  className={`w-full rounded px-2 py-1.5 text-left text-xs ${on ? "bg-accent/30 text-accent" : "text-slate-400 hover:bg-slate-800"}`}
                  title={t.proxyWallet}
                >
                  <span className="text-slate-500">{rank}.</span> {name}
                </button>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">Selected: {selectedWallets.size} trader(s)</p>
      </section>

      <section className="rounded-lg border border-slate-800 bg-surface/80 p-4">
        <h2 className="text-sm font-semibold text-slate-200">2. Select live slugs</h2>
        <p className="mt-1 text-xs text-slate-500">
          Load slugs from selected traders’ recent activity, then add to your list below.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadSlugsFromSelectedTraders}
            disabled={selectedWallets.size === 0 || loadingTraderSlugs}
            className="rounded bg-accent/80 px-3 py-1.5 text-xs text-white hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mounted && loadingTraderSlugs ? "Loading..." : "Load slugs from selected traders"}
          </button>
        </div>
        {liveSlugOptions.length > 0 && (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addSelectedSlugs}
                disabled={selectedOptionSlugs.size === 0}
                className="rounded bg-accent/80 px-3 py-1.5 text-xs text-white hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add selected ({selectedOptionSlugs.size})
              </button>
              <button
                type="button"
                onClick={addAllOptionSlugs}
                className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Add all
              </button>
            </div>
            <div className="max-h-32 overflow-y-auto rounded border border-slate-800 p-2">
              {liveSlugOptions.map((m) => {
                const checked = selectedOptionSlugs.has(m.slug);
                return (
                  <label
                    key={m.slug}
                    className="mb-1 flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-xs text-slate-300 hover:bg-slate-800"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOptionSlug(m.slug)}
                      className="rounded border-slate-600"
                    />
                    <span className="flex-1 truncate" title={m.question}>
                      {m.question.slice(0, 50)}...
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        <ul className="mt-2 flex flex-wrap gap-1">
          {slugs.map((s) => (
            <li
              key={s}
              className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-xs text-slate-300"
            >
              <span className="max-w-[120px] truncate">{s}</span>
              <button type="button" onClick={() => removeSlug(s)} className="text-slate-500 hover:text-red-400">
                ×
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-slate-800 bg-surface/80 p-4">
        <h2 className="text-sm font-semibold text-slate-200">3. Bot control</h2>
        <p className="mt-1 text-xs text-slate-500">
          Choose simulation (no real orders) or real, then start the copy bot. Requires API server (<code className="rounded bg-slate-800 px-1">npm run api</code>).
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <fieldset className="flex items-center gap-3">
            <legend className="sr-only">Mode</legend>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-300">
              <input
                type="radio"
                name="botMode"
                checked={botMode === "simulation"}
                onChange={() => setBotMode("simulation")}
                className="rounded-full border-slate-600"
                disabled={botRunning}
              />
              Simulation
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-300">
              <input
                type="radio"
                name="botMode"
                checked={botMode === "real"}
                onChange={() => setBotMode("real")}
                className="rounded-full border-slate-600"
                disabled={botRunning}
              />
              Real
            </label>
          </fieldset>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={botRunning || startingOrStopping || selectedWallets.size === 0 || slugs.length === 0}
              onClick={async () => {
                if (selectedWallets.size === 0 || slugs.length === 0) {
                  toast.error("Select at least one trader and add at least one slug.");
                  return;
                }
                setStartingOrStopping(true);
                try {
                  await startCopyTrading({
                    simulation: botMode === "simulation",
                    traders: [...selectedWallets],
                    slugs,
                  });
                  toast.success(`Bot started (${botMode === "simulation" ? "simulation" : "live"}).`);
                } catch (e) {
                  toast.error(String(e));
                } finally {
                  setStartingOrStopping(false);
                }
              }}
              className="rounded bg-emerald-600/80 px-3 py-1.5 text-xs text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mounted && startingOrStopping ? "Starting..." : "Start bot"}
            </button>
            <button
              type="button"
              disabled={!botRunning || startingOrStopping}
              onClick={async () => {
                setStartingOrStopping(true);
                try {
                  await stopCopyTrading();
                  toast.success("Bot stopped.");
                } catch (e) {
                  toast.error(String(e));
                } finally {
                  setStartingOrStopping(false);
                }
              }}
              className="rounded bg-red-900/80 px-3 py-1.5 text-xs text-white hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Stop bot
            </button>
          </div>
        </div>
        {botRunning && (
          <p className="mt-2 text-xs text-slate-400">
            Running ({botSimulation === false ? "live" : "simulation"}).
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-800 bg-surface/80 p-4">
        <h2 className="text-sm font-semibold text-slate-200">4. Trading log</h2>
        <p className="mt-1 text-xs text-slate-500">
          Live activity from the copy-trading bot. Run <code className="rounded bg-slate-800 px-1">npm run copy-trading</code> to see entries.
        </p>
        <div
          ref={logContainerRef}
          className="mt-2 max-h-64 overflow-y-auto rounded border border-slate-800 bg-slate-950/90 p-2 font-mono text-xs"
        >
          {logLines.length === 0 ? (
            <p className="text-slate-500">No log yet. Start the copy-trading bot to see activity here.</p>
          ) : (
            <ul className="space-y-0.5">
              {logLines.map((line, i) => {
                const { time, msg } = parseLogLine(line);
                const isCopy = msg.includes("Copy ") || msg.includes("📋");
                const isSuccess = msg.includes("✅");
                const isError = msg.includes("❌") || msg.includes("failed");
                const isSim = msg.startsWith("[SIM]");
                return (
                  <li
                    key={`${i}-${line.slice(0, 40)}`}
                    className={`flex gap-2 ${isError ? "text-red-400" : isSuccess ? "text-emerald-400" : isCopy || isSim ? "text-slate-200" : "text-slate-400"}`}
                  >
                    {time && <span className="shrink-0 text-slate-500">{time}</span>}
                    <span className="min-w-0 break-words">{msg}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-surface/80 p-4">
        <h2 className="text-sm font-semibold text-slate-200">5. Manual buy/sell</h2>
        <p className="mt-1 text-xs text-slate-500">Select slug and amount. Requires CLI for real orders.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            className="rounded border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-xs text-slate-200"
            defaultValue=""
          >
            <option value="">Select slug</option>
            {slugs.map((s) => (
              <option key={s} value={s}>
                {s.slice(0, 40)}...
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder="USD"
            className="w-20 rounded border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-xs text-slate-200"
          />
          <button type="button" className="rounded bg-emerald-600/60 px-3 py-1.5 text-xs text-white hover:bg-emerald-600">
            Buy
          </button>
          <button type="button" className="rounded bg-red-900/60 px-3 py-1.5 text-xs text-white hover:bg-red-900">
            Sell
          </button>
        </div>
      </section>
    </div>
  );
}
