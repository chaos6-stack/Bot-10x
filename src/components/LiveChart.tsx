import React, { useState, useRef, useEffect } from "react";
import { Activity, Flame, DollarSign, AlertCircle, Sparkles, LineChart as ChartIcon, BarChart2, Trash2 } from "lucide-react";

interface Tick {
  price: number;
  timestamp: number;
  rsi: number;
  compression_ratio: number;
  cycle_zone: string;
  is_spike: boolean;
}

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  rsi_open: number;
  rsi_high: number;
  rsi_low: number;
  rsi_close: number;
  is_spike: boolean;
  cycle_zone: string;
}

interface ActiveTrade {
  trade_id: string;
  direction: string;
  entry_price: number;
  lot_size: number;
  ticks_held: number;
  pnl: number;
}

interface LiveChartProps {
  liveData: {
    symbol: string;
    ticks: Tick[];
    candles?: Candle[];
    active_trade: ActiveTrade | null;
    balance: number;
    is_fallback?: boolean;
  };
  botStatus: string;
  stopLossPoints?: number;
  takeProfitPoints?: number;
}

interface DrawLine {
  id: string;
  type: "trendline" | "horizontal";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

export default function LiveChart({
  liveData,
  botStatus,
  stopLossPoints = 1.5,
  takeProfitPoints = 20.0,
}: LiveChartProps) {
  const [chartMode, setChartMode] = useState<"1m" | "ticks">("1m");

  // ── DRAWING TOOL STATES ──
  const [drawingMode, setDrawingMode] = useState<"trendline" | "horizontal" | null>(null);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [drawings, setDrawings] = useState<DrawLine[]>([]);
  const [lineColor, setLineColor] = useState<string>("#10b981"); // Default Emerald (Theme Accent)

  const svgRef = useRef<SVGSVGElement | null>(null);

  // Keyboard listener to cancel drawing on Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawingMode(null);
        setStartPoint(null);
        setHoverPoint(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const ticks = liveData.ticks || [];
  const candles = liveData.candles || [];
  const symbol = liveData.symbol || "BOOM1000";
  const activeTrade = liveData.active_trade;
  const isFallback = liveData.is_fallback;

  const isBoom = symbol.toUpperCase().includes("BOOM");
  const hasCandles = candles && candles.length >= 2;
  const finalMode = (chartMode === "1m" && hasCandles) ? "1m" : "ticks";

  if (ticks.length < 5) {
    return (
      <div className="bg-slate-950 border border-slate-900 rounded-xl p-6 h-[300px] flex flex-col items-center justify-center text-center relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(16,185,129,0.04),rgba(255,255,255,0))]" />
        <Activity className="h-7 w-7 text-emerald-500 animate-pulse mb-3" />
        <span className="text-2xs font-mono text-emerald-400 capitalize bg-emerald-950/20 border border-emerald-900/30 px-2 py-0.5 rounded-full mb-2 tracking-widest">
          {botStatus === "running" ? "STREAM INITIALIZING" : "BOT IDLE"}
        </span>
        <span className="text-xs font-mono text-slate-400 font-bold">
          {botStatus === "running" ? "Subscribed to Deriv WebSocket Feed" : "No Live Market Feed Connected"}
        </span>
        <p className="text-[10px] text-slate-500 mt-1 max-w-sm leading-relaxed">
          {botStatus === "running"
            ? "Waiting for incoming ticker records (warming up technical indicators, please allow 10-15 seconds for pipeline to populate)."
            : "Activate the Streaming Agent above to spin up the Deriv price feed and view tick dynamics in real-time."}
        </p>
      </div>
    );
  }

  // Common Viewport Dimensions
  const svgWidth = 1000;
  const priceChartHeight = 200;
  const rsiChartHeight = 50;
  const totalChartHeight = 270;

  // Range and scaling math depends on mode
  let minPrice = 0;
  let maxPrice = 0;
  let chartMin = 0;
  let chartMax = 0;
  let chartRange = 1;

  let getPriceY = (price: number) => 0;
  let getX = (idx: number) => 0;
  let smaPointsStr = "";
  let pointsStr = "";
  let fillPointsStr = "";
  let rsiPointsStr = "";
  let latestPrice = 0;
  let latestRsi = 50;
  let latestZone = "UNKNOWN";

  if (finalMode === "1m") {
    // 1-Minute Candlestick Chart Math (OHLC scaling)
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    minPrice = Math.min(...lows);
    maxPrice = Math.max(...highs);
    const rawRange = maxPrice - minPrice;
    const padding = rawRange === 0 ? 1 : rawRange * 0.15;
    chartMin = minPrice - padding;
    chartMax = maxPrice + padding;
    chartRange = chartMax - chartMin;

    getPriceY = (price: number) => {
      return priceChartHeight - ((price - chartMin) / (chartRange || 1)) * (priceChartHeight - 40) - 20;
    };

    getX = (idx: number) => {
      if (candles.length <= 1) return 500;
      return 40 + (idx / (candles.length - 1)) * (svgWidth - 110);
    };

    // Golden 10-Min Simple Moving Average on Close Prices
    const smaPeriod = 10;
    const smaPoints: Array<{ x: number; y: number }> = [];
    for (let i = smaPeriod - 1; i < candles.length; i++) {
      const sum = candles.slice(i - smaPeriod + 1, i + 1).reduce((acc, c) => acc + c.close, 0);
      const avg = sum / smaPeriod;
      smaPoints.push({ x: getX(i), y: getPriceY(avg) });
    }
    smaPointsStr = smaPoints.map((p) => `${p.x},${p.y}`).join(" ");

    // RSI mathematical bounds scale
    const getRsiY = (rsi: number) => {
      return 265 - (rsi / 100) * rsiChartHeight;
    };
    rsiPointsStr = candles.map((c, idx) => `${getX(idx)},${getRsiY(c.rsi_close ?? 50)}`).join(" ");

    const latestCandle = candles[candles.length - 1];
    latestPrice = latestCandle.close;
    latestRsi = latestCandle.rsi_close;
    latestZone = latestCandle.cycle_zone;
  } else {
    // Tick Stream Line Chart Math
    const prices = ticks.map((t) => t.price);
    minPrice = Math.min(...prices);
    maxPrice = Math.max(...prices);
    const rawRange = maxPrice - minPrice;
    const padding = rawRange === 0 ? 1 : rawRange * 0.15;
    chartMin = minPrice - padding;
    chartMax = maxPrice + padding;
    chartRange = chartMax - chartMin;

    getPriceY = (price: number) => {
      return priceChartHeight - ((price - chartMin) / (chartRange || 1)) * (priceChartHeight - 40) - 20;
    };

    getX = (idx: number) => {
      if (ticks.length <= 1) return 500;
      return 40 + (idx / (ticks.length - 1)) * (svgWidth - 110);
    };

    // Golden 10-Tick Simple Moving Average on Tick Stream
    const smaPeriod = 10;
    const smaPoints: Array<{ x: number; y: number }> = [];
    for (let i = smaPeriod - 1; i < ticks.length; i++) {
      const sum = prices.slice(i - smaPeriod + 1, i + 1).reduce((a, b) => a + b, 0);
      const avg = sum / smaPeriod;
      smaPoints.push({ x: getX(i), y: getPriceY(avg) });
    }
    smaPointsStr = smaPoints.map((p) => `${p.x},${p.y}`).join(" ");

    pointsStr = ticks.map((t, idx) => `${getX(idx)},${getPriceY(t.price)}`).join(" ");
    fillPointsStr = `${getX(0)},${priceChartHeight - 5} ` + pointsStr + ` ${getX(ticks.length - 1)},${priceChartHeight - 5}`;

    // RSI mathematical bounds scale
    const getRsiY = (rsi: number) => {
      return 265 - (rsi / 100) * rsiChartHeight;
    };
    rsiPointsStr = ticks.map((t, idx) => `${getX(idx)},${getRsiY(t.rsi ?? 50)}`).join(" ");

    const latestTick = ticks[ticks.length - 1];
    latestPrice = latestTick.price;
    latestRsi = latestTick.rsi;
    latestZone = latestTick.cycle_zone;
  }

  // Draw 5 horizontal gridlines
  const gridLevelsCount = 5;
  const gridLines: number[] = [];
  for (let i = 0; i < gridLevelsCount; i++) {
    const val = chartMin + (i * chartRange) / (gridLevelsCount - 1);
    gridLines.push(val);
  }

  const latestY = getPriceY(latestPrice);
  const latestX = getX(finalMode === "1m" ? candles.length - 1 : ticks.length - 1);

  // Active Trade Levels overlay bounds scale
  let entryY = 0;
  let tpY = 0;
  let slY = 0;
  let tpPrice = 0;
  let slPrice = 0;

  if (activeTrade) {
    const isBuy = activeTrade.direction === "BUY";
    entryY = getPriceY(activeTrade.entry_price);
    
    tpPrice = isBuy 
      ? activeTrade.entry_price + takeProfitPoints 
      : activeTrade.entry_price - takeProfitPoints;
      
    slPrice = isBuy 
      ? activeTrade.entry_price - stopLossPoints 
      : activeTrade.entry_price + stopLossPoints;

    tpY = getPriceY(tpPrice);
    slY = getPriceY(slPrice);
  }

  const chartThemeColor = isBoom ? "#10b981" : "#f43f5e"; // Emerald vs Rose
  const chartGlowFilter = isBoom ? "url(#glow-emerald)" : "url(#glow-rose)";

  // Scale widths nicely based on candle array count
  const candleMaxSpanWidth = Math.max(2.5, Math.min(10, ((svgWidth - 110) / candles.length) * 0.65));

  const getRsiY = (rsi: number) => {
    return 265 - (rsi / 100) * rsiChartHeight;
  };

  // ── DRAWING COORDINATE AND EVENT HANDLERS ──
  const getSVGCoords = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * svgWidth;
    const y = ((e.clientY - rect.top) / rect.height) * totalChartHeight;
    return { x, y };
  };

  const handleSVGClick = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (!drawingMode) return;

    const coords = getSVGCoords(e);
    if (!coords) return;

    if (drawingMode === "horizontal") {
      const newLine: DrawLine = {
        id: Math.random().toString(36).substr(2, 9),
        type: "horizontal",
        x1: 40,
        y1: coords.y,
        x2: svgWidth - 70,
        y2: coords.y,
        color: lineColor,
      };
      setDrawings((prev) => [...prev, newLine]);
      setDrawingMode(null);
      setHoverPoint(null);
    } else if (drawingMode === "trendline") {
      if (!startPoint) {
        setStartPoint(coords);
        setHoverPoint(coords);
      } else {
        const newLine: DrawLine = {
          id: Math.random().toString(36).substr(2, 9),
          type: "trendline",
          x1: startPoint.x,
          y1: startPoint.y,
          x2: coords.x,
          y2: coords.y,
          color: lineColor,
        };
        setDrawings((prev) => [...prev, newLine]);
        setStartPoint(null);
        setHoverPoint(null);
        setDrawingMode(null);
      }
    }
  };

