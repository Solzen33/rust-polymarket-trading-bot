// Remain-5-mins bot: buy when a token's price is >= trigger (e.g. $0.90) with at least 5 minutes remaining.
// Uses config: trigger_price, max_buy_price, min_elapsed_minutes, min_time_remaining_seconds (default 300 = 5 min).

use polymarket_trading_bot::*;
use anyhow::{Context, Result};
use clap::Parser;
use polymarket_trading_bot::config::{Args, Config};
use log::warn;
use std::sync::Arc;

use polymarket_trading_bot::api::PolymarketApi;
use polymarket_trading_bot::monitor::MarketMonitor;
use polymarket_trading_bot::detector::PriceDetector;
use polymarket_trading_bot::trader::Trader;

const PERIOD_DURATION: u64 = 900;

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .init();

    let args = Args::parse();
    let config = Config::load(&args.config)?;
    let is_simulation = args.is_simulation();

    eprintln!("🚀 Starting Polymarket Remain-5-Mins Bot");
    eprintln!("Mode: {}", if is_simulation { "SIMULATION (no orders)" } else { "PRODUCTION (real orders)" });

    let trigger_price = config.trading.trigger_price;
    let max_buy_price = config.trading.max_buy_price.unwrap_or(0.95);
    let min_elapsed_minutes = config.trading.min_elapsed_minutes;
    let min_time_remaining_seconds = config.trading.min_time_remaining_seconds.unwrap_or(300);

    eprintln!(
        "Strategy: Buy when token BID >= ${:.2} and <= ${:.2}, after {} min elapsed, with >= {}s ({} min) remaining.",
        trigger_price, max_buy_price, min_elapsed_minutes, min_time_remaining_seconds, min_time_remaining_seconds / 60
    );
    let mut markets = vec!["BTC"];
    if config.trading.enable_eth_trading { markets.push("ETH"); }
    if config.trading.enable_solana_trading { markets.push("SOL"); }
    if config.trading.enable_xrp_trading { markets.push("XRP"); }
    eprintln!("   Markets: {}", markets.join(", "));

    let api = Arc::new(PolymarketApi::new(
        config.polymarket.gamma_api_url.clone(),
        config.polymarket.clob_api_url.clone(),
        config.polymarket.api_key.clone(),
        config.polymarket.api_secret.clone(),
        config.polymarket.api_passphrase.clone(),
        config.polymarket.private_key.clone(),
        config.polymarket.proxy_wallet_address.clone(),
        config.polymarket.signature_type,
    ));

    eprintln!("\n═══════════════════════════════════════════════════════════");
    eprintln!("🔐 Authenticating with Polymarket CLOB API...");
    eprintln!("═══════════════════════════════════════════════════════════");
    api.authenticate().await.context("Authentication failed")?;
    eprintln!("✅ Authentication successful!");
    eprintln!("═══════════════════════════════════════════════════════════\n");

    eprintln!("🔍 Discovering markets...");
    let (eth_market, btc_market, solana_market, xrp_market) = get_or_discover_markets(
        &api,
        config.trading.enable_eth_trading,
        config.trading.enable_solana_trading,
        config.trading.enable_xrp_trading,
    )
    .await?;

    let monitor = MarketMonitor::new(
        api.clone(),
        eth_market,
        btc_market,
        solana_market,
        xrp_market,
        config.trading.check_interval_ms,
        is_simulation,
        None,
        Some(config.trading.enable_eth_trading),
        Some(config.trading.enable_solana_trading),
        Some(config.trading.enable_xrp_trading),
        None,
        None,
    )?;
    let monitor_arc = Arc::new(monitor);

    let detector = Arc::new(PriceDetector::new(
        trigger_price,
        max_buy_price,
        min_elapsed_minutes,
        min_time_remaining_seconds,
        config.trading.enable_eth_trading,
        config.trading.enable_solana_trading,
        config.trading.enable_xrp_trading,
    ));

    let trader = Arc::new(Trader::new(
        api.clone(),
        config.trading.clone(),
        is_simulation,
        Some(detector.clone()),
    )?);
    let trader_clone = trader.clone();

    eprintln!("🔄 Syncing pending trades with portfolio...");
    if let Err(e) = trader_clone.sync_trades_with_portfolio().await {
        warn!("Error syncing trades with portfolio: {}", e);
    }

    let trader_check = trader_clone.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(1000));
        loop {
            interval.tick().await;
            if let Err(e) = trader_check.check_pending_trades().await {
                warn!("Error checking pending trades: {}", e);
            }
        }
    });

    let discovery_notify = Arc::new(tokio::sync::Notify::new());
    let last_notified_period: Arc<tokio::sync::Mutex<Option<u64>>> = Arc::new(tokio::sync::Mutex::new(None));

    let monitor_for_period = monitor_arc.clone();
    let api_for_period = api.clone();
    let detector_for_period = detector.clone();
    let trader_for_period = trader_clone.clone();
    let enable_eth = config.trading.enable_eth_trading;
    let enable_solana = config.trading.enable_solana_trading;
    let enable_xrp = config.trading.enable_xrp_trading;
    let discovery_notify_task = discovery_notify.clone();
    tokio::spawn(async move {
        loop {
            let current_time = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            let current_period = (current_time / PERIOD_DURATION) * PERIOD_DURATION;
            let current_market_timestamp = monitor_for_period.get_current_market_timestamp().await;
            let market_ended = current_market_timestamp != current_period && current_market_timestamp != 0;

            if market_ended {
                eprintln!("🔄 Market finished. Discovering new market for period {}...", current_period);
            } else {
                let next_period = current_period + PERIOD_DURATION;
                let sleep_secs = next_period.saturating_sub(current_time);
                if sleep_secs > 0 {
                    let chunk = std::cmp::min(sleep_secs, 30);
                    tokio::select! {
                        _ = discovery_notify_task.notified() => {}
                        _ = tokio::time::sleep(tokio::time::Duration::from_secs(chunk)) => {}
                    }
                    continue;
                }
            }

            let current_time = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            let current_period = (current_time / PERIOD_DURATION) * PERIOD_DURATION;
            eprintln!("🔄 New 15-minute period {} — discovering markets...", current_period);

            let mut seen_ids = std::collections::HashSet::new();
            let eth_result = if enable_eth {
                discover_market(&api_for_period, "ETH", &["eth"], current_time, &mut seen_ids, true).await
            } else {
                Ok(disabled_eth_market())
            };
            let btc_result = discover_market(&api_for_period, "BTC", &["btc"], current_time, &mut seen_ids, true).await;
            let solana_market = if enable_solana {
                discover_solana_market(&api_for_period, current_time, &mut seen_ids).await
            } else {
                disabled_solana_market()
            };
            let xrp_market = if enable_xrp {
                discover_xrp_market(&api_for_period, current_time, &mut seen_ids).await
            } else {
                disabled_xrp_market()
            };

            match (eth_result, btc_result) {
                (Ok(eth_market), Ok(btc_market)) => {
                    if let Err(e) = monitor_for_period.update_markets(eth_market.clone(), btc_market.clone(), solana_market.clone(), xrp_market.clone()).await {
                        warn!("Failed to update markets: {}", e);
                    } else {
                        eprintln!("✅ New markets loaded for period {}", current_period);
                        detector_for_period.reset_period().await;
                        trader_for_period.reset_period(current_period).await;
                    }
                }
                (Err(e), _) => warn!("Failed to discover ETH market: {}", e),
                (_, Err(e)) => warn!("Failed to discover BTC market: {}", e),
            }
        }
    });

    let detector_cb = detector.clone();
    let trader_cb = trader_clone.clone();
    let monitor_for_cb = monitor_arc.clone();
    let api_cb = api.clone();
    let last_notified = last_notified_period.clone();
    let discovery_notify_cb = discovery_notify.clone();

    monitor_arc.start_monitoring(move |snapshot| {
        let detector = detector_cb.clone();
        let trader = trader_cb.clone();
        let monitor = monitor_for_cb.clone();
        let api = api_cb.clone();
        let last_notified = last_notified.clone();
        let discovery_notify = discovery_notify_cb.clone();
        let enable_eth = enable_eth;
        let enable_solana = enable_solana;
        let enable_xrp = enable_xrp;

        async move {
            if snapshot.time_remaining_seconds == 0 {
                let should_run = {
                    let mut last = last_notified.lock().await;
                    if *last != Some(snapshot.period_timestamp) {
                        *last = Some(snapshot.period_timestamp);
                        discovery_notify.notify_one();
                        true
                    } else {
                        false
                    }
                };
                if should_run {
                    let current_time = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs();
                    let current_period = (current_time / PERIOD_DURATION) * PERIOD_DURATION;
                    eprintln!("🔄 Market ended. Discovering new market for period {}...", current_period);
                    match get_or_discover_markets(&api, enable_eth, enable_solana, enable_xrp).await {
                        Ok((eth_market, btc_market, solana_market, xrp_market)) => {
                            if let Err(e) = monitor.update_markets(eth_market.clone(), btc_market.clone(), solana_market.clone(), xrp_market.clone()).await {
                                warn!("Failed to update markets (on 0s): {}", e);
                            } else {
                                eprintln!("✅ New markets loaded for period {}", current_period);
                                detector.reset_period().await;
                                trader.reset_period(current_period).await;
                            }
                        }
                        Err(e) => warn!("Discovery on market end failed: {}", e),
                    }
                }
                return;
            }
            {
                let mut last = last_notified.lock().await;
                *last = None;
            }

            let opportunities = detector.detect_opportunities(&snapshot).await;
            for opp in opportunities {
                let has_position = trader.has_active_position(opp.period_timestamp, opp.token_type.clone()).await;
                if has_position {
                    continue;
                }
                match trader.execute_buy(&opp).await {
                    Ok(()) => {
                        detector.mark_token_bought(opp.token_id).await;
                    }
                    Err(e) => {
                        warn!("Execute buy failed for {}: {}", opp.token_type.display_name(), e);
                    }
                }
            }
        }
    })
    .await;

    Ok(())
}

