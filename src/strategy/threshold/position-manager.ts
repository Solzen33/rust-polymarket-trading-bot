import { randomUUID } from "node:crypto";
import type { TradingAssetKey } from "../../trading-assets.js";
import type { CloseReason, Position, PositionEntryKind, TokenSide } from "./types.js";

export interface OpenPositionInput {
  assetKey: TradingAssetKey;
  marketSlug: string;
  entryKind?: PositionEntryKind;
  tokenSide: TokenSide;
  tokenId: string;
  conditionId: string;
  buyPrice: number;
  shares: number;
  periodTimestamp: number;
  buyOrderId?: string;
}

/**
 * In-memory store for positions. {@link ThresholdStrategy} enforces at most one open per UP/DOWN side.
 */
export type PositionClosedListener = (closed: Position) => void;

export class PositionManager {
  private readonly byId = new Map<string, Position>();
  private onClosed: PositionClosedListener | undefined;

  /** Fired synchronously after each successful {@link close} (for history / analytics). */
  setOnClosed(listener: PositionClosedListener | undefined): void {
    this.onClosed = listener;
  }

  /** All positions (open + closed) — use for debugging / export. */
  getAll(): Position[] {
    return [...this.byId.values()];
  }

  getOpen(): Position[] {
    return [...this.byId.values()].filter((p) => p.status === "open");
  }

  getOpenForSide(side: TokenSide): Position[] {
    return this.getOpen().filter((p) => p.tokenSide === side);
  }

  getById(id: string): Position | undefined {
    return this.byId.get(id);
  }

  open(input: OpenPositionInput): Position {
    const id = randomUUID();
    const pos: Position = {
      id,
      assetKey: input.assetKey,
      marketSlug: input.marketSlug,
      entryKind: input.entryKind ?? "standard",
      tokenSide: input.tokenSide,
      tokenId: input.tokenId,
      conditionId: input.conditionId,
      buyPrice: input.buyPrice,
      shares: input.shares,
      openedAtMs: Date.now(),
      periodTimestamp: input.periodTimestamp,
      status: "open",
      buyOrderId: input.buyOrderId,
    };
    this.byId.set(id, pos);
    return pos;
  }

  close(
    id: string,
    reason: CloseReason,
    closePrice: number,
    sellOrderId?: string
  ): Position | undefined {
    const p = this.byId.get(id);
    if (!p || p.status !== "open") return undefined;
    const updated: Position = {
      ...p,
      status: "closed",
      closedAtMs: Date.now(),
      closeReason: reason,
      closePrice,
      sellOrderId,
    };
    this.byId.set(id, updated);
    this.onClosed?.(updated);
    return updated;
  }

  /** Remove closed positions (optional memory hygiene). */
  pruneClosed(keepLastN = 500): void {
    const closed = [...this.byId.values()].filter((p) => p.status === "closed");
    if (closed.length <= keepLastN) return;
    closed.sort((a, b) => (a.closedAtMs ?? 0) - (b.closedAtMs ?? 0));
    for (let i = 0; i < closed.length - keepLastN; i++) {
      this.byId.delete(closed[i].id);
    }
  }

  countOpen(): number {
    return this.getOpen().length;
  }
}
