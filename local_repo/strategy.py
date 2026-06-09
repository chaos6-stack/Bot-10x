# strategy.py
"""
Spike Trading Strategy Engine — v4 (2026-06-08)

v4 changes vs v3:
  - OVERDUE zone is no longer an unconditional hard trigger.
    It now uses OVERDUE_SCORE_GATE (default 0.30) as a relaxed threshold.
    Reason: geometric distribution is MEMORYLESS — a spike at tick 1200 is
    no more likely than at tick 400. Unconditional entry was statistically wrong.
  - HOT/OVERDUE entries flag `hot_zone_entry = True` so the trader can apply
    the shorter HOT_ZONE_EXIT_TICKS timeout.
  - RECOVERY counter-spike trades remain disabled (TRADE_AGAINST_SPIKES=False).
  - All other scoring model logic unchanged from v3.
"""

import ml_features
import config


class SpikeStrategy:
    def __init__(self, symbol: str = config.ACTIVE_SYMBOL):
        self.symbol   = symbol.upper()
        self.is_boom  = "BOOM"  in self.symbol
        self.is_crash = "CRASH" in self.symbol
        self.spike_threshold_factor = config.SPIKE_THRESHOLD_FACTOR

        # Cycle counter — start at 50% so we land in BUILDING immediately.
        self.ticks_since_last_spike: int = config.SPIKE_CYCLE_LENGTH // 2
        self.total_spikes_observed:  int = 0

    # ─────────────────────────────────────────────────────────────────────
    #  CYCLE STATE
    # ─────────────────────────────────────────────────────────────────────

    def _compute_cycle_state(self) -> tuple[float, str]:
        """
        Returns (multiplier, zone) based on ticks since last spike.
        multiplier < 1 → RECOVERY   (suppressed)
        multiplier = 1 → BUILDING   (neutral)
        multiplier > 1 → HOT/OVERDUE (elevated)
        """
        cycle_pos = self.ticks_since_last_spike / config.SPIKE_CYCLE_LENGTH
        early     = config.CYCLE_EARLY_ZONE
        hot       = config.CYCLE_HOT_ZONE

        if cycle_pos < early:
            progress   = cycle_pos / early
            multiplier = 0.1 + progress * 0.4          # 0.10 → 0.50
            zone       = "RECOVERY"
        elif cycle_pos < hot:
            progress   = (cycle_pos - early) / (hot - early)
            multiplier = 0.5 + progress * 0.5           # 0.50 → 1.00
            zone       = "BUILDING"
        elif cycle_pos < 1.0:
            progress   = (cycle_pos - hot) / (1.0 - hot)
            multiplier = 1.0 + progress * 0.75          # 1.00 → 1.75
            zone       = "HOT"
        else:
            overage    = min((cycle_pos - 1.0) / 0.5, 1.0)
            multiplier = 1.75 + overage * 0.25          # 1.75 → 2.00
            zone       = "OVERDUE"

        return round(multiplier, 3), zone

    # ─────────────────────────────────────────────────────────────────────
    #  PROBABILITY SCORING MODEL
    # ─────────────────────────────────────────────────────────────────────

    def _compute_spike_probability(
        self, features: dict, down_ticks: int, up_ticks: int
    ) -> tuple[float, float, dict]:
        """
        Weighted composite spike probability (0.0–1.0).

        Component 1 — Cycle timing (WEIGHT_CYCLE = 0.60)
          Cumulative geometric CDF: P = 1-(1-1/N)^k
          NOTE: This is NOT the marginal probability per tick (which is always 1/N).
          It provides a useful monotonically-rising signal but is NOT a calibrated
          spike forecast. The OVERDUE unconditional trigger has been removed because
          geometric distribution is memoryless.

        Component 2 — Volatility compression (WEIGHT_COMPRESSION = 0.20)
          Unproven (audit p=0.169), kept at low weight.

        Component 3 — Directional energy (WEIGHT_ENERGY = 0.20)
          Unproven (audit r_pb=-0.001), kept at low weight.
        """
        k       = self.ticks_since_last_spike
        cycle_p = 1.0 - (1.0 - 1.0 / config.SPIKE_CYCLE_LENGTH) ** k
        cycle_p = min(cycle_p, 1.0)

        comp       = features.get("compression_ratio", 1.0)
        sq_thresh  = config.SQUEEZE_THRESHOLD
        compress_p = max(0.0, (sq_thresh - comp) / sq_thresh)

        if self.is_boom:
            energy_p = min(down_ticks / 10.0, 1.0)
        else:
            energy_p = min(up_ticks / 10.0, 1.0)

        score = (
            config.WEIGHT_CYCLE       * cycle_p     +
            config.WEIGHT_COMPRESSION * compress_p  +
            config.WEIGHT_ENERGY      * energy_p
        )
        score = round(min(score, 1.0), 4)

        cycle_contribution = config.WEIGHT_CYCLE * cycle_p
        confidence         = round(cycle_contribution / (score + 1e-9), 4)
        confidence         = min(confidence, 1.0)

        breakdown = {
            "cycle_p":    round(cycle_p,    4),
            "compress_p": round(compress_p, 4),
            "energy_p":   round(energy_p,   4),
            "score":      score,
            "confidence": confidence,
        }
        return score, confidence, breakdown

    # ─────────────────────────────────────────────────────────────────────
    #  MAIN ANALYSIS
    # ─────────────────────────────────────────────────────────────────────

    def analyze_ticks(self, prices: list[float]) -> tuple[str, dict]:
        """
        Analyzes raw tick buffer. Returns (decision, analytics_dict).
        Decision: "BUY" | "SELL" | "HOLD"
        """
        if len(prices) < config.TICK_WINDOW_SIZE:
            return "HOLD", {"reason": "Warming up tick queue..."}

        features = ml_features.extract_all_features(prices, config.TICK_WINDOW_SIZE)
        features["symbol"] = self.symbol

        # Spike detection
        tick_changes    = [abs(prices[i] - prices[i-1]) for i in range(1, len(prices))]
        avg_tick_change = sum(tick_changes) / len(tick_changes) if tick_changes else 0.0001
        last_change     = prices[-1] - prices[-2]

        is_current_spike = False
        if self.is_boom  and last_change >  avg_tick_change * self.spike_threshold_factor:
            is_current_spike = True
        elif self.is_crash and last_change < -avg_tick_change * self.spike_threshold_factor:
            is_current_spike = True

        features["is_current_spike"] = is_current_spike
        features["avg_tick_change"]  = avg_tick_change
        features["last_change"]      = last_change

        is_squeezed = features["compression_ratio"] < config.SQUEEZE_THRESHOLD
        features["is_squeezed"] = is_squeezed

        recent     = prices[-10:]
        down_ticks = sum(1 for i in range(1, len(recent)) if recent[i] < recent[i-1])
        up_ticks   = len(recent) - 1 - down_ticks
        features["recent_down_ticks"] = down_ticks
        features["recent_up_ticks"]   = up_ticks

        # Cycle counter update
        self.ticks_since_last_spike += 1
        cycle_mult, cycle_zone = self._compute_cycle_state()

        features["ticks_since_spike"] = self.ticks_since_last_spike
        features["cycle_position"]    = round(self.ticks_since_last_spike / config.SPIKE_CYCLE_LENGTH, 3)
        features["cycle_multiplier"]  = cycle_mult
        features["cycle_zone"]        = cycle_zone
        # Flag HOT/OVERDUE entries so trader can use shorter timeout
        features["hot_zone_entry"]    = cycle_zone in ("HOT", "OVERDUE")

        # Lot scale — only applied in HOT/OVERDUE (not BUILDING)
        if config.CYCLE_LOT_SCALING and cycle_mult > 1.0 and cycle_zone in ("HOT", "OVERDUE"):
            lot_scale = round(min(cycle_mult, config.CYCLE_MAX_LOT_SCALE), 3)
        else:
            lot_scale = 1.0
        features["cycle_lot_scale"] = lot_scale

        # Spike on this tick → reset cycle, do not enter trade
        if is_current_spike:
            self.ticks_since_last_spike = 0
            self.total_spikes_observed += 1
            features["decision_reason"]       = (
                f"Spike detected! Counter reset. "
                f"Total spikes observed: {self.total_spikes_observed}"
            )
            features["spike_probability_pct"] = 0.0
            features["confidence_score"]      = 0.0
            features["entry_score"]           = 0.0
            return "HOLD", features

        # Compute probability score
        score, confidence, breakdown = self._compute_spike_probability(features, down_ticks, up_ticks)

        features["spike_probability_pct"] = round(score * 100, 1)
        features["confidence_score"]      = round(confidence * 100, 1)
        features["entry_score"]           = score
        features["score_breakdown"]       = breakdown

        trade_mode = getattr(config, "TRADE_MODE", "WITH_SPIKES")
        want_counter = trade_mode in ("AGAINST_SPIKES", "BOTH")
        want_with    = trade_mode in ("WITH_SPIKES",    "BOTH")

        # ── RECOVERY ZONE ─────────────────────────────────────────────────────
        if cycle_zone == "RECOVERY":
            if want_counter:
                rsi_val = features.get("rsi", 50.0)
                slope   = features.get("ema_slope", 0.0)
                safe    = True
                reason  = ""
                if is_squeezed:
                    safe = False; reason = "squeeze detected"
                elif self.is_boom:
                    if slope > 0.0:      safe = False; reason = f"upward slope ({slope:.4f})"
                    elif rsi_val < 42.0: safe = False; reason = f"RSI oversold ({rsi_val:.1f})"
                elif self.is_crash:
                    if slope < 0.0:      safe = False; reason = f"downward slope ({slope:.4f})"
                    elif rsi_val > 58.0: safe = False; reason = f"RSI overbought ({rsi_val:.1f})"
                if safe:
                    features["is_counter_spike"]  = True
                    features["decision_reason"]   = (
                        f"COUNTER-SPIKE — RECOVERY zone drift | "
                        f"mode={trade_mode} | tick {self.ticks_since_last_spike}"
                    )
                    return "SELL" if self.is_boom else "BUY", features
                else:
                    features["is_counter_spike"] = False
                    features["decision_reason"]  = f"RECOVERY blocked: {reason}"
                    return "HOLD", features
            else:
                features["is_counter_spike"] = False
                features["decision_reason"]  = (
                    f"RECOVERY zone — {self.ticks_since_last_spike} ticks since spike "
                    f"(counter trades OFF)"
                )
                return "HOLD", features
        else:
            features["is_counter_spike"] = False

        # ── WITH-SPIKE modes blocked when AGAINST_SPIKES only ─────────────────
        if not want_with:
            features["decision_reason"] = (
                f"WITH_SPIKE entries disabled (mode={trade_mode}) | "
                f"Waiting for next spike to trade recovery drift."
            )
            return "HOLD", features

        # ── OVERDUE ZONE (v4: score-gated, not unconditional) ─────────────────
        if cycle_zone == "OVERDUE":
            gate = getattr(config, "OVERDUE_SCORE_GATE", 0.30)
            if score >= gate:
                direction = "BUY" if self.is_boom else "SELL"
                features["decision_reason"] = (
                    f"CYCLE OVERDUE — score {score*100:.1f}% ≥ gate {gate*100:.0f}% | "
                    f"Cycle_p {breakdown['cycle_p']*100:.1f}% | Conf {confidence*100:.0f}%"
                )
                return direction, features
            else:
                features["decision_reason"] = (
                    f"CYCLE OVERDUE — score {score*100:.1f}% below gate {gate*100:.0f}% | HOLD"
                )
                return "HOLD", features

        # ── BUILDING / HOT: score threshold ───────────────────────────────────
        if score >= config.ENTRY_SCORE_THRESHOLD:
            direction = "BUY" if self.is_boom else "SELL"
            features["decision_reason"] = (
                f"Score {score*100:.1f}% ≥ {config.ENTRY_SCORE_THRESHOLD*100:.0f}% | "
                f"Cycle {self.ticks_since_last_spike}tk ({breakdown['cycle_p']*100:.1f}%) "
                f"[{cycle_zone}] Conf {confidence*100:.0f}%"
            )
            return direction, features

        features["decision_reason"] = (
            f"Score {score*100:.1f}% < {config.ENTRY_SCORE_THRESHOLD*100:.0f}% | "
            f"Cycle {self.ticks_since_last_spike}tk [{cycle_zone}]"
        )
        return "HOLD", features
