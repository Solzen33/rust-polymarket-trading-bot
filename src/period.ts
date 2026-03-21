/** 15-minute Polymarket up/down period length (seconds). */
export const PERIOD_SEC = 900;

/** Unix start of the current 15m period (aligned to 900s boundaries). */
export function currentPeriodTimestamp(): number {
  const now = Math.floor(Date.now() / 1000);
  return Math.floor(now / PERIOD_SEC) * PERIOD_SEC;
}
