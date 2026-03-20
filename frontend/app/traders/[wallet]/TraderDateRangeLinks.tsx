"use client";

import Link from "next/link";

type Props = { wallet: string; currentDays: number };

const PRESETS = [7, 14] as const;

export function TraderDateRangeLinks({ wallet, currentDays }: Props) {
  return (
    <div className="mt-2 flex gap-2">
      <span className="text-xs text-slate-500">Range:</span>
      {PRESETS.map((d) => (
        <Link
          key={d}
          href={`/traders/${encodeURIComponent(wallet)}?days=${d}`}
          className={`text-xs ${currentDays === d ? "text-accent font-medium" : "text-slate-400 hover:text-slate-200"}`}
        >
          {d} days
        </Link>
      ))}
    </div>
  );
}
