/**
 * Shared DTOs: Gamma/CLOB market shapes and token prices.
 */

export interface Market {
  conditionId: string;
  id?: string;
  question: string;
  slug: string;
  resolutionSource?: string;
  endDateISO?: string;
  endDateIso?: string;
  active: boolean;
  closed: boolean;
  tokens?: Token[];
  clobTokenIds?: string;
  outcomes?: string;
}

export interface Token {
  tokenId?: string;
  token_id?: string;
  outcome: string;
  price?: string;
}

export interface TokenPrice {
  token_id: string;
  bid: number | null;
  ask: number | null;
}
