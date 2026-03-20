"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import type { SportsTreeGroupWithLive } from "../lib/polymarket";

/** Short label for sidebar (from docs/sports-tags-by-type.md type names). */
function typeToLabel(typeName: string): string {
  if (typeName === "Soccer / Association football") return "Soccer";
  if (typeName === "Esports / Gaming") return "Esports";
  return typeName.replace(/ \/ .*$/, "") || typeName;
}

function getBackendBase(): string {
  const env = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_API_URL : undefined;
  const base = (env ?? "").trim().replace(/\/$/, "");
  if (base && /^https?:\/\/localhost:(3000|4000)(\/|$)/i.test(base)) return "http://localhost:4004";
  if (base) return base;
  if (typeof window !== "undefined") {
    const url = new URL(window.location.href);
    if (url.port === "3000" || url.port === "4000") return "http://localhost:4004";
  }
  return "";
}

export function SidebarSportsTree() {
  const [groups, setGroups] = useState<SportsTreeGroupWithLive[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const base = getBackendBase();
    if (!base) {
      setLoading(false);
      return;
    }
    fetch(`${base}/api/sports/tree?livePerTag=3`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((json: { groups?: SportsTreeGroupWithLive[] }) => {
        setGroups(json.groups ?? []);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="px-3 py-2 text-xs text-slate-500">Loading tree…</div>
    );
  }
  if (error || groups.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-slate-500">
        Tree unavailable. Run API (port 4004).
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1 py-1">
      {groups.map((g) => (
        <SidebarTreeGroup
          key={g.typeName}
          typeLabel={typeToLabel(g.typeName)}
          tags={g.tags}
        />
      ))}
    </ul>
  );
}

function SidebarTreeGroup({
  typeLabel,
  tags,
}: {
  typeLabel: string;
  tags: SportsTreeGroupWithLive["tags"];
}) {
  const [open, setOpen] = useState(true);
  const hasTags = tags.length > 0;

  return (
    <li className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-semibold text-slate-200 hover:bg-slate-800/80 hover:text-white"
        aria-expanded={open}
      >
        <Icon
          icon={open ? "mdi:chevron-down" : "mdi:chevron-right"}
          className="h-3.5 w-3.5 shrink-0 text-slate-500"
        />
        <span className="truncate">{typeLabel}</span>
        <span className="ml-auto shrink-0 text-slate-500">({tags.length})</span>
      </button>
      {open && (
        <ul className="flex flex-col gap-0.5 border-l border-slate-700/80 ml-2 pl-2">
          {hasTags ? (
            tags.map((t) => (
              <li key={t.tagId}>
                <Link
                  href={`/sports/${encodeURIComponent(t.tagId)}`}
                  className="block truncate rounded px-1.5 py-1 text-xs text-slate-400 hover:bg-slate-800/80 hover:text-slate-200"
                >
                  {t.label}
                  {t.liveSlugs.length > 0 && (
                    <span className="ml-1 text-slate-600">· {t.liveSlugs.length}</span>
                  )}
                </Link>
              </li>
            ))
          ) : (
            <li className="px-1.5 py-1 text-xs text-slate-500">No tags</li>
          )}
        </ul>
      )}
    </li>
  );
}
