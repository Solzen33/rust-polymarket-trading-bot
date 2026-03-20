/**
 * Polymarket data: uses backend API when NEXT_PUBLIC_API_URL is set, otherwise public Polymarket APIs.
 */

const DATA_API_BASE = "https://data-api.polymarket.com";
const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const CLOB_API_BASE = "https://clob.polymarket.com";

/** Backend API runs on port 4004. Normalize so we never use Next.js dev ports (3000/4000) as API base. */
export function getApiBase(): string {
  const u = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_API_URL : undefined;
  const base = (u ?? "").trim().replace(/\/$/, "");
  if (base && /^https?:\/\/localhost:(3000|4000)(\/|$)/i.test(base)) {
    return "http://localhost:4004";
  }
  return base;
}

/** Cache so we don't hit copy-trading endpoints when the API doesn't support them (avoids 404 spam). */
let copyTradingSupported: boolean | null = null;
let copyTradingCacheExpiry = 0;
const COPY_TRADING_CACHE_MS = 60_000;
let healthCheckPromise: Promise<boolean> | null = null;

async function isCopyTradingSupported(): Promise<boolean> {
  if (copyTradingSupported === false && Date.now() < copyTradingCacheExpiry) return false;
  if (copyTradingSupported === true && Date.now() < copyTradingCacheExpiry) return true;
  const base = getApiBase();
  if (!base) return false;
  if (healthCheckPromise) return healthCheckPromise;
  healthCheckPromise = (async () => {
    try {
      const healthRes = await fetch(`${base}/api/health`, { cache: "no-store" });
      const healthData = (await healthRes.json()) as { ok?: boolean; copyTrading?: boolean };
      if (healthData.copyTrading !== true) {
        copyTradingSupported = false;
        copyTradingCacheExpiry = Date.now() + COPY_TRADING_CACHE_MS;
        return false;
      }
      // Prove the copy-trading routes exist (avoids 404 spam when server has health but no routes)
      const statusRes = await fetch(`${base}/api/copy-trading/status`, { cache: "no-store" });
      if (statusRes.status === 404) {
        copyTradingSupported = false;
        copyTradingCacheExpiry = Date.now() + COPY_TRADING_CACHE_MS;
        return false;
      }
      copyTradingSupported = statusRes.ok;
      copyTradingCacheExpiry = Date.now() + COPY_TRADING_CACHE_MS;
      return copyTradingSupported;
    } catch {
      copyTradingSupported = false;
      copyTradingCacheExpiry = Date.now() + COPY_TRADING_CACHE_MS;
      return false;
    } finally {
      healthCheckPromise = null;
    }
  })();
  return healthCheckPromise;
}

function markCopyTradingUnsupported(): void {
  copyTradingSupported = false;
  copyTradingCacheExpiry = Date.now() + COPY_TRADING_CACHE_MS;
}

export type Sport = {
  id: number;
  sport: string;
  label: string;
  tagId: string;
};

async function fetchSportsFromGamma(): Promise<Sport[]> {
  const res = await fetch(`${GAMMA_API_BASE}/sports`, { next: { revalidate: 120 } });
  if (!res.ok) throw new Error(`Sports failed: ${res.status}`);
  const arr = (await res.json()) as Array<{ id: number; sport: string; tags?: string }>;
  return arr.map((s) => {
    const tagId = (s.tags && s.tags.split(",").find((t) => t.trim() && t.trim() !== "1")) || "";
    return { id: s.id, sport: s.sport, label: s.sport.toUpperCase(), tagId: tagId.trim() };
  });
}

export async function fetchSports(): Promise<Sport[]> {
  const base = getApiBase();
  if (base) {
    try {
      const res = await fetch(`${base}/api/sports`, { next: { revalidate: 120 } });
      if (res.ok) return (await res.json()) as Sport[];
    } catch {
      /* fall through to Gamma */
    }
  }
  return fetchSportsFromGamma();
}

export type LiveMarketOption = {
  slug: string;
  question: string;
  eventTitle?: string;
};

export type SportsTreeTagWithLive = {
  label: string;
  tagId: string;
  liveSlugs: LiveMarketOption[];
};

export type SportsTreeGroupWithLive = {
  typeName: string;
  tags: SportsTreeTagWithLive[];
};

export async function fetchSportsTree(livePerTag = 5): Promise<SportsTreeGroupWithLive[]> {
  const base = getApiBase();
  if (base) {
    try {
      const res = await fetch(
        `${base}/api/sports/tree?livePerTag=${encodeURIComponent(String(livePerTag))}`,
        { next: { revalidate: 120 } }
      );
      if (res.ok) {
        const json = (await res.json()) as { groups: SportsTreeGroupWithLive[] };
        return json.groups ?? [];
      }
    } catch {
      /* fall through */
    }
  }
  return [];
}