async fn get_or_discover_markets(
    api: &PolymarketApi,
    enable_eth: bool,
    enable_solana: bool,
    enable_xrp: bool,
) -> Result<(
    polymarket_trading_bot::models::Market,
    polymarket_trading_bot::models::Market,
    polymarket_trading_bot::models::Market,
    polymarket_trading_bot::models::Market,
)> {
    let current_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let mut seen_ids = std::collections::HashSet::new();

    let eth_market = if enable_eth {
        discover_market(api, "ETH", &["eth"], current_time, &mut seen_ids, true).await
            .unwrap_or_else(|_| disabled_eth_market())
    } else {
        disabled_eth_market()
    };
    seen_ids.insert(eth_market.condition_id.clone());

    let btc_market = discover_market(api, "BTC", &["btc"], current_time, &mut seen_ids, true).await
        .unwrap_or_else(|_| {
            eprintln!("⚠️  Could not discover BTC market - using fallback");
            polymarket_trading_bot::models::Market {
                condition_id: "dummy_btc_fallback".to_string(),
                slug: "btc-updown-15m-fallback".to_string(),
                active: false,
                closed: true,
                market_id: None,
                question: "BTC Fallback".to_string(),
                resolution_source: None,
                end_date_iso: None,
                end_date_iso_alt: None,
                tokens: None,
                clob_token_ids: None,
                outcomes: None,
            }
        });
    seen_ids.insert(btc_market.condition_id.clone());

    let solana_market = if enable_solana {
        discover_solana_market(api, current_time, &mut seen_ids).await
    } else {
        disabled_solana_market()
    };
    let xrp_market = if enable_xrp {
        discover_xrp_market(api, current_time, &mut seen_ids).await
    } else {
        disabled_xrp_market()
    };

    Ok((eth_market, btc_market, solana_market, xrp_market))
}

