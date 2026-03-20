"use client";

import type { MarketDetails, PriceHistoryPoint } from "../../../lib/polymarket";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

type Props = {
  details: MarketDetails;
  histories: Record<string, PriceHistoryPoint[]>;
};

function formatTs(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toISOString().slice(5, 16).replace("T", " ");
}

export function MarketChart({ details, histories }: Props) {
  const tokens = details.tokens ?? [];
  if (tokens.length === 0) {
    return <p className="text-xs text-slate-400">No tokens for this market.</p>;
  }

  const tokenIds = tokens.map((t) => t.token_id);
  const allPoints: number[] = [];
  for (const id of tokenIds) {
    for (const h of histories[id] ?? []) allPoints.push(h.t);
  }
  allPoints.sort((a, b) => a - b);

  const data = allPoints.map((t) => {
    const row: any = { time: formatTs(t) };
    for (const tok of tokens) {
      const series = histories[tok.token_id] ?? [];
      const found = series.find((h) => h.t === t);
      if (found) row[tok.token_id] = found.p;
    }
    return row;
  });

  if (data.length === 0) {
    return <p className="text-xs text-slate-400">No price history available.</p>;
  }

  const colors = ["#22c55e", "#38bdf8", "#f97316", "#e11d48"];

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
          <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#9CA3AF" }} minTickGap={24} />
          <YAxis
            tick={{ fontSize: 10, fill: "#9CA3AF" }}
            domain={[0, 1]}
            tickFormatter={(v) => v.toFixed(2)}
          />
          <Tooltip
            contentStyle={{ background: "#020617", border: "1px solid #1f2937", fontSize: 11 }}
            labelStyle={{ color: "#E5E7EB" }}
          />
          <Legend />
          {tokens.map((t, i) => (
            <Line
              key={t.token_id}
              type="monotone"
              dataKey={t.token_id}
              name={t.outcome}
              stroke={colors[i % colors.length]}
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

