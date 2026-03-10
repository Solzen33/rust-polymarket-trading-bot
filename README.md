# Rust Polymarket Trading Bot

A Rust trading bot for [Polymarket](https://polymarket.com) that trades 15-minute price prediction markets using the **remain-5-mins** strategy: buy when a token’s price is ≥ $0.90 with at least 5 minutes remaining.

**Monitor / screenshot:**

![monitor](https://drive.google.com/uc?export=view&id=16gLuDy8OgBVB1cJM2W3HSnfF35axRNcG)

---

## Strategy: Remain 5 mins

**Binary:** `main_remain_5_mins` (default)

Buy a token (BTC/ETH/SOL/XRP Up or Down, from config) when:

- Its **BID price** is between **trigger_price** (default $0.90) and **max_buy_price** (default $0.95)
- At least **min_elapsed_minutes** (default 10) have passed in the 15‑minute window
- At least **min_time_remaining_seconds** (default **300 = 5 minutes**) remain before market close

Order size is controlled by `trading.fixed_trade_amount`. The bot does **not** buy if remaining time is below `min_time_remaining_seconds`.

**Config (summary):**

| Field | Default | Description |
|-------|--------|-------------|
| `trading.trigger_price` | 0.9 | Minimum BID to trigger a buy |
| `trading.max_buy_price` | 0.95 | Maximum price to pay (skip if above) |
| `trading.min_elapsed_minutes` | 10 | Minutes that must have elapsed |
| `trading.min_time_remaining_seconds` | 300 | Minimum seconds left (5 min) |
| `trading.fixed_trade_amount` | — | USD per order |
| `trading.enable_btc_trading` | true | Trade BTC markets |
| `trading.enable_eth_trading` | etc. | ETH, SOL, XRP from config |

**Risk:** If the outcome loses, you can lose the full position size. Use small `fixed_trade_amount` and run with `--simulation` first.

---

## Quick reference

| Binary | Description |
|--------|-------------|
| `main_remain_5_mins` | Remain-5-mins strategy (default) |
| `backtest` | Backtest on history files |
| `test_*` | test_limit_order, test_redeem, test_merge, test_allowance, test_sell, test_predict_fun |

---

## Setup

1. **Install Rust** (if needed):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Build:**
   ```bash
   cargo build --release
   ```

3. **Configure:** Copy `config.example.json` to `config.json` and set:
   - `polymarket`: `api_key`, `api_secret`, `api_passphrase`, `private_key`
   - Optional: `proxy_wallet_address`, `signature_type` (1 = POLY_PROXY, 2 = GNOSIS_SAFE)
   - `trading`: `trigger_price`, `max_buy_price`, `min_elapsed_minutes`, `min_time_remaining_seconds`, `fixed_trade_amount`, `enable_btc_trading`, etc.

---

## Run

```bash
# Simulation (no real orders)
cargo run -- --simulation

# Production (real orders)
cargo run -- --no-simulation
```

Optional: `--config <path>` (default: `config.json`).

---

## Test binaries

| Binary | Purpose |
|--------|---------|
| `test_limit_order` | Place a limit order |
| `test_redeem` | List/redeem winning tokens |
| `test_merge` | Merge complete sets to USDC |
| `test_allowance` | Check balance/allowance; set approval |
| `test_sell` | Test market sell |
| `test_predict_fun` | Test prediction/price logic |

Example:
```bash
cargo run --bin test_allowance -- --approve-only
cargo run --bin test_redeem -- --list
```

---

## Notes

- The bot runs until you stop it (Ctrl+C).
- Simulation mode logs trades but does not send orders.
- Before selling, set on-chain approval once per proxy wallet:  
  `cargo run --bin test_allowance -- --approve-only`

---

## Security

- Do **not** commit `config.json` with real keys or secrets.
- Prefer simulation and small sizes when testing.
- Monitor logs and balances when running in production.

## Support

If you have any questions or would like a more customized app for specific use cases, please feel free to contact us at the contact information below.
- Telegram: [@solzen33](https://t.me/solzen77)