  const handleSVGMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (!drawingMode) return;

    const coords = getSVGCoords(e);
    if (!coords) return;

    if (drawingMode === "horizontal") {
      setHoverPoint({ x: coords.x, y: coords.y });
    } else if (drawingMode === "trendline" && startPoint) {
      setHoverPoint(coords);
    }
  };

  return (
    <div className="bg-slate-950 border border-slate-900 rounded-xl p-4 flex flex-col space-y-3 relative overflow-hidden shadow-2xl">
      {/* Visual background accents */}
      <div className="absolute inset-0 bg-transparent opacity-5 animate-pulse" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
      <div className={`absolute -right-24 -top-24 w-48 h-48 rounded-full filter blur-[100px] opacity-10 ${isBoom ? "bg-emerald-500" : "bg-rose-500"}`} />

      {/* Chart Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 z-10 border-b border-slate-900 pb-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`w-2 h-2 rounded-full ${isFallback ? "bg-amber-500 animate-pulse" : "bg-emerald-500 animate-ping"}`} />
            <span className="font-mono text-xs font-bold text-slate-100 flex items-center gap-1.5">
              {symbol}
            </span>
            <span className={`text-[9.5px] px-2 py-0.5 rounded font-bold font-mono tracking-wider ${
              isFallback 
                ? "bg-amber-950/40 text-amber-400 border border-amber-900/40" 
                : "bg-emerald-950/40 text-emerald-400 border border-emerald-900/40"
            }`}>
              {isFallback ? "⚠️ OFFLINE SIMULATION FEED" : "● LIVE WS CHANNEL"}
            </span>
          </div>

          {/* Timeframe Toggles */}
          <div className="flex items-center gap-1 bg-slate-900/80 border border-slate-850 rounded-lg p-0.5 pointer-events-auto">
            <button
              onClick={() => setChartMode("1m")}
              className={`px-2.5 py-0.5 rounded font-mono text-[9px] font-bold transition-all flex items-center gap-1 cursor-pointer ${
                finalMode === "1m"
                  ? "bg-slate-800 text-slate-100 shadow-md border border-slate-700/60"
                  : "text-slate-500 hover:text-slate-350 border border-transparent"
              }`}
            >
              <BarChart2 className="w-3 h-3" />
              1M OHLC
            </button>
            <button
              onClick={() => setChartMode("ticks")}
              className={`px-2.5 py-0.5 rounded font-mono text-[9px] font-bold transition-all flex items-center gap-1 cursor-pointer ${
                finalMode === "ticks"
                  ? "bg-slate-800 text-slate-100 shadow-md border border-slate-700/60"
                  : "text-slate-500 hover:text-slate-350 border border-transparent"
              }`}
            >
              <ChartIcon className="w-3 h-3" />
              Ticks Stream
            </button>
          </div>
        </div>

        {/* Floating Indicator Status */}
        <div className="flex items-center gap-2 max-sm:w-full max-sm:justify-between">
          <div className="text-[10px] font-mono text-slate-400 bg-slate-900/45 px-2 py-0.5 rounded border border-slate-850 flex items-center gap-1">
            <span className="text-slate-500">{finalMode === "1m" ? "OHLC Close:" : "Price:"}</span>
            <span className={isBoom ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
              {latestPrice.toFixed(3)}
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-400 bg-slate-900/45 px-2 py-0.5 rounded border border-slate-850 flex items-center gap-1">
            <span className="text-slate-500">RSI(14):</span>
            <span className="text-purple-400 font-bold">
              {latestRsi ? latestRsi.toFixed(1) : "50.0"}
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-400 bg-slate-900/45 px-2 py-0.5 rounded border border-slate-850 flex items-center gap-1">
            <span className="text-slate-500">Zone:</span>
            <span className="text-sky-400 font-bold">
              {latestZone || "UNKNOWN"}
            </span>
          </div>
        </div>
      </div>

      {/* Analyst Drawing Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/30 border border-slate-900/60 rounded-xl p-2 px-3 z-10">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-mono text-slate-400 font-bold tracking-wider flex items-center gap-1.5 uppercase">
            <Sparkles className="w-3.5 h-3.5 text-yellow-500 animate-pulse" />
            Drawing Tools:
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setDrawingMode(drawingMode === "trendline" ? null : "trendline");
                setStartPoint(null);
              }}
              className={`px-2.5 py-1 rounded font-mono text-[9px] font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                drawingMode === "trendline"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.15)]"
                  : "text-slate-400 hover:text-slate-200 bg-slate-950/40 border-slate-900 hover:border-slate-800"
              }`}
              title="Click two points to draw a customized manual trendline"
            >
              <Activity className="w-3 h-3" />
              Trendline
            </button>
            <button
              onClick={() => {
                setDrawingMode(drawingMode === "horizontal" ? null : "horizontal");
                setStartPoint(null);
              }}
              className={`px-2.5 py-1 rounded font-mono text-[9px] font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                drawingMode === "horizontal"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.15)]"
                  : "text-slate-400 hover:text-slate-200 bg-slate-950/40 border-slate-900 hover:border-slate-800"
              }`}
              title="Click anywhere to draw an infinite horizontal level of support/resistance"
            >
              <div className="w-3 h-0.5 bg-current rounded-sm" />
              Horizontal Level
            </button>
          </div>
        </div>

        {/* Dynamic User Instruction Prompt Helper */}
        {drawingMode && (
          <div className="text-[9.5px] text-amber-400 font-mono animate-[pulse_1.5s_infinite] flex items-center gap-1.5 bg-amber-955/20 px-2.5 py-1 rounded-lg border border-amber-900/30 shadow-inner">
            <AlertCircle className="w-3 h-3 text-amber-500" />
            <span>
              {drawingMode === "trendline"
                ? !startPoint
                  ? "Click on chart to place Point A..."
                  : "Move cursor and click again to set Point B"
                : "Tap anywhere on main chart/RSI to place horizontal level reference line..."}
            </span>
            <button
              onClick={() => {
                setDrawingMode(null);
                setStartPoint(null);
                setHoverPoint(null);
              }}
              className="text-amber-500 hover:text-amber-300 underline font-semibold ml-1 cursor-pointer transition-colors"
            >
              Cancel (Esc)
            </button>
          </div>
        )}

        {/* Action controls & color selection palette */}
        <div className="flex items-center gap-3">
          {/* Palette Selector */}
          <div className="flex items-center gap-1.5 pr-3 border-r border-slate-900">
            {["#10b981", "#a78bfa", "#f59e0b", "#3b82f6"].map((color) => (
              <button
                key={color}
                onClick={() => setLineColor(color)}
                className={`w-4 h-4 rounded-full border transition-all cursor-pointer relative flex items-center justify-center ${
                  lineColor === color
                    ? "border-slate-200 scale-115 shadow-md ring-1 ring-slate-800"
                    : "border-transparent scale-90 opacity-40 hover:opacity-100 hover:scale-100"
                }`}
                style={{ backgroundColor: color }}
                title={`Change active style color to ${color}`}
              >
                {lineColor === color && (
                  <div className="w-1.5 h-1.5 bg-slate-950 rounded-full" />
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setDrawings((prev) => prev.slice(0, -1))}
              disabled={drawings.length === 0}
              className={`px-2.5 py-1 rounded font-mono text-[9px] font-bold transition-all border ${
                drawings.length > 0
                  ? "text-slate-300 hover:text-slate-100 bg-slate-950/60 border-slate-900 hover:border-slate-800 cursor-pointer"
                  : "text-slate-600 border-transparent opacity-40 cursor-not-allowed"
              }`}
              title="Remove last drawn trendline"
            >
              Undo
            </button>
            <button
              onClick={() => setDrawings([])}
              disabled={drawings.length === 0}
              className={`px-2.5 py-1 rounded font-mono text-[9px] font-bold transition-all border flex items-center gap-1 ${
                drawings.length > 0
                  ? "text-rose-400 hover:text-rose-350 bg-rose-950/10 border-rose-950/30 hover:bg-rose-950/20 cursor-pointer"
                  : "text-slate-600 border-transparent opacity-40 cursor-not-allowed"
              }`}
              title="Clear all manual support, resistance, and trendlines"
            >
              <Trash2 className="w-3 h-3" />
              Clear Drawings ({drawings.length})
            </button>
          </div>
        </div>
      </div>

      {/* SVG Canvas Container */}
      <div className="relative flex-1 select-none">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgWidth} ${totalChartHeight}`}
          className={`w-full h-full text-slate-850 font-mono transition-all overflow-visible ${
            drawingMode ? "cursor-crosshair bg-slate-900/10" : ""
          }`}
          onClick={handleSVGClick}
          onMouseMove={handleSVGMouseMove}
        >
          {/* DEFINITIONS & FILTER GLOWS */}
          <defs>
            <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={chartThemeColor} stopOpacity="0.14" />
              <stop offset="100%" stopColor={chartThemeColor} stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="rsi-area-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.0" />
            </linearGradient>
            <filter id="glow-emerald" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <filter id="glow-rose" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* BACKGROUND WATERMARK */}
          <text
            x="48%"
            y="95"
            textAnchor="middle"
            className="font-bold text-[48px] fill-slate-900/40 opacity-30 select-none pointer-events-none tracking-widest uppercase font-sans"
          >
            {symbol}
          </text>
          <text
            x="48%"
            y="125"
            textAnchor="middle"
            className="text-[10px] fill-slate-700 select-none pointer-events-none font-mono tracking-widest opacity-40"
          >
            {finalMode === "1m" ? "1-MINUTE CANDLESTICK TIMEFRAME" : "REAL-TIME SECOND-BY-SECOND STREAM"}
          </text>

          {/* MAIN PRICE HORIZONTAL GRIDLINES */}
          {gridLines.map((val, idx) => (
            <g key={idx}>
              <line
                x1="40"
                y1={getPriceY(val)}
                x2={svgWidth - 70}
                y2={getPriceY(val)}
                className="stroke-slate-900/60"
                strokeDasharray="2 3"
              />
              <text
                x={svgWidth - 65}
                y={getPriceY(val) + 3}
                className="fill-slate-600 text-[9px] text-right font-mono"
              >
                {val.toFixed(2)}
              </text>
            </g>
          ))}

          {/* DYNAMIC PRICE DATA STRUCTURES */}
          {finalMode === "ticks" ? (
            <>
              {/* GRADIENT SHADED FIELD AREA */}
              <polygon points={fillPointsStr} fill="url(#area-gradient)" />

              {/* MAIN PRICE TICKS WAVEFORM */}
              <polyline
                points={pointsStr}
                fill="none"
                stroke={chartThemeColor}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter={chartGlowFilter}
                className="transition-all duration-350"
              />
            </>
          ) : (
            <>
              {/* CANDLESTICKS BODY AND WICK RENDERING */}
              {candles.map((c, idx) => {
                const x = getX(idx);
                const yOpen = getPriceY(c.open);
                const yClose = getPriceY(c.close);
                const yHigh = getPriceY(c.high);
                const yLow = getPriceY(c.low);
                
                const isBullish = c.close >= c.open;
                const candleColor = isBullish ? "#10b981" : "#f43f5e";
                
                const topY = Math.min(yOpen, yClose);
                const bottomY = Math.max(yOpen, yClose);
                const bodyHeight = Math.max(1.5, bottomY - topY);

                return (
                  <g key={idx} className="transition-all duration-200">
                    {/* Shadow wick line */}
                    <line
                      x1={x}
                      y1={yHigh}
                      x2={x}
                      y2={yLow}
                      stroke={candleColor}
                      strokeWidth="1.2"
                      opacity="0.8"
                    />
                    {/* Candle bar card rect */}
                    <rect
                      x={x - candleMaxSpanWidth / 2}
                      y={topY}
                      width={candleMaxSpanWidth}
                      height={bodyHeight}
                      fill={isBullish ? "transparent" : candleColor}
                      stroke={candleColor}
                      strokeWidth="1.2"
                      rx="1"
                    />
                  </g>
                );
              })}
            </>
          )}

          {/* THE GOLDEN 10-PERIOD MOVING AVERAGE */}
          {smaPointsStr && (
            <polyline
              points={smaPointsStr}
              fill="none"
              stroke="#fbbf24"
              strokeWidth="1.5"
              strokeDasharray="4 2"
              opacity="0.75"
              className="transition-all duration-300"
            />
          )}

          {/* ACTIVE POSITION BOUNDS Overlay (SL / ENTRY / TP) */}
          {activeTrade && (
            <>
              {/* ENTRY price reference boundary */}
              <line
                x1="45"
                y1={entryY}
                x2={svgWidth - 70}
                y2={entryY}
                className="stroke-indigo-400"
                strokeWidth="1.5"
                strokeDasharray="3 3"
                opacity="0.8"
              />
              <rect
                x="45"
                y={entryY - 8}
                width="145"
                height="16"
                rx="4"
                className="fill-indigo-950 stroke-indigo-500/40"
                strokeWidth="1"
              />
              <text
                x="52"
                y={entryY + 4}
                className="fill-indigo-300 text-[8px] font-mono font-bold uppercase"
              >
                ENTRY: {activeTrade.entry_price.toFixed(2)} ({activeTrade.direction})
              </text>

              {/* TAKE PROFIT reference bounds */}
              {tpY >= 15 && tpY <= priceChartHeight - 5 && (
                <>
                  <line
                    x1="45"
                    y1={tpY}
                    x2={svgWidth - 70}
                    y2={tpY}
                    className="stroke-emerald-450"
                    strokeWidth="1"
                    strokeDasharray="2 4"
                    opacity="0.7"
                  />
                  <text
                    x={svgWidth - 190}
                    y={tpY - 4}
                    className="fill-emerald-400 text-[8px] font-mono font-bold text-right"
                  >
                    TARGET TAKE PROFIT ({tpPrice.toFixed(2)})
                  </text>
                </>
              )}

              {/* STOP LOSS reference bounds */}
              {slY >= 15 && slY <= priceChartHeight - 5 && (
                <>
                  <line
                    x1="45"
                    y1={slY}
                    x2={svgWidth - 70}
                    y2={slY}
                    className="stroke-rose-450"
                    strokeWidth="1"
                    strokeDasharray="2 4"
                    opacity="0.7"
                  />
                  <text
                    x={svgWidth - 180}
                    y={slY - 4}
                    className="fill-rose-400 text-[8px] font-mono font-bold text-right"
                  >
                    LIMIT STOP LOSS ({slPrice.toFixed(2)})
                  </text>
                </>
              )}

              {/* Entry location markers */}
              {finalMode === "ticks" && ticks.length > activeTrade.ticks_held && (
                <g transform={`translate(${getX(ticks.length - 1 - activeTrade.ticks_held)}, ${getPriceY(activeTrade.entry_price)})`}>
                  <circle r="6" className="fill-indigo-500 animate-ping opacity-60" />
                  <circle r="4" className="fill-indigo-400 stroke-slate-950" strokeWidth="1.5" />
                  <text x="7" y="-7" className="fill-indigo-300 text-[8px] font-sans font-black bg-indigo-950 px-1 py-0.5 rounded">INIT</text>
                </g>
              )}
              {finalMode === "1m" && (
                <g transform={`translate(${latestX - 40}, ${getPriceY(activeTrade.entry_price)})`}>
                  <circle r="6" className="fill-indigo-500 animate-ping opacity-60" />
                  <circle r="4" className="fill-indigo-400 stroke-slate-950" strokeWidth="1.5" />
                </g>
              )}
            </>
          )}

          {/* HISTORICAL SPIKE ARROWS */}
          {finalMode === "1m" ? (
            candles.map((c, index) => {
              if (!c.is_spike) return null;
              const x = getX(index);
              const y = getPriceY(isBoom ? c.high : c.low);
              return (
                <g key={index} transform={`translate(${x}, ${y})`}>
                  <circle r="7" className="fill-amber-500 animate-pulse opacity-40" />
                  {isBoom ? (
                    <polygon points="0,-12 -6,-4 -2,-4 -2,2 2,2 2,-4 6,-4" fill="#10b981" className="stroke-slate-905" strokeWidth="1" />
                  ) : (
                    <polygon points="0,12 -6,4 -2,4 -2,-2 2,-2 2,4 6,4" fill="#f43f5e" className="stroke-slate-905" strokeWidth="1" />
                  )}
                  <rect x="-18" y={isBoom ? "-24" : "15"} width="36" height="10" rx="3" className="fill-amber-500" />
                  <text x="0" y={isBoom ? "-17" : "22"} textAnchor="middle" className="fill-slate-950 text-[7px] font-extrabold font-mono">
                    SPIKE
                  </text>
                </g>
              );
            })
          ) : (
            ticks.map((t, index) => {
              if (!t.is_spike) return null;
              const x = getX(index);
              const y = getPriceY(t.price);
              return (
                <g key={index} transform={`translate(${x}, ${y})`}>
                  <circle r="7" className="fill-amber-500 animate-pulse opacity-40" />
                  {isBoom ? (
                    <polygon points="0,-12 -6,-4 -2,-4 -2,2 2,2 2,-4 6,-4" fill="#10b981" className="stroke-slate-905" strokeWidth="1" />
                  ) : (
                    <polygon points="0,12 -6,4 -2,4 -2,-2 2,-2 2,4 6,4" fill="#f43f5e" className="stroke-slate-905" strokeWidth="1" />
                  )}
                  <rect x="-18" y={isBoom ? "-24" : "15"} width="36" height="10" rx="3" className="fill-amber-500" />
                  <text x="0" y={isBoom ? "-17" : "22"} textAnchor="middle" className="fill-slate-950 text-[7px] font-extrabold font-mono">
                    SPIKE
                  </text>
                </g>
              );
            })
          )}

          {/* USER MANUALLY DRAWN TRENDLINES & SUPPORT/RESISTANCE LEVELS */}
          {drawings.map((draw) => {
            if (draw.type === "horizontal") {
              return (
                <g key={draw.id} className="group">
                  {/* Invisible thick helper line for easy deletion clicking */}
                  <line
                    x1="40"
                    y1={draw.y1}
                    x2={svgWidth - 70}
                    y2={draw.y1}
                    stroke={draw.color}
                    strokeWidth="12"
                    className="cursor-pointer opacity-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDrawings((prev) => prev.filter((d) => d.id !== draw.id));
                    }}
                    title="Click line to delete"
                  />
                  {/* Visible horizontal support/resistance level */}
                  <line
                    x1="40"
                    y1={draw.y1}
                    x2={svgWidth - 70}
                    y2={draw.y1}
                    stroke={draw.color}
                    strokeWidth="1.8"
                    opacity="0.65"
                    className="transition-all duration-150 group-hover:opacity-100"
                  />
                  {/* Circular Delete Handle at Left Margin overlay */}
                  <circle
                    cx="45"
                    cy={draw.y1}
                    r="4"
                    fill={draw.color}
                    className="cursor-pointer transition-transform duration-150 hover:scale-130"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDrawings((prev) => prev.filter((d) => d.id !== draw.id));
                    }}
                    title="Click to remove horizontal support/resistance level"
                  />
                  {/* Tiny text label indicator */}
                  <text
                    x="52"
                    y={draw.y1 - 5}
                    className="font-mono text-[7.5px] select-none pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ fill: draw.color }}
                  >
                    Click to delete level
                  </text>
                </g>
              );
            } else {
              return (
                <g key={draw.id} className="group">
                  {/* Invisible thick helper line for easy deletion clicking */}
                  <line
                    x1={draw.x1}
                    y1={draw.y1}
                    x2={draw.x2}
                    y2={draw.y2}
                    stroke={draw.color}
                    strokeWidth="12"
                    className="cursor-pointer opacity-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDrawings((prev) => prev.filter((d) => d.id !== draw.id));
                    }}
                    title="Click line to delete"
                  />
                  {/* Visible trendline path */}
                  <line
                    x1={draw.x1}
                    y1={draw.y1}
                    x2={draw.x2}
                    y2={draw.y2}
                    stroke={draw.color}
                    strokeWidth="2.2"
                    opacity="0.7"
                    className="transition-all duration-150 group-hover:opacity-100"
                  />
                  {/* Endpoints */}
                  <circle
                    cx={draw.x1}
                    cy={draw.y1}
                    r="3.5"
                    fill={draw.color}
                  />
                  <circle
                    cx={draw.x2}
                    cy={draw.y2}
                    r="3.5"
                    fill={draw.color}
                  />
                  {/* Midpoint helpful delete guide */}
                  <text
                    x={(draw.x1 + draw.x2) / 2}
                    y={(draw.y1 + draw.y2) / 2 - 6}
                    textAnchor="middle"
                    className="font-mono text-[7.5px] select-none pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ fill: draw.color }}
                  >
                    Click trendline to delete
                  </text>
                </g>
              );
            }
          })}

          {/* ACTIVE DRAWING PREVIEW GUIDE OVERLAY */}
          {drawingMode && hoverPoint && (
            <g className="pointer-events-none">
              {drawingMode === "horizontal" && (
                <>
                  <line
                    x1="40"
                    y1={hoverPoint.y}
                    x2={svgWidth - 70}
                    y2={hoverPoint.y}
                    stroke={lineColor}
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    opacity="0.75"
                  />
                  <circle
                    cx="45"
                    cy={hoverPoint.y}
                    r="4"
                    fill={lineColor}
                    className="animate-pulse"
                  />
                  <text
                    x="52"
                    y={hoverPoint.y - 5}
                    className="font-mono text-[8px]"
                    style={{ fill: lineColor }}
                  >
                    Click to place level
                  </text>
                </>
              )}
              {drawingMode === "trendline" && (
                <>
                  {startPoint && (
                    <>
                      <line
                        x1={startPoint.x}
                        y1={startPoint.y}
                        x2={hoverPoint.x}
                        y2={hoverPoint.y}
                        stroke={lineColor}
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity="0.8"
                      />
                      <circle
                        cx={startPoint.x}
                        cy={startPoint.y}
                        r="4.5"
                        fill={lineColor}
                      />
                    </>
                  )}
                  <circle
                    cx={hoverPoint.x}
                    cy={hoverPoint.y}
                    r="4"
                    fill={lineColor}
                    className="animate-pulse"
                  />
                </>
              )}
            </g>
          )}

          {/* REAL-TIME HORIZONTAL PRICE RETRACE LINE */}
          <line
            x1={latestX}
            y1={latestY}
            x2={svgWidth - 70}
            y2={latestY}
            stroke={chartThemeColor}
            strokeWidth="1"
            strokeDasharray="2 2"
          />
          <circle
            cx={latestX}
            cy={latestY}
            r="4"
            fill={chartThemeColor}
            className="animate-pulse"
          />

          {/* FLOATING TARGET PRICE TAG BADGE */}
          <g transform={`translate(${svgWidth - 65}, ${latestY - 8})`}>
            <rect
              width="60"
              height="16"
              rx="4"
              fill={chartThemeColor}
              className="shadow-md animate-pulse"
            />
            <text
              x="30"
              y="11"
              textAnchor="middle"
              className="fill-slate-950 font-mono font-bold text-[9px]"
            >
              {latestPrice.toFixed(2)}
            </text>
          </g>

          {/* ────────────────────────────────────────────────────────
              RSI SUB-WINDOW SECTION PANEL
             ──────────────────────────────────────────────────────── */}
          {/* Sub-window divider border line */}
          <line
            x1="40"
            y1="210"
            x2={svgWidth - 70}
            y2="210"
            className="stroke-slate-900"
            strokeWidth="1"
          />
          <text
            x="45"
            y="223"
            className="fill-slate-600 text-[8px] font-mono select-none"
          >
            INDICATOR WINDOW &bull; RSI (14)
          </text>

          {/* RSI grid dividers (typical boundaries 28, 50, 58) */}
          {[28, 50, 58].map((lineVal) => (
            <g key={lineVal}>
              <line
                x1="40"
                y1={getRsiY(lineVal)}
                x2={svgWidth - 70}
                y2={getRsiY(lineVal)}
                className={lineVal === 50 ? "stroke-slate-900/40" : "stroke-purple-900/50"}
                strokeDasharray={lineVal === 50 ? "4 4" : "2 2"}
              />
              <text
                x={svgWidth - 65}
                y={getRsiY(lineVal) + 3}
                className="fill-slate-600 text-[8px] font-mono"
              >
                {lineVal}
              </text>
            </g>
          ))}

          {/* RSI wave fill */}
          <polygon
            points={`${getX(0)},265 ` + rsiPointsStr + ` ${getX(finalMode === "1m" ? candles.length - 1 : ticks.length - 1)},265`}
            fill="url(#rsi-area-gradient)"
          />

          {/* RSI Waveform line path */}
          <polyline
            points={rsiPointsStr}
            fill="none"
            stroke="#a78bfa"
            strokeWidth="1.2"
          />
        </svg>
      </div>

      {/* Floating active trade indicator bar inside pane */}
      {activeTrade && (
        <div className="bg-slate-900/60 backdrop-blur-md border border-indigo-900/40 px-3.5 py-2.5 rounded-lg flex items-center justify-between text-xs font-mono select-none relative z-10 animate-slide-in">
          <div className="flex items-center gap-2.5">
            <span className="p-1 rounded bg-indigo-950 border border-indigo-900 text-indigo-400 flex items-center shadow-inner">
              <DollarSign className="h-3.5 w-3.5" />
            </span>
            <div>
              <p className="text-zinc-300 font-bold">
                Active {activeTrade.direction} Position Opened
              </p>
              <span className="text-[10px] text-zinc-500">
                Lots: {activeTrade.lot_size} &bull; Ticks held: {activeTrade.ticks_held}
              </span>
            </div>
          </div>
          <div className="text-right">
            <span className={`text-base font-black font-mono ${activeTrade.pnl >= 0 ? "text-emerald-400 font-extrabold" : "text-rose-400 font-extrabold"}`}>
              {activeTrade.pnl >= 0 ? "+" : ""}${activeTrade.pnl.toFixed(2)}
            </span>
            <span className="text-[9px] text-zinc-500 block font-normal">
              Running Profit
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