fn disabled_eth_market() -> polymarket_trading_bot::models::Market {
    polymarket_trading_bot::models::Market {
        condition_id: "dummy_eth_fallback".to_string(),
        slug: "eth-updown-15m-fallback".to_string(),
        active: false,
        closed: true,
        market_id: None,
        question: "ETH Disabled".to_string(),
        resolution_source: None,
        end_date_iso: None,
        end_date_iso_alt: None,
        tokens: None,
        clob_token_ids: None,
        outcomes: None,
    }
}

fn disabled_solana_market() -> polymarket_trading_bot::models::Market {
    polymarket_trading_bot::models::Market {
        condition_id: "dummy_solana_fallback".to_string(),
        slug: "solana-updown-15m-fallback".to_string(),
        active: false,
        closed: true,
        market_id: None,
        question: "Solana Disabled".to_string(),
        resolution_source: None,
        end_date_iso: None,
        end_date_iso_alt: None,
        tokens: None,
        clob_token_ids: None,
        outcomes: None,
    }
}

fn disabled_xrp_market() -> polymarket_trading_bot::models::Market {
    polymarket_trading_bot::models::Market {
        condition_id: "dummy_xrp_fallback".to_string(),
        slug: "xrp-updown-15m-fallback".to_string(),
        active: false,
        closed: true,
        market_id: None,
        question: "XRP Disabled".to_string(),
        resolution_source: None,
        end_date_iso: None,
        end_date_iso_alt: None,
        tokens: None,
        clob_token_ids: None,
        outcomes: None,
    }
}

