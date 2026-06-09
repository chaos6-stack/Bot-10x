// ProbabilityChart.tsx
// Live spike-probability time-series chart.
// Shows one coloured line per symbol (up to 4) from the tick history.
// Threshold lines for entry threshold and overdue gate are drawn as dashed overlays.

import React, { useMemo } from "react";

interface TickRecord {
  spike_probability_pct: number;
  cycle_zone?: string;
  is_spike?: boolean;
  timestamp?: number;
}

interface SymbolData {
  ticks: TickRecord[];
  cycle_zone?: string;
  spike_probability_pct?: number;
  last_price?: number;
}

interface ProbabilityChartProps {
  // Single-symbol mode
  ticks?: TickRecord[];
  symbol?: string;
  // Multi-symbol mode
  perSymbol?: Record<string, SymbolData>;
  mode?: "single" | "multi";
  // Thresholds (from config, as %)
  entryThresholdPct?: number;   // default 57
  overdueGatePct?: number;      // default 30
  height?: number;
}

const SYMBOL_COLORS: Record<string, { line: string; glow: string; label: string; badge: string }> = {
  BOOM1000:  { line: "#10b981", glow: "rgba(16,185,129,0.15)", label: "text-emerald-400", badge: "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" },
  CRASH1000: { line: "#f43f5e", glow: "rgba(244,63,94,0.15)",  label: "text-rose-400",    badge: "bg-rose-500/20 border-rose-500/40 text-rose-300" },
  BOOM500:   { line: "#f59e0b", glow: "rgba(245,158,11,0.15)", label: "text-amber-400",   badge: "bg-amber-500/20 border-amber-500/40 text-amber-300" },
  CRASH500:  { line: "#38bdf8", glow: "rgba(56,189,248,0.15)", label: "text-sky-400",     badge: "bg-sky-500/20 border-sky-500/40 text-sky-300" },
};
const DEFAULT_COLOR = { line: "#94a3b8", glow: "rgba(148,163,184,0.1)", label: "text-slate-400", badge: "bg-slate-700/40 border-slate-600 text-slate-300" };

function getColor(sym: string) {
  return SYMBOL_COLORS[sym.toUpperCase()] ?? DEFAULT_COLOR;
}

function buildPath(values: number[], w: number, h: number, maxY: number): string {
  if (values.length < 2) return "";
  const pad = 4;
  const gw = w - pad * 2;
  const gh = h - pad * 2;
  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * gw;
    const y = pad + (1 - v / maxY) * gh;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return "M" + points.join("L");
}

function buildAreaPath(values: number[], w: number, h: number, maxY: number): string {
  if (values.length < 2) return "";
  const pad = 4;
  const gw = w - pad * 2;
  const gh = h - pad * 2;
  const top = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * gw;
    const y = pad + (1 - v / maxY) * gh;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const firstX = pad;
  const lastX  = pad + gw;
  const baseY  = pad + gh;
  return `M${firstX},${baseY}L` + top.join("L") + `L${lastX},${baseY}Z`;
}

function yPx(pct: number, h: number, maxY: number): number {
  const pad = 4;
  return pad + (1 - pct / maxY) * (h - pad * 2);
}

