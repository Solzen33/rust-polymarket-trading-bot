import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
import type { SimulationSummary } from "./trader.js";

export interface SimulationHistoryEntry {
  timestamp: string;
  orderCount: number;
  totalNotional: number;
  orders: SimulationSummary["orders"];
}

const HISTORY_DIR = "history";

function getDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Append a simulation result to the history folder.
 * File path: history/YYYY-MM-DD.json (NDJSON: one JSON object per line).
 */
export async function saveSimulationResult(
  summary: SimulationSummary,
  options?: { historyDir?: string; date?: Date }
): Promise<string> {
  const baseDir = options?.historyDir ?? join(process.cwd(), HISTORY_DIR);
  const date = options?.date ?? new Date();
  const dateStr = getDateString(date);
  const filePath = join(baseDir, `${dateStr}.json`);

  await mkdir(baseDir, { recursive: true });

  const entry: SimulationHistoryEntry = {
    timestamp: date.toISOString(),
    orderCount: summary.orderCount,
    totalNotional: summary.totalNotional,
    orders: summary.orders,
  };
  const line = JSON.stringify(entry) + "\n";
  await appendFile(filePath, line, "utf-8");

  return filePath;
}
