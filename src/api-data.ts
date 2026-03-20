/**
 * Read-only Polymarket data API (Data API, Gamma, CLOB).
 * Used by the HTTP API server and can be reused by CLIs.
 */

import { TAG_ID_TO_TYPE, ORDERED_TYPE_NAMES } from "./sports-tree-config.js";

const DEFAULT_DATA_API = "https://data-api.polymarket.com";
const DEFAULT_GAMMA_API = "https://gamma-api.polymarket.com";
const DEFAULT_CLOB_API = "https://clob.polymarket.com";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface DataApiOptions {
  dataApiBase?: string;
  gammaApiBase?: string;
  clobApiBase?: string;
  signal?: AbortSignal;
}

function dataBase(opts?: DataApiOptions): string {
  return opts?.dataApiBase ?? DEFAULT_DATA_API;
}
function gammaBase(opts?: DataApiOptions): string {
  return opts?.gammaApiBase ?? DEFAULT_GAMMA_API;
}
function clobBase(opts?: DataApiOptions): string {
  return opts?.clobApiBase ?? DEFAULT_CLOB_API;
}

export interface SportRow {
  id: number;
  sport: string;
  label: string;
  tagId: string;
}

export async function getSports(opts?: DataApiOptions): Promise<SportRow[]> {
  const base = gammaBase(opts);
  const res = await fetch(`${base}/sports`, {
    signal: opts?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Sports failed: ${res.status}`);
  const arr = (await res.json()) as Array<{ id: number; sport: string; tags?: string }>;
  return arr.map((s) => {
    const tagId =
      (s.tags && s.tags.split(",").find((t) => t.trim() && t.trim() !== "1")) || "";
    return {
      id: s.id,
      sport: s.sport,
      label: s.sport.toUpperCase(),
      tagId: tagId.trim(),
    };
  });
}

export interface LiveMarketOptionRow {
  slug: string;
  question: string;
  eventTitle?: string;
}

export async function getLiveMarketsByTagId(
  tagId: string,
  limit = 50,
  opts?: DataApiOptions
): Promise<LiveMarketOptionRow[]> {
  const base = gammaBase(opts);
  const url = `${base}/events?tag_id=${encodeURIComponent(tagId)}&active=true&closed=false&limit=${limit}`;
  const res = await fetch(url, {
    signal: opts?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Events for tag failed: ${res.status}`);
  const events = (await res.json()) as Array<{
    slug?: string;
    title?: string;
    markets?: Array<{ slug?: string; question?: string }>;
  }>;
  const options: LiveMarketOptionRow[] = [];
  for (const ev of events) {
    const markets = ev.markets ?? [];
    const eventTitle = ev.title ?? ev.slug ?? "";
    if (markets.length === 0 && ev.slug) {
      options.push({ slug: ev.slug, question: eventTitle, eventTitle });
      continue;
    }
    for (const m of markets) {
      const slug = m.slug ?? ev.slug;
      if (slug)
        options.push({ slug, question: m.question ?? eventTitle, eventTitle });
    }
  }
  return options;
}

export interface SportsTreeTagWithLive {
  label: string;
  tagId: string;
  liveSlugs: LiveMarketOptionRow[];
}

export interface SportsTreeGroupWithLive {
  typeName: string;
  tags: SportsTreeTagWithLive[];
}

/** Build sports tree from real Polymarket data: fetch sports from Gamma, group by type, attach live slugs per tag. */
export async function getSportsTree(
  livePerTag = 5,
  opts?: DataApiOptions
): Promise<SportsTreeGroupWithLive[]> {
  const sports = await getSports(opts);
  const byType = new Map<string, Map<string, { label: string; tagId: string }>>();

  for (const s of sports) {
    let tagId = (s.tagId || "").trim();
    if (!tagId && s.sport) tagId = s.sport.trim();
    if (!tagId) continue;
    const typeName = TAG_ID_TO_TYPE[tagId.toLowerCase()] ?? "Other";
    if (!byType.has(typeName)) byType.set(typeName, new Map());
    const tagMap = byType.get(typeName)!;
    const key = tagId.toLowerCase();
    if (!tagMap.has(key)) tagMap.set(key, { label: s.label || s.sport || tagId, tagId });
  }

  const toTagsWithLive = async (
    items: Array<{ label: string; tagId: string }>
  ): Promise<SportsTreeTagWithLive[]> =>
    Promise.all(
      items.map(async ({ tagId, label }) => {
        let liveSlugs: LiveMarketOptionRow[] = [];
        try {
          liveSlugs = await getLiveMarketsByTagId(tagId, livePerTag, opts);
        } catch {
          /* leave empty on error */
        }
        return { label, tagId, liveSlugs };
      })
    );

  // Always return tree separated by sports type in fixed order (Soccer, Basketball, Cricket, … Other)
  const ordered: SportsTreeGroupWithLive[] = [];
  for (const typeName of ORDERED_TYPE_NAMES) {
    const tagMap = byType.get(typeName);
    const items = tagMap ? Array.from(tagMap.values()) : [];
    ordered.push({ typeName, tags: await toTagsWithLive(items) });
  }
  // Append any type from API that is not in ORDERED_TYPE_NAMES (e.g. future new types)
  for (const [typeName, tagMap] of byType) {
    if (ORDERED_TYPE_NAMES.includes(typeName)) continue;
    ordered.push({ typeName, tags: await toTagsWithLive(Array.from(tagMap.values())) });
  }
  return ordered;
}

export interface TraderLeaderboardEntry {
  rank: string;
  proxyWallet: string;
  userName: string;
  vol: number;
  pnl: number;
}

export async function getSportsTopTraders(
  limit = 50,
  timePeriod: "DAY" | "WEEK" | "MONTH" | "ALL" = "DAY",
  opts?: DataApiOptions
): Promise<TraderLeaderboardEntry[]> {
  const base = dataBase(opts);
  const url = new URL(`${base}/v1/leaderboard`);
  url.searchParams.set("timePeriod", timePeriod);
  url.searchParams.set("category", "SPORTS");
  url.searchParams.set("orderBy", "PNL");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", "0");
  const res = await fetch(url.toString(), {
    signal: opts?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Leaderboard failed: ${res.status}`);
  return (await res.json()) as TraderLeaderboardEntry[];
}

export interface ClosedPositionRow {
  proxyWallet: string;
  conditionId: string;
  realizedPnl: number;
  timestamp: number;
  title: string;
  slug: string;
  outcome: string;
}

export async function getClosedPositionsForUser(
  proxyWallet: string,
  days = 7,
  opts?: DataApiOptions
): Promise<ClosedPositionRow[]> {
  const base = dataBase(opts);
  const limit = 50;
  const cutoff = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
  const out: ClosedPositionRow[] = [];
  let offset = 0;
  for (;;) {
    const url = new URL(`${base}/closed-positions`);
    url.searchParams.set("user", proxyWallet);
    url.searchParams.set("sortBy", "TIMESTAMP");
    url.searchParams.set("sortDirection", "DESC");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const res = await fetch(url.toString(), {
      signal: opts?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Closed positions failed: ${res.status}`);
    const page = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(page) || page.length === 0) break;
    for (const p of page) {
      const ts = typeof p.timestamp === "number" ? p.timestamp : 0;
      if (ts < cutoff) return out;
      out.push({
        proxyWallet: String(p.proxyWallet ?? ""),
        conditionId: String(p.conditionId ?? ""),
        realizedPnl: Number(p.realizedPnl ?? 0),
        timestamp: ts,
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

export interface MarketDetailsRow {
  condition_id: string;
  end_date_iso: string;
  tokens: Array<{ token_id: string; outcome: string }>;
  question?: string;
}

export async function getMarketBySlug(slug: string, opts?: DataApiOptions): Promise<MarketDetailsRow> {
  const gamma = gammaBase(opts);
  const clob = clobBase(opts);
  let conditionId: string | undefined;
  let question: string | undefined;

  const byMarket = `${gamma}/markets?slug=${encodeURIComponent(slug)}`;
  const resMarket = await fetch(byMarket, {
    signal: opts?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (resMarket.ok) {
    const arr = (await resMarket.json()) as unknown[];
    if (Array.isArray(arr) && arr.length > 0) {
      const raw = arr[0] as Record<string, unknown>;
      conditionId = String(raw.conditionId ?? raw.condition_id ?? "");
      question = String(raw.question ?? "");
    }
  }
  if (!conditionId) {
    const url = `${gamma}/events/slug/${encodeURIComponent(slug)}`;
    const res = await fetch(url, {
      signal: opts?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Failed to fetch event for slug: ${slug}`);
    const json = (await res.json()) as { markets?: unknown[] };
    const markets = json?.markets;
    if (!Array.isArray(markets) || markets.length === 0)
      throw new Error("No markets for event slug");
    const raw = markets[0] as Record<string, unknown>;
    conditionId = String(raw.conditionId ?? raw.condition_id ?? "");
    question = String(raw.question ?? "");
  }

  const mRes = await fetch(`${clob}/markets/${conditionId}`, {
    signal: opts?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!mRes.ok) throw new Error(`Failed to fetch market details: ${conditionId}`);
  const details = (await mRes.json()) as MarketDetailsRow;
  return { ...details, question };
}

export interface PriceHistoryPoint {
  t: number;
  p: number;
}

export async function getTokenPriceHistory(
  tokenId: string,
  interval = "1h",
  opts?: DataApiOptions
): Promise<PriceHistoryPoint[]> {
  const base = clobBase(opts);
  const url = new URL(`${base}/prices-history`);
  url.searchParams.set("market", tokenId);
  url.searchParams.set("interval", interval);
  const res = await fetch(url.toString(), {
    signal: opts?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`prices-history failed: ${res.status}`);
  const json = (await res.json()) as { history?: PriceHistoryPoint[] };
  return json.history ?? [];
}
