import "./globals.css";
import type { ReactNode } from "react";
import { AppShell } from "../components/AppShell";

export const metadata = {
  title: "Polymarket Sports Dashboard",
  description: "Sports traders, markets, and copy tools"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-slate-100" suppressHydrationWarning>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

