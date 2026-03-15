# Polymarket Trading Bot (TypeScript)

TypeScript port of [Polymarket-Trading-Bot-Rust](https://github.com/your-org/Polymarket-Trading-Bot-Rust). At each 15-minute market start, places limit buys for BTC (and optionally ETH, Solana, XRP) Up/Down at a fixed price (default $0.45).

## Bot logic (detailed)

### Strategy in one sentence

Every time a **new 15-minute market period starts**, the bot places **limit BUY** orders for **Up** and **Down** tokens of the selected assets (BTC always; ETH/SOL/XRP if enabled) at a **fixed limit price** (e.g. $0.45). No market orders; no selling logic in this bot.

### Markets targeted

- **Polymarket 15-minute Up/Down markets**: e.g. “Will BTC go up or down in the next 15 minutes?” Each period has two outcome tokens: **Up** (yes) and **Down** (no). The bot buys both at a fixed price at the start of the period.
- **Period**: 900 seconds (15 min). Period boundaries are aligned to Unix time: `period_timestamp = floor(now / 900) * 900`.

### Startup sequence

1. **Config & CLI**  
   Loads `config.json` and parses `--simulation` / `--no-simulation` and `-c <path>`. Simulation = no real orders; dev/production = real CLOB orders.

2. **Auth (if `private_key` set)**  
   Builds an ethers wallet and CLOB client, optionally derives or creates API key. If auth fails and mode is simulation, the bot continues with read-only market data.

3. **Market discovery**  
   For each asset (BTC, and ETH/SOL/XRP if enabled), finds the **current** 15-min market by slug pattern:
   - `{asset}-updown-15m-{period_timestamp}` (e.g. `btc-updown-15m-1739462400`).
   - For BTC/ETH, also tries **previous** periods (up to 3 × 15 min back) if the current one isn’t found.
   - Uses Polymarket **Gamma API** (event/market by slug) and ensures the market is active and not closed. Stores condition IDs and token IDs for Up/Down.

4. **Main loop**  
   Runs forever, every `check_interval_ms` (default 1 s):
   - Fetches a **snapshot**: order book (best bid/ask) for each market’s Up and Down tokens via CLOB, plus **time remaining** in the current period (`end_time - now`).
   - Logs a price line: e.g. `BTC: U$0.48/$0.52 D$0.45/$0.49 | ETH: ... | ⏱️ 14m 32s`.

### When does the bot place orders?

Orders are placed **only when all** of the following are true:

1. **Time remaining > 0** (market not yet ended).
2. **Period has been seen** (so we know we’re in a valid period).
3. **"Just after" period start**: `time_elapsed = 900 - time_remaining` is **≤ 2 seconds**. So we act in the first ~2 seconds of the new period only.
4. **Not already placed this period**: `lastPlacedPeriod !== current period`. So we place **once per period**, right after it starts.
5. **There are opportunities**: at least one Up or Down token is available for the enabled markets (BTC + any of ETH/SOL/XRP that are enabled).

If any of these fail, the loop just waits and repeats.

### Buy point (when we buy)

| What | Value |
|------|--------|
| **When** | First **0–2 seconds** after a new 15-minute period starts |
| **Clock** | `time_remaining_seconds` between **898 and 900** (so `time_elapsed = 900 - time_remaining` is 0–2) |
| **How often** | **Once per period** (then `lastPlacedPeriod` blocks until the next period) |
| **Price** | Fixed limit: `trading.dual_limit_price` (e.g. **$0.45**) |
| **Tokens** | One limit buy for **Up**, one for **Down**, for each enabled asset (e.g. BTC only if others disabled) |

So the **buy point** is: as soon as the new 15-min window starts (first 2 seconds), the bot places all limit buys at the configured price, then does nothing else until the next period.

### What gets traded (opportunities)

- **BTC**: always — BTC Up and BTC Down (if the market has both tokens).
- **ETH / Solana / XRP**: only if `enable_eth_trading` / `enable_solana_trading` / `enable_xrp_trading` are `true` in config.

For each such token, the bot creates a **buy opportunity** (limit price from config, token ID, condition ID, period). It then tries to place a **limit buy** for each opportunity, **skipping** any (period, token type) for which it already has an active position in this run (to avoid duplicate orders in the same period).

### Order execution (Trader)

- **Limit price**: from `trading.dual_limit_price` (e.g. 0.45).
- **Size (shares)**:
  - If `trading.dual_limit_shares` is set → use that as the number of shares per order.
  - Else → `fixed_trade_amount / bid_price` (e.g. $4.5 / 0.45 ≈ 10 shares).
- **Simulation**: logs the order and records it in memory and in `history/YYYY-MM-DD.json`; no CLOB call.
- **Production**: builds a CLOB client (with wallet + API creds), calls `createAndPostOrder` for a **GTC limit buy** at that price and size. Tracks the order in `pendingTrades` so we don’t double-place for the same (period, token type).

### Data flow summary

```
Config + CLI
    → Auth (optional)
    → Discover markets (Gamma: slug → condition_id, token_ids)
    → Loop:
        → CLOB order books → snapshot (prices, time_remaining)
        → If first ~2s of period and not yet placed this period:
            → Build opportunities (Up/Down for enabled assets)
            → For each: if no active position → place limit buy (or simulate)
            → (Simulation only: append to history/YYYY-MM-DD.json)
```

### What this bot does **not** do

- No **selling** or closing positions.
- No **market orders** (only limit buys at a fixed price).
- No **stop-loss**, **take-profit**, or **hedging** logic in the main loop (config has fields for them but they are unused in this dual-limit-start flow).
- No **re-discovery** of markets inside the loop (markets are discovered once at startup).

## Requirements

- Node.js >= 18
- `config.json` with Polymarket `private_key` (and optional API creds)

## Setup

```bash
npm install
cp config.json.example config.json   # or copy from Rust project
# Edit config.json: set polymarket.private_key (hex, with or without 0x)
```

## Usage

### Simulation (no real orders)

Simulation mode runs the same logic as production but **never sends orders** to Polymarket. It logs each “would-be” order and keeps a running summary (order count, total notional).

- **No `private_key` needed** for simulation: the bot can run with only `config.json` (or defaults) and will use read-only market data. CLOB auth is skipped if no key is set.
- **Summary**: After each market start where orders would be placed, the bot logs:  
  `Simulation summary (this run): N order(s), total notional $X.XX`
- **History**: Each summary is appended to `history/YYYY-MM-DD.json` (one JSON object per line, by date). The `history/` folder is created automatically and is in `.gitignore`.

```bash
npm run simulation
```

### Real trading (production)

Requires `config.json` with `polymarket.private_key` (and optionally API key/secret/passphrase). Places real limit orders on Polymarket.

```bash
npm run dev
# or after build:
npm run build && npm run start:live
```

### Config path

```bash
npx tsx src/main-dual-limit-045.ts -c /path/to/config.json
```

## Config

Same shape as the Rust bot:

- `polymarket.gamma_api_url`, `polymarket.clob_api_url` – API base URLs
- `polymarket.private_key` – EOA private key (hex); **optional for simulation** (leave empty to run without CLOB auth)
- `polymarket.proxy_wallet_address` – optional proxy/Magic wallet
- `trading.dual_limit_price` – limit price (default 0.45)
- `trading.dual_limit_shares` – optional fixed shares per order
- `trading.enable_eth_trading`, `enable_solana_trading`, `enable_xrp_trading` – enable extra markets

## Project layout

- `src/config.ts` – load config, parse CLI args (`--simulation` / `--no-simulation`, `-c` config path)
- `src/logger.ts` – re-exports `jonas-prettier-logger`; all app logging uses `logger.info()`, `logger.warn()`, `logger.error()`, `logger.trace()`
- `src/types.ts` – Market, Token, BuyOpportunity, MarketSnapshot
- `src/api.ts` – Gamma API (market by slug), CLOB order book
- `src/clob.ts` – CLOB client (ethers + @polymarket/clob-client), place limit order
- `src/monitor.ts` – fetch snapshot (prices, time remaining)
- `src/trader.ts` – hasActivePosition, executeLimitBuy, simulation tracking and `getSimulationSummary()`
- `src/simulation-history.ts` – save simulation results to `history/YYYY-MM-DD.json` (NDJSON by date)
- `src/main-dual-limit-045.ts` – discover markets, monitor loop, place limit orders at period start; logs and saves simulation summary when in simulation mode

## Build

```bash
npm run build
node dist/main-dual-limit-045.js
```
