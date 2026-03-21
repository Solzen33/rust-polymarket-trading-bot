/**
 * Configurable thresholds (prices 0–1, times in seconds).
 */

export interface ThresholdStrategyConfig {
  /** Buy when mid crosses from below to at/above this (e.g. 0.45). */
  buyPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  /** No new buys when time_remaining_seconds <= this (default 5 min). */
  minRemainingSeconds: number;
  sharesPerOrder: number;
  checkIntervalMs: number;

  /**
   * Last-N seconds of the period: buy on upward cross of `latePhaseBuyPrice`, sell at `latePhaseSellPrice`.
   * Runs only while `time_remaining_seconds <= latePhaseWindowSeconds` (same window as early buy block by default).
   */
  latePhaseEnabled: boolean;
  latePhaseWindowSeconds: number;
  latePhaseBuyPrice: number;
  latePhaseSellPrice: number;
  /** Late-phase positions only: exit when mid ≤ this (default 0.55). */
  latePhaseStopLossPrice: number;
  /** If omitted at runtime, uses `sharesPerOrder`. */
  latePhaseSharesPerOrder: number | null;
}

export const DEFAULT_THRESHOLD_STRATEGY_CONFIG: ThresholdStrategyConfig = {
  buyPrice: 0.45,
  takeProfitPrice: 0.65,
  stopLossPrice: 0.15,
  minRemainingSeconds: 5 * 60,
  sharesPerOrder: 5,
  checkIntervalMs: 1000,
  latePhaseEnabled: true,
  latePhaseWindowSeconds: 5 * 60,
  latePhaseBuyPrice: 0.85,
  latePhaseSellPrice: 0.95,
  latePhaseStopLossPrice: 0.55,
  latePhaseSharesPerOrder: null,
};

export function mergeThresholdConfig(
  partial?: Partial<ThresholdStrategyConfig>
): ThresholdStrategyConfig {
  return { ...DEFAULT_THRESHOLD_STRATEGY_CONFIG, ...partial };
}
