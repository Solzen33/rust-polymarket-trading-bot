"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Toaster } from "react-hot-toast";
import { Icon } from "@iconify/react";
import { Sidebar } from "./Sidebar";

type Props = {
  children: ReactNode;
};

export function AppShell({ children }: Props) {
  return (
    <>
      <div className="flex min-h-screen flex-col">
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto px-4 py-6">{children}</main>
        </div>
        <footer className="shrink-0 border-t border-slate-800 bg-surface/80 py-2 text-center text-xs text-slate-500">
          Unofficial dashboard using public Polymarket APIs.
        </footer>
      </div>
      <Toaster position="top-right" />
    </>
  );
}