export default function ProbabilityChart({
  ticks,
  symbol,
  perSymbol,
  mode = "single",
  entryThresholdPct = 57,
  overdueGatePct    = 30,
  height            = 120,
}: ProbabilityChartProps) {
  const W = 100; // viewBox units — SVG scales automatically

  // Resolve datasets: { sym → number[] }
  const datasets = useMemo<Record<string, number[]>>(() => {
    if (mode === "multi" && perSymbol) {
      const result: Record<string, number[]> = {};
      for (const [sym, data] of Object.entries(perSymbol)) {
        const vals = (data.ticks ?? [])
          .map((t: TickRecord) => t.spike_probability_pct ?? 0)
          .filter((v: number) => v >= 0);
        if (vals.length > 1) result[sym] = vals;
      }
      return result;
    }
    // Single
    if (ticks && ticks.length > 1) {
      const sym = symbol ?? "SYMBOL";
      return { [sym]: ticks.map(t => t.spike_probability_pct ?? 0) };
    }
    return {};
  }, [mode, perSymbol, ticks, symbol]);

  const symbols = Object.keys(datasets);
  const maxY    = 100;
  const hasData = symbols.length > 0 && symbols.some(s => datasets[s].length > 1);

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-full text-[10px] font-mono text-slate-600">
        Waiting for tick data...
      </div>
    );
  }

  const entryY  = yPx(entryThresholdPct, height, maxY);
  const overdueY = yPx(overdueGatePct,  height, maxY);

  return (
    <div className="relative w-full" style={{ height }}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
      >
        <defs>
          {symbols.map(sym => {
            const c = getColor(sym);
            return (
              <linearGradient key={sym} id={`prob-area-${sym}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={c.line} stopOpacity="0.18" />
                <stop offset="100%" stopColor={c.line} stopOpacity="0.0" />
              </linearGradient>
            );
          })}
        </defs>

        {/* Grid lines — subtle */}
        {[0, 25, 50, 75, 100].map(pct => {
          const y = yPx(pct, height, maxY);
          return (
            <line key={pct} x1="4" y1={y} x2={W - 4} y2={y}
              stroke="#1e293b" strokeWidth="0.4" />
          );
        })}

        {/* OVERDUE gate threshold (purple dashed) */}
        <line x1="4" y1={overdueY} x2={W - 4} y2={overdueY}
          stroke="#a855f7" strokeWidth="0.6" strokeDasharray="1.5,1.5" opacity="0.6" />

        {/* Entry score threshold (amber dashed) */}
        <line x1="4" y1={entryY} x2={W - 4} y2={entryY}
          stroke="#f59e0b" strokeWidth="0.6" strokeDasharray="1.5,1.5" opacity="0.7" />

        {/* Area fills (behind lines) */}
        {symbols.map(sym => {
          const vals = datasets[sym];
          const c    = getColor(sym);
          const area = buildAreaPath(vals, W, height, maxY);
          return (
            <path key={`area-${sym}`} d={area}
              fill={`url(#prob-area-${sym})`} />
          );
        })}

        {/* Probability lines */}
        {symbols.map(sym => {
          const vals = datasets[sym];
          const c    = getColor(sym);
          const d    = buildPath(vals, W, height, maxY);
          return (
            <path key={`line-${sym}`} d={d}
              fill="none" stroke={c.line} strokeWidth="0.9"
              strokeLinejoin="round" strokeLinecap="round" />
          );
        })}

        {/* Spike markers (vertical tick marks) */}
        {symbols.slice(0, 1).map(sym => {
          const tickArr = mode === "multi"
            ? (perSymbol?.[sym]?.ticks ?? [])
            : (ticks ?? []);
          const c = getColor(sym);
          const pad = 4;
          const gw  = W - pad * 2;
          return tickArr.map((t, i) =>
            t.is_spike ? (
              <line key={`spike-${sym}-${i}`}
                x1={pad + (i / Math.max(tickArr.length - 1, 1)) * gw}
                y1={pad}
                x2={pad + (i / Math.max(tickArr.length - 1, 1)) * gw}
                y2={height - pad}
                stroke={c.line} strokeWidth="0.5" opacity="0.5" />
            ) : null
          );
        })}
      </svg>

      {/* Y-axis labels (absolute positioned) */}
      <div className="absolute left-0 top-0 h-full flex flex-col justify-between pointer-events-none py-1 pl-1">
        {[100, 75, 50, 25, 0].map(pct => (
          <span key={pct} className="text-[7px] font-mono text-slate-700 leading-none">{pct}%</span>
        ))}
      </div>

      {/* Threshold labels (right side) */}
      <div className="absolute right-1 pointer-events-none" style={{ top: entryY - 6 }}>
        <span className="text-[7px] font-mono text-amber-500/80 leading-none">entry {entryThresholdPct}%</span>
      </div>
      <div className="absolute right-1 pointer-events-none" style={{ top: overdueY - 6 }}>
        <span className="text-[7px] font-mono text-purple-500/80 leading-none">gate {overdueGatePct}%</span>
      </div>
    </div>
  );
}
