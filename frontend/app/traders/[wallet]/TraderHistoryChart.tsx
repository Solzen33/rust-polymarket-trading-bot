"use client";

import type { ClosedPosition } from "../../../lib/polymarket";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

type Props = {
  positions: ClosedPosition[];
};

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toISOString().slice(5, 10); // MM-DD
}

export function TraderHistoryChart({ positions }: Props) {
  const sorted = [...positions].sort((a, b) => a.timestamp - b.timestamp);
  let cum = 0;
  const data = sorted.map((p) => {
    cum += p.realizedPnl;
    return {
      date: formatDate(p.timestamp),
      realized: p.realizedPnl,
      cumulative: cum
    };
  });

  if (data.length === 0) {
    return <p className="text-xs text-slate-400">No closed positions in this window.</p>;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9CA3AF" }} />
          <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} />
          <Tooltip
            contentStyle={{ background: "#020617", border: "1px solid #1f2937", fontSize: 11 }}
            labelStyle={{ color: "#E5E7EB" }}
          />
          <Line type="monotone" dataKey="cumulative" stroke="#22c55e" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="realized" stroke="#38bdf8" dot={false} strokeWidth={1} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