async fn discover_solana_market(
    api: &PolymarketApi,
    current_time: u64,
    seen_ids: &mut std::collections::HashSet<String>,
) -> polymarket_trading_bot::models::Market {
    if let Ok(market) = discover_market(api, "Solana", &["solana", "sol"], current_time, seen_ids, false).await {
        return market;
    }
    disabled_solana_market()
}

async fn discover_xrp_market(
    api: &PolymarketApi,
    current_time: u64,
    seen_ids: &mut std::collections::HashSet<String>,
) -> polymarket_trading_bot::models::Market {
    if let Ok(market) = discover_market(api, "XRP", &["xrp"], current_time, seen_ids, false).await {
        return market;
    }
    disabled_xrp_market()
}

async fn discover_market(
    api: &PolymarketApi,
    market_name: &str,
    slug_prefixes: &[&str],
    current_time: u64,
    seen_ids: &mut std::collections::HashSet<String>,
    include_previous: bool,
) -> Result<polymarket_trading_bot::models::Market> {
    let rounded_time = (current_time / 900) * 900;

    for (i, prefix) in slug_prefixes.iter().enumerate() {
        if i > 0 {
            eprintln!("🔍 Trying {} market with slug prefix '{}'...", market_name, prefix);
        }
        let slug = format!("{}-updown-15m-{}", prefix, rounded_time);
        if let Ok(market) = api.get_market_by_slug(&slug).await {
            if !seen_ids.contains(&market.condition_id) && market.active && !market.closed {
                eprintln!("Found {} market: {} | Condition ID: {}", market_name, market.slug, market.condition_id);
                return Ok(market);
            }
        }

        if include_previous {
            for offset in 1..=3 {
                let try_time = rounded_time - (offset * 900);
                let try_slug = format!("{}-updown-15m-{}", prefix, try_time);
                if let Ok(market) = api.get_market_by_slug(&try_slug).await {
                    if !seen_ids.contains(&market.condition_id) && market.active && !market.closed {
                        eprintln!("Found {} market: {} | Condition ID: {}", market_name, market.slug, market.condition_id);
                        return Ok(market);
                    }
                }
            }
        }
    }

    let tried = slug_prefixes.join(", ");
    anyhow::bail!(
        "Could not find active {} 15-minute up/down market (tried prefixes: {}).",
        market_name,
        tried
    )
}
