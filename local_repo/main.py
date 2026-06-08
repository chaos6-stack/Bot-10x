# main.py
"""
Synthetic Indices Trading Agent — Main Orchestrator v4
Multi-symbol support: pass any number of symbols as CLI args.
  python3 main.py                          → single BOOM1000
  python3 main.py CRASH500                 → single CRASH500
  python3 main.py BOOM1000 CRASH1000       → 2-symbol simultaneous
  python3 main.py BOOM1000 CRASH500 BOOM500 CRASH1000  → 4-symbol

Each symbol runs its own independent SpikeStrategy + DerivDataStream on
a daemon thread. All symbols share ONE PaperTrader + RiskManager (one
virtual account, one active trade at a time across all symbols).

The symbol with the highest spike_probability_pct at each tick is marked
as `best_signal_symbol` in live_ticks.json. Trades can fire on any symbol.
"""

import sys
import os
import json
import time
import threading
from logger import TradeLogger
from risk_manager import RiskManager
from trader import PaperTrader
from strategy import SpikeStrategy
from data_stream import DerivDataStream
import config


# ─────────────────────────────────────────────────────────────────────────────
#  PER-SYMBOL WORKER
# ─────────────────────────────────────────────────────────────────────────────

class SymbolWorker:
    """
    Manages all per-symbol state: stream, strategy, tick buffer, history.
    Receives the shared trader/logger so trades and balance are consolidated.
    """

    def __init__(self, symbol: str, shared_trader: PaperTrader,
                 shared_logger: TradeLogger):
        self.symbol  = symbol.upper()
        self.trader  = shared_trader
        self.logger  = shared_logger
        self.strategy = SpikeStrategy(self.symbol)
        self.stream   = None

        self.tick_buffer  = []
        self.tick_counter = 0
        self.live_history = []
        self.live_candles = []
        self.latest_analytics: dict  = {}
        self.latest_price:    float  = 0.0
        self.is_fallback:     bool   = False

    # ── Tick handler (called by stream thread) ────────────────────────────────

    def handle_tick(self, price: float, timestamp: int):
        self.tick_counter += 1
        self.latest_price  = price
        self.tick_buffer.append(price)

        if len(self.tick_buffer) > config.TICK_WINDOW_SIZE * 2:
            self.tick_buffer.pop(0)

        if self.tick_counter <= config.TICK_WINDOW_SIZE:
            if self.tick_counter % 5 == 0:
                print(f"[{self.symbol}] Warming up... ({self.tick_counter}/{config.TICK_WINDOW_SIZE})")
            self._record_tick(price, timestamp, {})
            return

        if len(self.tick_buffer) < config.TICK_WINDOW_SIZE:
            self._record_tick(price, timestamp, {})
            return

        decision, analytics = self.strategy.analyze_ticks(self.tick_buffer)
        self.latest_analytics = analytics

        if self.stream is not None:
            self.is_fallback = self.stream.use_fallback

        # Console diagnostic every 5 ticks
        if self.tick_counter % 5 == 0:
            zone      = analytics.get("cycle_zone", "?")
            ts        = analytics.get("ticks_since_spike", 0)
            cp        = analytics.get("cycle_position", 0) * 100
            score_pct = analytics.get("spike_probability_pct", 0.0)
            pos_str   = "NONE"
            if self.trader.active_trade and self.trader.active_trade["symbol"] == self.symbol:
                t = self.trader.active_trade
                pos_str = (
                    f"{t['direction']} x{t['lot_size']} "
                    f"(held {t['ticks_held']}tk @ {t['entry_price']:.3f})"
                )
            print(
                f"[{self.symbol}][#{self.tick_counter:>5}] "
                f"Price: {price:.3f}  "
                f"Score: {score_pct:.1f}%  "
                f"Cycle: {ts}tk/{cp:.0f}% [{zone}]  "
                f"Pos: {pos_str}"
            )

        self.trader.evaluate_decision(decision, price, analytics)
        self._record_tick(price, timestamp, analytics)

    def handle_candles(self, raw_candles):
        """Seeds historical 1M candle buffer from stream."""
        import random
        self.live_candles = []
        for c in raw_candles:
            ts   = c["epoch"]
            rsi  = 50.0
            if self.live_candles:
                rsi = self.live_candles[-1]["rsi_close"] + random.uniform(-2, 2)
                rsi = max(15.0, min(85.0, rsi))
            price_change = (c["high"] - c["open"]) if "BOOM" in self.symbol \
                           else (c["open"] - c["low"])
            is_spike = price_change > 12.0
            self.live_candles.append({
                "timestamp": ts,
                "open":  c["open"], "high":  c["high"],
                "low":   c["low"],  "close": c["close"],
                "rsi_open": rsi, "rsi_high": rsi,
                "rsi_low": rsi, "rsi_close": rsi,
                "is_spike": is_spike,
                "cycle_zone": "RECOVERY" if is_spike else "NORMAL"
            })

    def _record_tick(self, price: float, timestamp: int, analytics: dict):
        record = {
            "price":             price,
            "timestamp":         timestamp,
            "rsi":               analytics.get("rsi", 50.0),
            "compression_ratio": analytics.get("compression_ratio", 1.0),
            "cycle_zone":        analytics.get("cycle_zone", "UNKNOWN"),
            "is_spike":          analytics.get("is_current_spike", False),
        }
        self.live_history.append(record)
        if len(self.live_history) > 150:
            self.live_history.pop(0)

        # Rolling 1M candles
        minute_ts = (timestamp // 60) * 60
        if not self.live_candles or self.live_candles[-1]["timestamp"] < minute_ts:
            prev_rsi = self.live_candles[-1]["rsi_close"] if self.live_candles else 50.0
            rsi_val  = analytics.get("rsi", prev_rsi)
            self.live_candles.append({
                "timestamp": minute_ts,
                "open": price, "high": price,
                "low":  price, "close": price,
                "rsi_open": prev_rsi, "rsi_high": max(prev_rsi, rsi_val),
                "rsi_low":  min(prev_rsi, rsi_val), "rsi_close": rsi_val,
                "is_spike": analytics.get("is_current_spike", False),
                "cycle_zone": analytics.get("cycle_zone", "UNKNOWN"),
            })
        else:
            c = self.live_candles[-1]
            c["high"]  = max(c["high"], price)
            c["low"]   = min(c["low"],  price)
            c["close"] = price
            rsi_val    = analytics.get("rsi", c["rsi_close"])
            c["rsi_high"]  = max(c["rsi_high"],  rsi_val)
            c["rsi_low"]   = min(c["rsi_low"],   rsi_val)
            c["rsi_close"] = rsi_val
            if analytics.get("is_current_spike", False):
                c["is_spike"] = True
            if analytics.get("cycle_zone"):
                c["cycle_zone"] = analytics["cycle_zone"]

        if len(self.live_candles) > 150:
            self.live_candles.pop(0)

    def start(self):
        self.stream = DerivDataStream(
            symbol=self.symbol,
            on_tick_callback=self.handle_tick,
            on_candles_callback=self.handle_candles,
        )
        self.stream.start()

    def stop(self):
        if self.stream:
            self.stream.stop()


# ─────────────────────────────────────────────────────────────────────────────
#  MULTI-SYMBOL BOT ORCHESTRATOR
# ─────────────────────────────────────────────────────────────────────────────

class SyntheticTradingBot:
    def __init__(self, symbols: list[str]):
        self.symbols      = [s.upper() for s in symbols]
        self.logger       = TradeLogger()
        self.risk_manager = RiskManager(self.logger)
        self.trader       = PaperTrader(self.logger, self.risk_manager)
        self.workers      = {
            sym: SymbolWorker(sym, self.trader, self.logger)
            for sym in self.symbols
        }
        self._stop_event = threading.Event()

    def print_banner(self):
        sym_str  = " | ".join(self.symbols)
        mode_str = f"MULTI ({len(self.symbols)} symbols)" if len(self.symbols) > 1 else "SINGLE"
        banner = f"""
============================================================
   SYNTHISPIKE AI AGENT v4 — {mode_str}
   Monitoring: {sym_str}
============================================================
  Mode     : {'LIVE DERIV' if getattr(config, 'FORCE_LIVE_WS', True) else 'SIMULATION'}
  Balance  : ${self.trader.balance:.2f}
  Risk     : Max Daily Loss ${config.MAX_DAILY_LOSS:.0f} | Drawdown {config.MAX_DRAWDOWN_PCT*100:.0f}%
  SL / TP  : {config.STOP_LOSS_POINTS} pts / {config.TAKE_PROFIT_POINTS} pts
  Exit     : {config.BOOM_EXIT_TICKS} ticks (HOT: {getattr(config,'HOT_ZONE_EXIT_TICKS',30)})
  Trailing : {'ON' if getattr(config,'TRAILING_STOP_ACTIVE',True) else 'OFF'} at {getattr(config,'TRAILING_STOP_TRIGGER_PCT',0.40)*100:.0f}% of TP
============================================================
[SYSTEM] Starting workers. Press Ctrl+C to stop...
"""
        print(banner)

    def _save_loop(self):
        """Background thread: writes live_ticks.json every second."""
        while not self._stop_event.is_set():
            self._save_all_ticks()
            time.sleep(1.0)

    def _save_all_ticks(self):
        per_symbol: dict = {}
        for sym, worker in self.workers.items():
            a = worker.latest_analytics
            per_symbol[sym] = {
                "ticks":               worker.live_history[-150:],
                "candles":             worker.live_candles[-150:],
                "cycle_zone":          a.get("cycle_zone", "UNKNOWN"),
                "ticks_since_spike":   a.get("ticks_since_spike", 0),
                "cycle_position":      a.get("cycle_position", 0.0),
                "spike_probability_pct": a.get("spike_probability_pct", 0.0),
                "confidence_score":    a.get("confidence_score", 0.0),
                "entry_score":         a.get("entry_score", 0.0),
                "last_price":          worker.latest_price,
                "is_fallback":         worker.is_fallback,
                "tick_count":          worker.tick_counter,
            }

        # Symbol with the highest spike probability
        best_sym = max(
            per_symbol.keys(),
            key=lambda s: per_symbol[s]["spike_probability_pct"]
        )

        # Active trade details
        active_trade_info = None
        if self.trader.active_trade:
            t     = self.trader.active_trade
            sym   = t["symbol"]
            price = self.workers[sym].latest_price if sym in self.workers else t["entry_price"]
            lot   = t["lot_size"]
            pnl   = (price - t["entry_price"]) * lot \
                    if t["direction"] == "BUY" \
                    else (t["entry_price"] - price) * lot
            active_trade_info = {
                "trade_id":    t["trade_id"],
                "symbol":      sym,
                "direction":   t["direction"],
                "entry_price": t["entry_price"],
                "lot_size":    lot,
                "ticks_held":  t["ticks_held"],
                "pnl":         round(pnl, 2),
                "entry_zone":  t.get("entry_zone", "?"),
            }

        primary = self.symbols[0]
        ps      = per_symbol[primary]

        payload = {
            # Multi-symbol fields
            "mode":              "multi" if len(self.symbols) > 1 else "single",
            "symbols":           self.symbols,
            "per_symbol":        per_symbol,
            "best_signal_symbol": best_sym,
            # Shared account
            "active_trade":      active_trade_info,
            "balance":           round(self.trader.balance, 2),
            # Legacy single-symbol fields (backward compat)
            "symbol":            primary,
            "ticks":             ps["ticks"],
            "candles":           ps["candles"],
            "is_fallback":       any(w.is_fallback for w in self.workers.values()),
            "cycle_zone":        ps["cycle_zone"],
            "ticks_since_spike": ps["ticks_since_spike"],
            "cycle_position":    ps["cycle_position"],
            "spike_probability_pct": ps["spike_probability_pct"],
            "confidence_score":  ps["confidence_score"],
        }

        try:
            os.makedirs(config.LOG_DIR, exist_ok=True)
            ticks_path = os.path.join(config.LOG_DIR, "live_ticks.json")
            with open(ticks_path, "w") as f:
                json.dump(payload, f)
        except Exception:
            pass

    def run(self):
        self.print_banner()

        # Start save thread
        save_thread = threading.Thread(target=self._save_loop, daemon=True)
        save_thread.start()

        # Start all symbol workers
        for sym, worker in self.workers.items():
            print(f"[SYSTEM] Starting stream for {sym}...")
            worker.start()

        try:
            while True:
                time.sleep(1)
        except (KeyboardInterrupt, SystemExit):
            self.shutdown()

    def shutdown(self):
        print("\n[SYSTEM] Shutting down all streams safely...")
        self._stop_event.set()
        for sym, worker in self.workers.items():
            worker.stop()
            print(f"[SYSTEM] {sym} stream stopped.")

        wr  = self.trader.successful_trades / self.trader.total_trades \
              if self.trader.total_trades > 0 else 0.0
        pnl = self.trader.balance - config.INITIAL_BALANCE
        print(
            f"\n[SESSION SUMMARY]\n"
            f"  Symbols      : {' | '.join(self.symbols)}\n"
            f"  Trades       : {self.trader.total_trades}\n"
            f"  Win Rate     : {wr*100:.1f}%\n"
            f"  Net PnL      : ${pnl:+.2f}\n"
            f"  Final Balance: ${self.trader.balance:.2f}\n"
        )
        sys.exit(0)


# ─────────────────────────────────────────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if args:
        symbols = args
    else:
        symbols = getattr(config, "ACTIVE_SYMBOLS", [config.ACTIVE_SYMBOL])

    print(f"[SYSTEM] Launching bot for: {' + '.join(symbols)}")
    bot = SyntheticTradingBot(symbols)
    bot.run()