export async function fetchLiveMarketsByTagId(tagId: string, limit = 50): Promise<LiveMarketOption[]> {
  const base = getApiBase();
  if (base) {
    try {
      const res = await fetch(
        `${base}/api/sports/${encodeURIComponent(tagId)}/live?limit=${limit}`,
        { cache: "no-store" }
      );
      if (res.ok) return (await res.json()) as LiveMarketOption[];
    } catch {
      /* fall through to Gamma */
    }
  }
  const url = `${GAMMA_API_BASE}/events?tag_id=${encodeURIComponent(tagId)}&active=true&closed=false&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Live markets failed: ${res.status}`);
  const events = (await res.json()) as Array<{
    slug?: string;
    title?: string;
    markets?: Array<{ slug?: string; question?: string }>;
  }>;
  const options: LiveMarketOption[] = [];
  for (const ev of events) {
    const markets = ev.markets ?? [];
    const eventTitle = ev.title ?? ev.slug ?? "";
    if (markets.length === 0 && ev.slug) {
      options.push({ slug: ev.slug, question: eventTitle, eventTitle });
      continue;
    }
    for (const m of markets) {
      const slug = m.slug ?? ev.slug;
      if (slug) options.push({ slug, question: m.question ?? eventTitle, eventTitle });
    }
  }
  return options;
}

export type TraderLeaderboardEntry = {
  rank: string;
  proxyWallet: string;
  userName: string;
  vol: number;
  pnl: number;
};

export type ClosedPosition = {
  proxyWallet: string;
  conditionId: string;
  realizedPnl: number;
  timestamp: number;
  title: string;
  slug: string;
  outcome: string;
};

export async function fetchSportsTopTraders(limit = 50): Promise<TraderLeaderboardEntry[]> {
  const base = getApiBase();
  if (base) {
    const res = await fetch(`${base}/api/traders?limit=${limit}`, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`Leaderboard failed: ${res.status}`);
    return (await res.json()) as TraderLeaderboardEntry[];
  }
  const url = new URL(`${DATA_API_BASE}/v1/leaderboard`);
  url.searchParams.set("timePeriod", "DAY");
  url.searchParams.set("category", "SPORTS");
  url.searchParams.set("orderBy", "PNL");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", "0");
  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`Leaderboard failed: ${res.status}`);
  return (await res.json()) as TraderLeaderboardEntry[];
}

export async function fetchClosedPositionsForUser(
  proxyWallet: string,
  days = 7
): Promise<ClosedPosition[]> {
  const base = getApiBase();
  if (base) {
    const res = await fetch(`${base}/api/traders/${encodeURIComponent(proxyWallet)}/history?days=${days}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Closed positions failed: ${res.status}`);
    return (await res.json()) as ClosedPosition[];
  }
  const limit = 50;
  const cutoff = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
  const out: ClosedPosition[] = [];
  let offset = 0;
  for (;;) {
    const url = new URL(`${DATA_API_BASE}/closed-positions`);
    url.searchParams.set("user", proxyWallet);
    url.searchParams.set("sortBy", "TIMESTAMP");
    url.searchParams.set("sortDirection", "DESC");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error(`Closed positions failed: ${res.status}`);
    const page = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(page) || page.length === 0) break;
    for (const p of page) {
      if (typeof p.timestamp !== "number" || p.timestamp < cutoff) return out;
      out.push({
        proxyWallet: String(p.proxyWallet ?? ""),
        conditionId: String(p.conditionId ?? ""),
        realizedPnl: Number(p.realizedPnl ?? 0),
        timestamp: p.timestamp as number,
        title: String(p.title ?? ""),
        slug: String(p.slug ?? ""),
        outcome: String(p.outcome ?? ""),
      });
    }
    if (page.length < limit) break;
    offset += limit;
  }
  return out;
}

export type MarketToken = {
  token_id: string;
  outcome: string;
};

export type MarketDetails = {
  condition_id: string;
  end_date_iso: string;
  tokens: MarketToken[];
  question?: string;
};

