// src/types.ts

export interface StrategyConfig {
  ACTIVE_SYMBOL: string;
  BOOM_EXIT_TICKS: number;
  CRASH_EXIT_TICKS: number;
  STOP_LOSS_POINTS: number;
  TAKE_PROFIT_POINTS: number;
  SPIKE_THRESHOLD_FACTOR: number;
  RSI_OVERSOLD: number;
  RSI_OVERBOUGHT: number;
  SQUEEZE_THRESHOLD: number;
  ZSCORE_ENTRY: number;
  ENTRY_SCORE_THRESHOLD: number;
  WEIGHT_CYCLE: number;
  WEIGHT_COMPRESSION: number;
  WEIGHT_ENERGY: number;
  SPIKE_CYCLE_LENGTH: number;
  CYCLE_EARLY_ZONE: number;
  CYCLE_HOT_ZONE: number;
  CYCLE_MAX_LOT_SCALE: number;
  CYCLE_LOT_SCALING: boolean;
  POST_TRADE_COOLDOWN_TICKS: number;
  MAX_DAILY_LOSS: number;
  MAX_TRADES_PER_SESSION: number;
  COOLDOWN_AFTER_LOSS_STREAK: number;
  COOLDOWN_MINUTES: number;
  MAX_DRAWDOWN_PCT: number;
  DEFAULT_LOT_SIZE: number;
  MIN_LOT_SIZE: number;
  INITIAL_BALANCE: number;
  MARTINGALE_ACTIVE: boolean;
  MARTINGALE_FACTOR: number;
  MARTINGALE_MAX_MULTIPLIER: number;
  TRADE_MODE: "WITH_SPIKES" | "AGAINST_SPIKES" | "BOTH";
  TRADE_AGAINST_SPIKES: boolean;
  ANTI_SPIKE_LOT_SIZE: number;
  COUNTER_SPIKE_TP_POINTS: number;
  COUNTER_SPIKE_SL_POINTS: number;
  COUNTER_SPIKE_HOLD_TICKS: number;
  FORCE_LIVE_WS?: boolean;
}

export interface TradeRecord {
  trade_id: string;
  symbol: string;
  direction: "BUY" | "SELL";
  entry_price: number;
  exit_price: number;
  pnl: number;
  balance: number;
  exit_reason: string;
  ticks_held: number;
  spike_detected: boolean;
  lot_size?: number;
  cycle_zone?: string;
}

export interface SessionMetrics {
  total_trades: number;
  win_rate: number;
  net_profit: number;
  max_drawdown: number;
}

export interface OptimizationReport {
  symbol: string;
  score: number;
  params: Record<string, any>;
  report: {
    total_trades?: number;
    win_rate?: number;
    net_profit?: number;
    profit_factor?: number;
    max_drawdown?: number;
    avg_ticks_held?: number;
    timeout_ratio?: number;
    spike_capture_ratio?: number;
    loss_streak?: number;
    score?: number;
  };
  stage1_best: number;
  stage2_best: number;
}
