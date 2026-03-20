"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@iconify/react";

const nav = [
  { href: "/", label: "Overview", icon: "mdi:home" },
  { href: "/sports", label: "Sports", icon: "mdi:basketball" },
  { href: "/traders", label: "Top trader", icon: "mdi:medal" },
  { href: "/copy-trading", label: "Copy trading", icon: "mdi:content-copy" },
  { href: "/manual-trading", label: "Manual trading", icon: "mdi:hand-back-right" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-surface/60 overflow-y-auto">
      <Link href="/" className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
        <Icon icon="mdi:chart-line" className="h-5 w-5 text-accent" />
        <span className="text-xs font-semibold text-slate-200">Dashboard</span>
      </Link>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {nav.map(({ href, label, icon }) => {
          const active =
            pathname === href ||
            (href !== "/" && pathname.startsWith(href + "/"));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                active
                  ? "bg-accent/20 text-accent"
                  : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
              }`}
            >
              <Icon icon={icon} className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
