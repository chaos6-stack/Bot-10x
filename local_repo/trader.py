# trader.py
"""
Simulated Paper Execution Engine — v4 (2026-06-08)

v4 changes:
  - Trailing stop: activates when PnL >= TRAILING_STOP_TRIGGER_PCT × TP.
    Once active, trade closes if PnL drops back to ≤ 0.
  - Entry zone tracking: HOT/OVERDUE entries use HOT_ZONE_EXIT_TICKS (shorter).
    BUILDING entries use BOOM/CRASH_EXIT_TICKS (normal).
  - Asymmetric lot sizing: BUILDING zone uses flat DEFAULT_LOT_SIZE.
    Only HOT/OVERDUE applies cycle_lot_scale.
"""

import uuid
import config
from logger import TradeLogger
from risk_manager import RiskManager


class PaperTrader:
    def __init__(self, logger: TradeLogger, risk_manager: RiskManager):
        self.logger        = logger
        self.risk_manager  = risk_manager
        self.balance       = config.INITIAL_BALANCE
        self.active_trade  = None

        self.total_trades      = 0
        self.successful_trades = 0
        self.total_profit      = 0.0
        self.max_balance       = self.balance
        self.max_drawdown      = 0.0

        self.ticks_since_last_close = config.POST_TRADE_COOLDOWN_TICKS

    # ─────────────────────────────────────────────────────────────────────
    #  ENTRY
    # ─────────────────────────────────────────────────────────────────────

    def evaluate_decision(self, decision: str, current_price: float, analytics: dict):
        if self.active_trade:
            self._update_active_trade(current_price, analytics)
            return

        self.ticks_since_last_close += 1

        if decision == "HOLD":
            return

        if self.ticks_since_last_close < config.POST_TRADE_COOLDOWN_TICKS:
            remaining = config.POST_TRADE_COOLDOWN_TICKS - self.ticks_since_last_close
            self.logger.log(f"Cooldown: {remaining} ticks remaining", "DEBUG")
            return

        can_trade, risk_reason = self.risk_manager.can_trade(self.balance)
        if not can_trade:
            self.logger.log(f"Entry Blocked: {risk_reason}", "DEBUG")
            return

        # ── Lot sizing (v4: asymmetric — BUILDING = flat, HOT/OVERDUE = scaled) ──
        is_counter_spike = analytics.get("is_counter_spike", False)
        cycle_zone       = analytics.get("cycle_zone", "BUILDING")
        cycle_scale      = analytics.get("cycle_lot_scale", 1.0)  # already 1.0 for BUILDING

        base_lot = (
            getattr(config, "ANTI_SPIKE_LOT_SIZE", 0.10)
            if is_counter_spike else config.DEFAULT_LOT_SIZE
        )

        # Martingale
        loss_streak = self.risk_manager.consecutive_losses
        if getattr(config, "MARTINGALE_ACTIVE", False) and loss_streak > 0:
            m_mult = config.MARTINGALE_FACTOR ** loss_streak
            m_mult = min(m_mult, config.MARTINGALE_MAX_MULTIPLIER)
            base_lot = base_lot * m_mult

        # Cycle scale only in HOT/OVERDUE (not BUILDING)
        if is_counter_spike:
            lot_size = round(base_lot, 2)
        else:
            lot_size = round(base_lot * cycle_scale, 2)  # cycle_scale=1.0 for BUILDING

        lot_size = max(config.MIN_LOT_SIZE, lot_size)

        # Determine timeout: HOT/OVERDUE entries use the short window
        is_hot_entry = analytics.get("hot_zone_entry", False)

        self.active_trade = {
            "trade_id":          str(uuid.uuid4())[:8],
            "symbol":            analytics.get("symbol", config.ACTIVE_SYMBOL),
            "direction":         decision,
            "entry_price":       current_price,
            "lot_size":          lot_size,
            "ticks_held":        0,
            "peak_pnl":          0.0,
            "is_counter_spike":  is_counter_spike,
            "entry_zone":        cycle_zone,
            "is_hot_entry":      is_hot_entry,
            "breakeven_locked":  False,      # trailing stop flag
        }

        log_parts = [f"OPENED {decision} {self.active_trade['symbol']} @ {current_price:.4f}"]
        log_parts.append(f"Lots: {lot_size}")
        if cycle_scale != 1.0: log_parts.append(f"scale {cycle_scale:.2f}x")
        if getattr(config, "MARTINGALE_ACTIVE", False) and loss_streak > 0:
            log_parts.append(f"Martingale {config.MARTINGALE_FACTOR**loss_streak:.1f}x")
        log_parts.append(f"Zone: {cycle_zone} ({analytics.get('ticks_since_spike', 0)} ticks)")
        log_parts.append(f"HotEntry: {is_hot_entry}")
        self.logger.log(" | ".join(log_parts), "ORDER")

    # ─────────────────────────────────────────────────────────────────────
    #  POSITION MANAGEMENT
    # ─────────────────────────────────────────────────────────────────────

    def _update_active_trade(self, current_price: float, analytics: dict):
        trade      = self.active_trade
        trade["ticks_held"] += 1
        ticks_held = trade["ticks_held"]
        direction  = trade["direction"]
        entry      = trade["entry_price"]
        lot        = trade["lot_size"]

        pnl = (current_price - entry) * lot if direction == "BUY" \
              else (entry - current_price) * lot

        if pnl > trade["peak_pnl"]:
            trade["peak_pnl"] = pnl

        # ── Timeout: counter trades use short drift window; HOT/OVERDUE use HOT window ──
        if trade.get("is_counter_spike", False):
            max_held = getattr(config, "COUNTER_SPIKE_HOLD_TICKS", 15)
        elif trade.get("is_hot_entry", False):
            max_held = getattr(config, "HOT_ZONE_EXIT_TICKS", 30)
        else:
            sym = trade.get("symbol", config.ACTIVE_SYMBOL)
            max_held = config.BOOM_EXIT_TICKS if "BOOM" in sym.upper() \
                       else config.CRASH_EXIT_TICKS

        should_exit = False
        exit_reason = "Tick timeout"
        spike_cap   = False

        is_counter = trade.get("is_counter_spike", False)

        # ── Per-trade-type TP / SL constants ──────────────────────────────────
        if is_counter:
            sl_pts = getattr(config, "COUNTER_SPIKE_SL_POINTS", 1.0)
            tp_pts = getattr(config, "COUNTER_SPIKE_TP_POINTS", 3.0)
        else:
            sl_pts = config.STOP_LOSS_POINTS
            tp_pts = config.TAKE_PROFIT_POINTS

        # ── Exit 1: Stop-loss ─────────────────────────────────────────────────
        sl_limit = -sl_pts * lot
        if pnl <= sl_limit:
            pnl = sl_limit          # clamp: simulate guaranteed broker SL fill
            should_exit = True
            exit_reason = f"Stop-loss ({pnl:.3f})"

        # ── Exit 2: Counter-spike zone ended ──────────────────────────────────
        elif is_counter and analytics.get("cycle_zone", "RECOVERY") != "RECOVERY":
            should_exit = True
            exit_reason = "RECOVERY zone ended (drift captured)"

        # ── Exit 3: Take-profit ───────────────────────────────────────────────
        elif pnl >= tp_pts * lot:
            pnl = tp_pts * lot      # clamp: simulate guaranteed broker TP fill
            should_exit = True
            exit_reason = f"Take-profit ({pnl:.3f})"

        # ── Exit 4: Trailing stop (breakeven lock — with-spike trades only) ───
        elif not is_counter and getattr(config, "TRAILING_STOP_ACTIVE", True):
            trigger = tp_pts * lot * getattr(config, "TRAILING_STOP_TRIGGER_PCT", 0.40)
            if not trade["breakeven_locked"] and pnl >= trigger:
                trade["breakeven_locked"] = True
                self.logger.log(
                    f"TRAILING STOP ARMED — PnL ${pnl:.2f} hit trigger ${trigger:.2f} | "
                    f"Trade {trade['trade_id']} | Will close if PnL drops ≤ 0",
                    "ORDER"
                )
            if trade["breakeven_locked"] and pnl <= 0:
                should_exit = True
                exit_reason = "Trailing stop — breakeven locked"

        # ── Exit 5: Spike in our direction ────────────────────────────────────
        if not should_exit and analytics.get("is_current_spike", False):
            last_chg   = analytics.get("last_change", 0.0)
            good_spike = (direction == "BUY"  and last_chg > 0) or \
                         (direction == "SELL" and last_chg < 0)
            if good_spike:
                should_exit = True
                spike_cap   = True
                exit_reason = "SPIKE CAPTURED"
            elif pnl < 0:
                should_exit = True
                exit_reason = "Adverse spike — cutting loss"

        # ── Exit 6: Tick timeout ──────────────────────────────────────────────
        if not should_exit and ticks_held >= max_held:
            should_exit = True
            exit_reason = f"Timeout ({max_held} ticks, {'HOT entry' if trade.get('is_hot_entry') else 'normal'})"

        if should_exit:
            self._close_trade(current_price, pnl, exit_reason, spike_cap, ticks_held)

    # ─────────────────────────────────────────────────────────────────────
    #  TRADE CLOSE
    # ─────────────────────────────────────────────────────────────────────

    def _close_trade(self, exit_price: float, pnl: float, exit_reason: str,
                     spike_captured: bool, ticks_held: int):
        trade  = self.active_trade
        is_win = pnl > 0
        result = "WIN " if is_win else "LOSS"

        self.balance += pnl
        self.total_trades += 1
        if is_win:
            self.successful_trades += 1
            self.total_profit += pnl

        self.risk_manager.record_trade_result(pnl)

        if self.balance > self.max_balance:
            self.max_balance = self.balance
        drawdown = (self.max_balance - self.balance) / self.max_balance \
                   if self.max_balance > 0 else 0.0
        if drawdown > self.max_drawdown:
            self.max_drawdown = drawdown

        win_rate = self.successful_trades / self.total_trades \
                   if self.total_trades > 0 else 0.0

        self.logger.log(
            f"CLOSED [{result}] {trade['direction']} {trade['symbol']} | "
            f"Entry: {trade['entry_price']:.4f} → {exit_price:.4f} | "
            f"PnL: {pnl:+.4f} (lots {trade['lot_size']}) | "
            f"Ticks: {ticks_held} | {exit_reason} | "
            f"Bal: ${self.balance:.2f} | WR: {win_rate*100:.1f}%",
            "ORDER"
        )

        self.logger.log_trade(
            trade_id       = trade["trade_id"],
            symbol         = trade["symbol"],
            direction      = trade["direction"],
            entry_price    = trade["entry_price"],
            exit_price     = exit_price,
            pnl            = pnl,
            balance        = self.balance,
            exit_reason    = exit_reason,
            ticks_held     = ticks_held,
            spike_detected = spike_captured
        )

        self.logger.save_session_metrics(
            total_trades = self.total_trades,
            win_rate     = win_rate,
            net_profit   = self.balance - config.INITIAL_BALANCE,
            max_drawdown = self.max_drawdown
        )

        self.active_trade           = None
        self.ticks_since_last_close = 0
