# main.py
"""
Synthetic Indices Trading Agent - Main Orchestrator
Binds real-time stream ticks, runs indicators, triggers strategies,
enforces risk controls, and executes virtual paper trades.
"""

import sys
import time
from logger import TradeLogger
from risk_manager import RiskManager
from trader import PaperTrader
from strategy import SpikeStrategy
from data_stream import DerivDataStream
import config


class SyntheticTradingBot:
    def __init__(self, symbol: str = None):
        self.symbol       = (symbol or config.ACTIVE_SYMBOL).upper()
        self.logger       = TradeLogger()
        self.risk_manager = RiskManager(self.logger)
        self.trader       = PaperTrader(self.logger, self.risk_manager)
        self.strategy     = SpikeStrategy(self.symbol)
        self.stream       = None
        self.tick_buffer  = []
        self.tick_counter = 0

    def print_banner(self):
        banner = f"""
============================================================
   █▀▀ █▄█ █▄░█ ▀█▀ █░█ █▀▀ ▀█▀ █ █▀▀ █▀█ █▀█ ▀█▀
   ▄██ ░█░ █░▀█ ░█░ █▀█ ██▄ ░█░ █ █▄▄ █▀▄ █▄█ ░█░
       AI-ASSISTED SYNTHETIC INDICES TRADING AGENT
============================================================
  Symbol  : {self.symbol}          Virt Balance : ${self.trader.balance:.2f}
  Risk    : Max Daily Loss ${config.MAX_DAILY_LOSS:.0f}  Drawdown cap {config.MAX_DRAWDOWN_PCT*100:.0f}%
  Cycle   : {config.SPIKE_CYCLE_LENGTH} ticks   Lot Scaling  : {'ON' if config.CYCLE_LOT_SCALING else 'OFF'} (max {config.CYCLE_MAX_LOT_SCALE}x)
  SL/TP   : {config.STOP_LOSS_POINTS} pts / {config.TAKE_PROFIT_POINTS} pts   Exit Ticks   : {config.BOOM_EXIT_TICKS}
============================================================
[SYSTEM] Starting state engines. Press Ctrl+C to stop...
"""
        print(banner)

    def handle_tick(self, price: float, timestamp: int):
        """Callback executed on every incoming tick from the stream."""
        self.tick_counter += 1
        self.tick_buffer.append(price)

        # Rolling buffer — keep 2× window size for indicator accuracy
        if len(self.tick_buffer) > config.TICK_WINDOW_SIZE * 2:
            self.tick_buffer.pop(0)

        # Warm-up period
        if self.tick_counter <= config.TICK_WINDOW_SIZE:
            if self.tick_counter % 5 == 0:
                print(
                    f"[SYSTEM] Warming up indicators... "
                    f"({self.tick_counter}/{config.TICK_WINDOW_SIZE})"
                )
            self._save_live_tick(price, timestamp, {})
            return

        if len(self.tick_buffer) < config.TICK_WINDOW_SIZE:
            self._save_live_tick(price, timestamp, {})
            return

        # Run strategy
        decision, analytics = self.strategy.analyze_ticks(self.tick_buffer)

        # ── Console diagnostic every 5 ticks ─────────────────────────────
        if self.tick_counter % 5 == 0:
            zone        = analytics.get("cycle_zone", "?")
            ticks_spike = analytics.get("ticks_since_spike", 0)
            cycle_pct   = analytics.get("cycle_position", 0) * 100
            lot_scale   = analytics.get("cycle_lot_scale", 1.0)
            mult        = analytics.get("cycle_multiplier", 1.0)

            if self.trader.active_trade:
                t = self.trader.active_trade
                pos_str = (
                    f"{t['direction']} x{t['lot_size']} "
                    f"(held {t['ticks_held']}tk @ {t['entry_price']:.3f})"
                )
            else:
                pos_str = "NONE"

            print(
                f"[#{self.tick_counter:>5}] "
                f"Price: {price:.3f}  "
                f"RSI: {analytics.get('rsi', 0):.1f}  "
                f"Sqz: {analytics.get('compression_ratio', 1):.2f}  "
                f"Cycle: {ticks_spike}tk/{cycle_pct:.0f}% [{zone}] {mult:.2f}x"
                + (f" lots:{lot_scale:.2f}" if lot_scale != 1.0 else "")
                + f"  Pos: {pos_str}"
            )

        # ── Execute trade decision ────────────────────────────────────────
        self.trader.evaluate_decision(decision, price, analytics)
        self._save_live_tick(price, timestamp, analytics)

    def _save_live_tick(self, price: float, timestamp: int, analytics: dict):
        import os
        import json

        # Build tick record
        record = {
            "price": price,
            "timestamp": timestamp,
            "rsi": analytics.get("rsi", 50.0),
            "compression_ratio": analytics.get("compression_ratio", 1.0),
            "cycle_zone": analytics.get("cycle_zone", "UNKNOWN"),
            "is_spike": analytics.get("is_current_spike", False)
        }

        # Maintain history in memory
        if not hasattr(self, "live_history"):
            self.live_history = []

        self.live_history.append(record)
        if len(self.live_history) > 150:
            self.live_history.pop(0)

        # Maintain 1M candles in memory
        if not hasattr(self, "live_candles"):
            self.live_candles = []

        minute_timestamp = (timestamp // 60) * 60

        if not self.live_candles or self.live_candles[-1]["timestamp"] < minute_timestamp:
            prev_rsi = self.live_candles[-1]["rsi_close"] if self.live_candles else 50.0
            rsi_val = analytics.get("rsi", prev_rsi)
            new_candle = {
                "timestamp": minute_timestamp,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
                "rsi_open": prev_rsi,
                "rsi_high": max(prev_rsi, rsi_val),
                "rsi_low": min(prev_rsi, rsi_val),
                "rsi_close": rsi_val,
                "is_spike": analytics.get("is_current_spike", False),
                "cycle_zone": analytics.get("cycle_zone", "UNKNOWN")
            }
            self.live_candles.append(new_candle)
        else:
            last_candle = self.live_candles[-1]
            last_candle["high"] = max(last_candle["high"], price)
            last_candle["low"] = min(last_candle["low"], price)
            last_candle["close"] = price
            
            rsi_val = analytics.get("rsi", last_candle["rsi_close"])
            last_candle["rsi_high"] = max(last_candle["rsi_high"], rsi_val)
            last_candle["rsi_low"] = min(last_candle["rsi_low"], rsi_val)
            last_candle["rsi_close"] = rsi_val
            
            if analytics.get("is_current_spike", False):
                last_candle["is_spike"] = True
            if analytics.get("cycle_zone"):
                last_candle["cycle_zone"] = analytics["cycle_zone"]

        # Limit to 150 candles (spanning 2.5 hours)
        if len(self.live_candles) > 150:
            self.live_candles.pop(0)

        # Get active trade details
        active_trade_info = None
        if self.trader.active_trade:
            t = self.trader.active_trade
            direction = t["direction"]
            entry = t["entry_price"]
            lot = t["lot_size"]
            pnl = (price - entry) * lot if direction == "BUY" else (entry - price) * lot
            active_trade_info = {
                "trade_id": t["trade_id"],
                "direction": direction,
                "entry_price": entry,
                "lot_size": lot,
                "ticks_held": t["ticks_held"],
                "pnl": round(pnl, 2)
            }

        # Build payload
        is_fallback = True
        if self.stream is not None:
            is_fallback = self.stream.use_fallback

        payload = {
            "symbol": self.symbol,
            "ticks": self.live_history,
            "candles": self.live_candles,
            "active_trade": active_trade_info,
            "balance": round(self.trader.balance, 2),
            "is_fallback": is_fallback,
            # Live cycle analytics for the dashboard gauge
            "cycle_zone": analytics.get("cycle_zone", "UNKNOWN"),
            "ticks_since_spike": analytics.get("ticks_since_spike", 0),
            "cycle_position": analytics.get("cycle_position", 0.0),
            "spike_probability_pct": round(analytics.get("spike_probability", 0.0) * 100, 1),
            "confidence_score": round(analytics.get("entry_score", 0.0) * 100, 1),
        }

        # Write to JSON file
        try:
            os.makedirs(config.LOG_DIR, exist_ok=True)
            ticks_path = os.path.join(config.LOG_DIR, "live_ticks.json")
            with open(ticks_path, "w") as f:
                json.dump(payload, f)
        except Exception:
            pass

    def handle_candles(self, raw_candles):
        """Callback to seed/set the initial list of 1M historical candles."""
        import random
        self.live_candles = []
        for c in raw_candles:
            timestamp = c["epoch"]
            rsi = 50.0
            if len(self.live_candles) > 0:
                prev_c = self.live_candles[-1]
                rsi = prev_c["rsi_close"] + random.uniform(-2, 2)
                rsi = max(15.0, min(85.0, rsi))
            
            # Simple check if there's a big price change to classify a historical spike
            price_change = (c["high"] - c["open"]) if "BOOM" in self.symbol else (c["open"] - c["low"])
            is_spike = price_change > 12.0
            
            candle = {
                "timestamp": timestamp,
                "open": c["open"],
                "high": c["high"],
                "low": c["low"],
                "close": c["close"],
                "rsi_open": rsi,
                "rsi_high": rsi,
                "rsi_low": rsi,
                "rsi_close": rsi,
                "is_spike": is_spike,
                "cycle_zone": "RECOVERY" if is_spike else "NORMAL"
            }
            self.live_candles.append(candle)

    def run(self):
        self.print_banner()
        self.stream = DerivDataStream(
            symbol=self.symbol,
            on_tick_callback=self.handle_tick,
            on_candles_callback=self.handle_candles
        )
        self.stream.start()

        try:
            while True:
                time.sleep(1)
        except (KeyboardInterrupt, SystemExit):
            self.shutdown()

    def shutdown(self):
        print("\n[SYSTEM] Shutting down safely...")
        if self.stream:
            self.stream.stop()

        # Print final session summary
        wr  = self.trader.successful_trades / self.trader.total_trades \
              if self.trader.total_trades > 0 else 0.0
        pnl = self.trader.balance - config.INITIAL_BALANCE
        print(
            f"\n[SESSION SUMMARY]\n"
            f"  Trades       : {self.trader.total_trades}\n"
            f"  Win Rate     : {wr*100:.1f}%\n"
            f"  Net PnL      : ${pnl:+.2f}\n"
            f"  Final Balance: ${self.trader.balance:.2f}\n"
            f"  Spikes seen  : {self.strategy.total_spikes_observed}\n"
        )
        sys.exit(0)


if __name__ == "__main__":
    symbol = sys.argv[1] if len(sys.argv) > 1 else config.ACTIVE_SYMBOL
    bot = SyntheticTradingBot(symbol)
    bot.run()
