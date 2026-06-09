# config.py
"""
Synthetic Indices Trading Agent — Configuration Module v4
Strategy v4 changes (2026-06-08):
  - Exit ticks reduced 120 → 40 (short spike-hunter window)
  - Stop loss 2.5 → 1.2 pts (inside natural noise to stop drift bleed)
  - Take profit 20 → 8.0 pts (spike partial-capture, achievable)
  - ENTRY_SCORE_THRESHOLD 0.42 → 0.57 (less overtrading)
  - POST_TRADE_COOLDOWN_TICKS 60 → 120 (let drift settle after loss)
  - TRADE_AGAINST_SPIKES False (unvalidated; adds noise)
  - OVERDUE_SCORE_GATE 0.30 (replaces unconditional OVERDUE trigger)
  - TRAILING_STOP_ACTIVE True (lock breakeven at 40% of TP)
  - HOT_ZONE_EXIT_TICKS 30 (short timeout for HOT/OVERDUE entries)
  - BUILDING zone lot scale removed (only HOT+ gets cycle scaling)
"""

import os

# --- DERIV API CONNECTION ---
APP_ID = 1089
DERIV_TOKEN = os.getenv("DERIV_API_TOKEN", "")
FORCE_LIVE_WS = True

# --- TRADING SYMBOLS ---
# BOOM1000 = avg 1 upward spike per 1000 ticks (~16 min)
# CRASH1000 = avg 1 downward spike per 1000 ticks
# BOOM500   = avg 1 upward spike per 500 ticks  (~8 min)
# CRASH500  = avg 1 downward spike per 500 ticks
ACTIVE_SYMBOL  = "CRASH500"
ACTIVE_SYMBOLS = ["BOOM1000"]   # multi-symbol mode: add up to 4 symbols

# --- SIMULATION & PAPER TRADING ---
INITIAL_BALANCE = 50
MIN_LOT_SIZE    = 0.5
DEFAULT_LOT_SIZE = 0.7

# --- MARTINGALE ---
MARTINGALE_ACTIVE          = False   # disabled by default (high risk)
MARTINGALE_FACTOR          = 1.4
MARTINGALE_MAX_MULTIPLIER  = 5

# --- TRADE MODE ---
# Controls which trade types the bot takes:
#   "WITH_SPIKES"    — only pre-spike entries (BUY BOOM / SELL CRASH)
#   "AGAINST_SPIKES" — only counter-spike drift trades (SELL BOOM / BUY CRASH after spike)
#   "BOTH"           — takes both types (different lot/TP/SL rules per type)
TRADE_MODE = "WITH_SPIKES"

# --- TRADE AGAINST SPIKES (counter-drift) ---
# Legacy flag — kept for backward compatibility. Superseded by TRADE_MODE.
TRADE_AGAINST_SPIKES = False
ANTI_SPIKE_LOT_SIZE  = 0.1

# --- COUNTER-SPIKE SPECIFIC PARAMETERS ---
# Drift after a spike is sharp but very short. Different rules apply.
COUNTER_SPIKE_TP_POINTS  = 3.0   # small target — drift fades fast
COUNTER_SPIKE_SL_POINTS  = 1.0   # tight cut — if drift isn't immediate, it won't come
COUNTER_SPIKE_HOLD_TICKS = 15    # max 15 ticks in a drift trade

# --- BOT EXIT PARAMETERS ---
# v4: Short windows force spike-timed entries or quick small losses.
# HOT/OVERDUE entries use HOT_ZONE_EXIT_TICKS (even shorter).
BOOM_EXIT_TICKS       = 40    # was 120
CRASH_EXIT_TICKS      = 40    # was 120
HOT_ZONE_EXIT_TICKS   = 30    # max hold when entry was in HOT or OVERDUE zone

# --- STOP LOSS / TAKE PROFIT ---
# v4.1: SL widened 1.2 → 2.0 after field test showed 1.2 was inside the natural drift
# range. BOOM1000 drifts ~0.035 pts/tick × 40 ticks = ~1.4 pts drift, so 1.2 fired on
# drift alone before spikes arrived. User held positions past bot SL and all 3 hit 15-20
# pt spike wins. 2.0 absorbs drift over the hold window; cuts genuine reversals only.
STOP_LOSS_POINTS    = 2    # field-tested: widened from 1.2 (too tight)
TAKE_PROFIT_POINTS  = 8    # spike partial-capture, achievable on real BOOM spikes

# --- TRAILING STOP ---
# Activates when PnL reaches TRAILING_STOP_TRIGGER_PCT × TP.
# Once triggered, trade exits if PnL drops back to breakeven (≤0).
TRAILING_STOP_ACTIVE      = True
TRAILING_STOP_TRIGGER_PCT = 0.40   # lock breakeven at 40% of TP = $3.2 gain

# --- BASELINE SPIKE STRATEGY HYPERPARAMETERS ---
TICK_WINDOW_SIZE              = 50
VOLATILITY_COMPRESSION_WINDOW = 20
VOLATILITY_BOLLINGER_DEV      = 1.5
SPIKE_THRESHOLD_FACTOR        = 2.5

# --- ENTRY FILTER THRESHOLDS ---
RSI_OVERSOLD        = 28
RSI_OVERBOUGHT      = 58
SQUEEZE_THRESHOLD   = 0.75
ZSCORE_ENTRY        = 0.8

# --- PROBABILITY SCORING MODEL (v4) ---
# Score threshold raised to 0.57 to reduce overtrading.
# RECOVERY zone: always blocks.
# OVERDUE zone: fires only if score >= OVERDUE_SCORE_GATE (not unconditional).
# This fixes the memoryless fallacy — a tick at position 1200 is no more
# likely to spike than one at position 400 (geometric distribution).
ENTRY_SCORE_THRESHOLD = 0.57    # was 0.42
OVERDUE_SCORE_GATE    = 0.30    # replaces unconditional OVERDUE trigger

# Component weights — must sum to 1.0.
WEIGHT_CYCLE       = 0.6
WEIGHT_COMPRESSION = 0.2
WEIGHT_ENERGY      = 0.2

# --- SPIKE CYCLE COUNTER ---
SPIKE_CYCLE_LENGTH = 1000
CYCLE_EARLY_ZONE   = 0.15    # RECOVERY ends at 15%
CYCLE_HOT_ZONE     = 0.6    # HOT begins at 60%

# Lot scaling: BUILDING zone uses flat DEFAULT_LOT_SIZE.
# HOT/OVERDUE zones apply cycle scaling (entering near expected spike).
CYCLE_LOT_SCALING   = True
CYCLE_MAX_LOT_SCALE = 2    # was 2.5 — capped lower for capital safety

# --- POST-TRADE COOLDOWN ---
# v4: 120 ticks gives price time to recover from drift before next entry.
POST_TRADE_COOLDOWN_TICKS = 120   # was 60

# --- RISK MANAGEMENT LIMITS ---
MAX_DAILY_LOSS              = 15
MAX_TRADES_PER_SESSION      = 50
COOLDOWN_AFTER_LOSS_STREAK  = 5
COOLDOWN_MINUTES            = 3
MAX_DRAWDOWN_PCT            = 0.3

# --- FILE PATHS ---
LOG_DIR          = "logs"
TRADE_LOG_CSV    = os.path.join(LOG_DIR, "trade_log.csv")
TRADE_LOG_JSON   = os.path.join(LOG_DIR, "trade_log.json")
BOT_METRICS_JSON = os.path.join(LOG_DIR, "bot_metrics.json")
