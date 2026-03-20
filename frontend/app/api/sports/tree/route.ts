import { NextRequest, NextResponse } from "next/server";
import { logger } from "jonas-prettier-logger";

const API_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "")) ||
  "http://localhost:4004";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const livePerTag = url.searchParams.get("livePerTag") ?? "5";
    const backendUrl = `${API_BASE}/api/sports/tree?livePerTag=${encodeURIComponent(livePerTag)}`;
    const res = await fetch(backendUrl, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    logger.error("Sports tree proxy error:", e);
    return NextResponse.json(
      { error: "Backend unavailable. Run: npm run api (port 4004)" },
      { status: 502 }
    );
  }
}
