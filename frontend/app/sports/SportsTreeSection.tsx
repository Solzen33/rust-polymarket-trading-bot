"use client";

import { useEffect, useState } from "react";
import type { SportsTreeGroupWithLive } from "../../lib/polymarket";
import { SportsTree } from "./SportsTree";

/** API server runs on port 4004. Use that even if env points at Next.js (3000/4000). */
function getBackendBase(): string {
  const env = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_API_URL : undefined;
  const base = (env ?? "").trim().replace(/\/$/, "");
  // If env points at Next dev server ports, use API port 4004 instead
  if (base && /^https?:\/\/localhost:(3000|4000)(\/|$)/i.test(base)) {
    return "http://localhost:4004";
  }
  if (base) return base;
  if (typeof window !== "undefined") {
    const url = new URL(window.location.href);
    if (url.port === "3000" || url.port === "4000") return "http://localhost:4004";
  }
  return "";
}

export function SportsTreeSection() {
  const [groups, setGroups] = useState<SportsTreeGroupWithLive[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const base = getBackendBase();
    if (!base) {
      setLoading(false);
      setError("Backend base URL not configured.");
      return;
    }

    fetch(`${base}/api/sports/tree?livePerTag=5`)
      .then((res) => {
        if (!res.ok) throw new Error(`Tree failed: ${res.status}`);
        return res.json();
      })
      .then((json: { groups?: SportsTreeGroupWithLive[] }) => {
        setGroups(json.groups ?? []);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load tree");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-300">By type (with live slugs)</h2>
        <p className="text-xs text-slate-500">Loading tree…</p>
      </section>
    );
  }
  if (error || groups.length === 0) {
    return (
      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-300">By type (with live slugs)</h2>
        <p className="text-xs text-slate-500">
          {error
            ? `Tree unavailable: ${error}. Start the API server from repo root: npm run api (runs on port 4004).`
            : "Start the API server from repo root: npm run api (port 4004) to see the tree."}
        </p>
      </section>
    );
  }
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium text-slate-300">By type (with live slugs)</h2>
      <p className="mb-3 text-xs text-slate-400">Expand a type to see tags and live markets.</p>
      <SportsTree groups={groups} />
    </section>
  );
}