export async function fetchMarketStateBySlug(slug: string): Promise<MarketDetails> {
  const base = getApiBase();
  if (base) {
    const res = await fetch(`${base}/api/markets/${encodeURIComponent(slug)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Market failed: ${res.status}`);
    return (await res.json()) as MarketDetails;
  }
  let conditionId: string | undefined;
  let question: string | undefined;
  const byMarket = `${GAMMA_API_BASE}/markets?slug=${encodeURIComponent(slug)}`;
  const resMarket = await fetch(byMarket, { cache: "no-store" });
  if (resMarket.ok) {
    const arr = (await resMarket.json()) as unknown[];
    if (Array.isArray(arr) && arr.length > 0) {
      const raw = arr[0] as Record<string, unknown>;
      conditionId = String(raw.conditionId ?? raw.condition_id ?? "");
      question = String(raw.question ?? "");
    }
  }
  if (!conditionId) {
    const url = `${GAMMA_API_BASE}/events/slug/${encodeURIComponent(slug)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to fetch event for slug: ${slug}`);
    const json = (await res.json()) as { markets?: unknown[] };
    if (!Array.isArray(json?.markets) || json.markets.length === 0)
      throw new Error("No markets for event slug");
    const raw = json.markets[0] as Record<string, unknown>;
    conditionId = String(raw.conditionId ?? raw.condition_id ?? "");
    question = String(raw.question ?? "");
  }
  const mRes = await fetch(`${CLOB_API_BASE}/markets/${conditionId}`, { cache: "no-store" });
  if (!mRes.ok) throw new Error(`Failed to fetch market details: ${conditionId}`);
  const details = (await mRes.json()) as MarketDetails;
  return { ...details, question };
}

export type PriceHistoryPoint = { t: number; p: number };

export async function fetchTokenHistory(
  tokenId: string,
  interval = "1h"
): Promise<PriceHistoryPoint[]> {
  const base = getApiBase();
  if (base) {
    const res = await fetch(
      `${base}/api/tokens/${encodeURIComponent(tokenId)}/history?interval=${encodeURIComponent(interval)}`,
      { cache: "no-store" }
    );
    if (!res.ok) throw new Error(`prices-history failed: ${res.status}`);
    return (await res.json()) as PriceHistoryPoint[];
  }
  const url = new URL(`${CLOB_API_BASE}/prices-history`);
  url.searchParams.set("market", tokenId);
  url.searchParams.set("interval", interval);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`prices-history failed: ${res.status}`);
  const json = (await res.json()) as { history?: PriceHistoryPoint[] };
  return json.history ?? [];
}

/** Copy-trading log lines (from backend; requires API server and bot writing to copy-trading.log). */
export async function fetchCopyTradingLogs(limit = 100): Promise<{ lines: string[] }> {
  const base = getApiBase();
  if (!base) return { lines: [] };
  try {
    const res = await fetch(`${base}/api/copy-trading/logs?limit=${limit}`, { cache: "no-store" });
    if (!res.ok) return { lines: [] };
    const data = (await res.json()) as { lines?: string[] };
    return { lines: Array.isArray(data.lines) ? data.lines : [] };
  } catch {
    return { lines: [] };
  }
}

export type CopyTradingStatus = { running: boolean; simulation?: boolean };

export async function fetchCopyTradingStatus(): Promise<CopyTradingStatus> {
  if (!(await isCopyTradingSupported())) return { running: false };
  const base = getApiBase();
  if (!base) return { running: false };
  try {
    const res = await fetch(`${base}/api/copy-trading/status`, { cache: "no-store" });
    if (res.status === 404) {
      markCopyTradingUnsupported();
      return { running: false };
    }
    if (!res.ok) return { running: false };
    return (await res.json()) as CopyTradingStatus;
  } catch {
    return { running: false };
  }
}

export async function startCopyTrading(params: {
  simulation: boolean;
  traders: string[];
  slugs: string[];
}): Promise<{ ok: boolean; simulation: boolean }> {
  const base = getApiBase();
  if (!base) throw new Error("API URL not configured");
  const res = await fetch(`${base}/api/copy-trading/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = (await res.json()) as { ok?: boolean; simulation?: boolean; error?: string };
  if (res.status === 404) markCopyTradingUnsupported();
  if (!res.ok) throw new Error(data.error ?? `Start failed: ${res.status}`);
  return { ok: true, simulation: data.simulation ?? params.simulation };
}

export async function stopCopyTrading(): Promise<{ ok: boolean; wasRunning: boolean }> {
  if (!(await isCopyTradingSupported())) {
    throw new Error("Copy-trading API not available. Start the API server from the project root: npm run api");
  }
  const base = getApiBase();
  if (!base) throw new Error("API URL not configured");
  const res = await fetch(`${base}/api/copy-trading/stop`, { method: "POST" });
  if (res.status === 404) markCopyTradingUnsupported();
  const data = (await res.json()) as { ok?: boolean; wasRunning?: boolean; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Stop failed: ${res.status}`);
  return { ok: data.ok ?? true, wasRunning: data.wasRunning ?? false };
}
