import React, { useState, useEffect, useRef } from "react";
import {
  Settings,
  TrendingUp,
  Play,
  Square,
  RefreshCw,
  Sliders,
  DollarSign,
  Briefcase,
  Layers,
  Terminal,
  Activity,
  Award,
  Download,
  AlertTriangle,
  History,
  FileCode,
  CheckCircle,
  HelpCircle,
  XCircle,
  Copy,
  Github,
  ExternalLink,
} from "lucide-react";
import { StrategyConfig, TradeRecord } from "./types";
import LiveChart from "./components/LiveChart";

export default function App() {
  // ── CORE DATA STATE ──
  const [config, setConfig] = useState<StrategyConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // ── TOAST NOTIFICATIONS SYSTEM ──
  interface ToastItem {
    id: string;
    message: string;
    type: "success" | "error" | "info" | "warning";
  }
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = (message: string, type: "success" | "error" | "info" | "warning" = "info") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  };

  // ── LIVE TICK DATA STATE ──
  const [liveData, setLiveData] = useState<{
    symbol: string;
    ticks: any[];
    candles?: any[];
    active_trade: any | null;
    balance: number;
    is_fallback?: boolean;
  }>({ symbol: "", ticks: [], active_trade: null, balance: 50.0 });

  const prevActiveTradeIdRef = useRef<string | null>(null);
  const prevTradesCountRef = useRef<number>(0);

  // ── PROCESS LOGGERS ──
  const [optStatus, setOptStatus] = useState("idle");
  const [optOutput, setOptOutput] = useState("");
  const [optSymbol, setOptSymbol] = useState("BOOM1000");

  const [botStatus, setBotStatus] = useState("idle");
  const [botOutput, setBotOutput] = useState("");

  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // ── DASHBOARD CONTROLS ──
  const [activeTab, setActiveTab] = useState<"general" | "strategy" | "cycle" | "weights">("general");
  const [terminalType, setTerminalType] = useState<"optimizer" | "live-bot" | "exporter">("optimizer");

  // ── BRAIN EXPORTER STATES ──
  const [exportFiles, setExportFiles] = useState<Array<{ filename: string; exists: boolean; size: number }>>([]);
  const [selectedExportFile, setSelectedExportFile] = useState<string>("config.py");
  const [exportFileContent, setExportFileContent] = useState<string>("");
  const [loadingExportFile, setLoadingExportFile] = useState<boolean>(false);
  const [copiedFile, setCopiedFile] = useState<boolean>(false);
  const [copiedCurl, setCopiedCurl] = useState<boolean>(false);
  const [githubRepoUrl, setGithubRepoUrl] = useState<string>("https://github.com/Username/deriv-spike-bot-brain.git");

  // ── STREAMS AND REFS ──
  const optTerminalEndRef = useRef<HTMLDivElement>(null);
  const botTerminalEndRef = useRef<HTMLDivElement>(null);
  const scrollIntervalRef = useRef<any>(null);

  // ── COMPOSITE RECOMMENDATIONS ──
  const recommendedSeventies = {
    LABEL: "66% Win Rate Calibration Setup",
    ACTIVE_SYMBOL: "BOOM1000",
    BOOM_EXIT_TICKS: 150,     // Yield more drift room for spikes to fire
    CRASH_EXIT_TICKS: 150,
    STOP_LOSS_POINTS: 8.5,    // Wide SL prevents premature shakeout on drift
    TAKE_PROFIT_POINTS: 25.0,  // Aggressive TP capture
    SPIKE_THRESHOLD_FACTOR: 2.2, // Low threshold to catch micro-spikes early
    ENTRY_SCORE_THRESHOLD: 0.52, // Extreme selectivity: entry only with peak alignment
    WEIGHT_CYCLE: 0.70,       // 70% proven cycle weighting
    WEIGHT_COMPRESSION: 0.15,
    WEIGHT_ENERGY: 0.15,
    POST_TRADE_COOLDOWN_TICKS: 80, // Prevent chasing bad sequences
    CYCLE_EARLY_ZONE: 0.20,   // Strict recovery lock
    CYCLE_HOT_ZONE: 0.65,     // HOT zones start at 65% expected cycle point
    CYCLE_MAX_LOT_SCALE: 3.0, // Scale default lot to amplify high-probability triggers
    CYCLE_LOT_SCALING: true,
    MAX_DAILY_LOSS: 100.0,
    MAX_DRAWDOWN_PCT: 0.25,   // Higher tolerance matches wide SL setups
    DEFAULT_LOT_SIZE: 1.0,
  };

  // ── INITIAL FETCH ──
  useEffect(() => {
    fetchConfig();
    fetchTrades();
    fetchMetrics();
    fetchTicks();

    // Set polling timers for process statuses
    const statusInterval = setInterval(() => {
      checkOptimizerStatus();
      checkBotStatus();
      fetchTicks();
    }, 1500);

    const dataInterval = setInterval(() => {
      fetchTrades();
      fetchMetrics();
    }, 5000);

    return () => {
      clearInterval(statusInterval);
      clearInterval(dataInterval);
    };
  }, []);

  // ── TRIGGER TOAST NOTIFICATIONS FOR TRANSITIONS ──
  useEffect(() => {
    if (!liveData || !liveData.ticks || liveData.ticks.length === 0) return;

    const activeTrade = liveData.active_trade;
    const prevTradeId = prevActiveTradeIdRef.current;

    if (activeTrade && !prevTradeId) {
      addToast(
        `🚀 OPENED ${activeTrade.direction} POSITION on ${liveData.symbol} @ ${activeTrade.entry_price.toFixed(3)} | Volume: ${activeTrade.lot_size} Lots`,
        "info"
      );
      prevActiveTradeIdRef.current = activeTrade.trade_id;
    } else if (activeTrade && prevTradeId && activeTrade.trade_id !== prevTradeId) {
      addToast(
        `🚀 OPENED ${activeTrade.direction} POSITION on ${liveData.symbol} @ ${activeTrade.entry_price.toFixed(3)} | Volume: ${activeTrade.lot_size} Lots`,
        "info"
      );
      prevActiveTradeIdRef.current = activeTrade.trade_id;
    } else if (!activeTrade && prevTradeId) {
      // Position closed! Fetch trades list immediately to log the win/loss status
      fetchTrades();
      fetchMetrics();
      prevActiveTradeIdRef.current = null;
    }
  }, [liveData]);

  useEffect(() => {
    if (trades.length > 0) {
      if (prevTradesCountRef.current > 0 && trades.length > prevTradesCountRef.current) {
        // Find the newly closed trade of this session (first entry since reversed)
        const latestTrade = trades[0];
        if (latestTrade) {
          const isWin = latestTrade.pnl > 0;
          addToast(
            `🏁 CLOSED ${latestTrade.direction} ${latestTrade.symbol} | PnL: ${isWin ? "+" : ""}$${latestTrade.pnl.toFixed(2)} (${isWin ? "PROFIT 🟢" : "LOSS 🔴"}) | Exit: ${latestTrade.exit_reason || "timeout"}`,
            isWin ? "success" : "warning"
          );
        }
      }
      prevTradesCountRef.current = trades.length;
    }
  }, [trades]);

  // ── AUTOSCROLL TERMINALS ──
  useEffect(() => {
    if (terminalType === "optimizer") {
      optTerminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (terminalType === "live-bot") {
      botTerminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [optOutput, botOutput, terminalType]);

  const fetchTicks = async () => {
    try {
      const res = await fetch("/api/ticks");
      if (res.ok) {
        const data = await res.json();
        setLiveData(data);
      }
    } catch (e) {
      console.error("Error fetching live ticks:", e);
    }
  };

  const fetchConfig = async () => {
    try {
      setLoadingConfig(true);
      const res = await fetch("/api/config");
      const data = await res.json();
      setConfig(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingConfig(false);
    }
  };

  const fetchTrades = async () => {
    try {
      const res = await fetch("/api/trades");
      const data = await res.json();
      if (Array.isArray(data)) {
        // Reverse to show newest trades at first
        setTrades([...data].reverse());
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch("/api/metrics");
      const data = await res.json();
      setMetrics(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleClearTrades = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3050);
      return;
    }
    try {
      const res = await fetch("/api/trades/clear", { method: "POST" });
      if (res.ok) {
        setTrades([]);
        setMetrics(null);
        setConfirmClear(false);
      }
    } catch (e) {
      console.error("Error clearing trade logs:", e);
    }
  };

  const checkOptimizerStatus = async () => {
    try {
      const res = await fetch("/api/optimize/status");
      const data = await res.json();
      setOptStatus(data.status);
      setOptOutput(data.output);
      setOptSymbol(data.symbol);
    } catch (e) {
      console.error(e);
    }
  };

  const checkBotStatus = async () => {
    try {
      const res = await fetch("/api/bot/status");
      const data = await res.json();
      setBotStatus(data.status);
      setBotOutput(data.output);
    } catch (e) {
      console.error(e);
    }
  };

  // ── FETCH EXPORTABLE FILES ──
  const fetchExportFiles = async () => {
    try {
      const res = await fetch("/api/export/files");
      const data = await res.json();
      if (Array.isArray(data)) {
        setExportFiles(data);
      }
    } catch (e) {
      console.error("Error fetching export files:", e);
    }
  };

  const fetchExportFileContent = async (filename: string) => {
    try {
      setLoadingExportFile(true);
      const res = await fetch(`/api/export/file/${filename}?raw=true`);
      const text = await res.text();
      setExportFileContent(text);
    } catch (e) {
      console.error(`Error fetching file content for ${filename}:`, e);
      setExportFileContent(`# Error loading file ${filename} content.`);
    } finally {
      setLoadingExportFile(false);
    }
  };

  // Fetch files and selected file content when terminalType is exporter
  useEffect(() => {
    if (terminalType === "exporter") {
      fetchExportFiles();
      fetchExportFileContent(selectedExportFile);
    }
  }, [terminalType, selectedExportFile]);

  // ── UPDATE CONFIG ──
  const handleInputChange = (key: keyof StrategyConfig, value: any) => {
    if (!config) return;
    setConfig({
      ...config,
      [key]: value,
    });
    setSaveStatus("idle");
  };

  const handleSaveConfig = async (configToSave = config) => {
    if (!configToSave) return;
    try {
      setSaveStatus("saving");
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configToSave),
      });
      if (res.ok) {
        const result = await res.json();
        setConfig(result.data);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 3000);
      } else {
        setSaveStatus("error");
      }
    } catch (e) {
      setSaveStatus("error");
    }
  };

  const selectActiveSymbol = async (symbol: string) => {
    if (!config) return;
    const updated = { ...config, ACTIVE_SYMBOL: symbol };
    setConfig(updated);
    try {
      setSaveStatus("saving");
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        const result = await res.json();
        setConfig(result.data);
        setSaveStatus("saved");
        addToast(`Target index successfully shifted to ${symbol}. Raw configuration updated!`, "success");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else {
        setSaveStatus("error");
        addToast("Failed to save target symbol configuration.", "error");
      }
    } catch (e) {
      setSaveStatus("error");
      addToast("Failed to connect to backend configuration system.", "error");
    }
  };

  const applyRecommendations = () => {
    if (!config) return;
    const update = { ...config, ...recommendedSeventies };
    // Exclude LABEL field
    delete (update as any).LABEL;
    setConfig(update);
    handleSaveConfig(update);
  };

  // ── SYSTEM RUN CONTROLLERS ──
  const startOptimizer = async () => {
    try {
      setTerminalType("optimizer");
      setOptOutput("Initiating Stage Grid Swaps...");
      await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: config?.ACTIVE_SYMBOL || "BOOM1000" }),
      });
      checkOptimizerStatus();
    } catch (e) {
      console.error(e);
    }
  };

  const stopOptimizer = async () => {
    try {
      await fetch("/api/optimize/stop", { method: "POST" });
      checkOptimizerStatus();
    } catch (e) {
      console.error(e);
    }
  };

  const startLiveBot = async () => {
    try {
      setTerminalType("live-bot");
      setBotOutput("Pre-allocating stream headers...");
      await fetch("/api/bot/start", { method: "POST" });
      checkBotStatus();
    } catch (e) {
      console.error(e);
    }
  };

  const stopLiveBot = async () => {
    try {
      await fetch("/api/bot/stop", { method: "POST" });
      checkBotStatus();
    } catch (e) {
      console.error(e);
    }
  };

  // ── STATISTICS CALCS ──
  const totalSimTrades = trades.length;
  const simulatedWins = trades.filter((t) => t.pnl > 0).length;
  const simulatedWinRate = totalSimTrades ? (simulatedWins / totalSimTrades) * 100 : 0;
  const simulatedPnL = trades.reduce((acc, curr) => acc + curr.pnl, 0);

  // Parse terminal outputs with colored matches
  const formatTerminalLine = (line: string, index: number) => {
    if (!line.trim()) return null;

    let colorClass = "text-sky-300";
    if (line.includes("OPENED")) colorClass = "text-emerald-400 font-semibold";
    else if (line.includes("CLOSED [WIN")) colorClass = "text-green-400 font-bold bg-green-950/20 px-1 rounded";
    else if (line.includes("CLOSED [LOSS")) colorClass = "text-rose-400 font-bold bg-rose-950/20 px-1 rounded";
    else if (line.includes("WARNING") || line.includes("Blocked")) colorClass = "text-amber-400";
    else if (line.includes("[ERROR]")) colorClass = "text-rose-500 font-semibold";
    else if (line.includes("[STAGE") || line.includes("FINAL RESULT")) colorClass = "text-purple-400 font-bold";
    else if (line.includes("best so far") || line.includes("Validated score")) colorClass = "text-emerald-300";

    return (
      <div key={index} className={`font-mono text-xs py-0.5 leading-relaxed tracking-wide ${colorClass}`}>
        <span className="text-zinc-600 select-none mr-2">{String(index + 1).padStart(3, "0")} |</span>
        {line}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500/30 selection:text-emerald-200">
      
      {/* ── METADATA & BRAND HEADER ── */}
      <header className="border-b border-slate-900 bg-slate-950/90 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-tr from-emerald-500 to-teal-400 rounded-xl shadow-lg shadow-emerald-500/10 animate-pulse">
            <TrendingUp className="h-6 w-6 text-slate-950 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              SynthiSpike AI Agent Dashboard
            </h1>
            <p className="text-xs text-slate-500 font-mono tracking-wider mt-0.5">
              DERIV SYNTHETIC SPIKE BRAIN ENGINE &bull; MODEL VERSION 3.0
            </p>
          </div>
        </div>

        {/* Live Status Board */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 bg-slate-900/60 px-3.5 py-1.5 rounded-lg border border-slate-850">
            <span className="flex h-2.5 w-2.5 relative">
              {botStatus === "running" && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${botStatus === "running" ? "bg-emerald-500" : "bg-slate-600"}`}></span>
            </span>
            <span className="text-xs font-mono font-medium">
              Live Bot: <span className={botStatus === "running" ? "text-emerald-400" : "text-slate-400"}>{botStatus.toUpperCase()}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 bg-slate-900/60 px-3.5 py-1.5 rounded-lg border border-slate-850">
            <span className="flex h-2.5 w-2.5 relative">
              {optStatus === "running" && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${optStatus === "running" ? "bg-indigo-500 animate-pulse" : "bg-slate-600"}`}></span>
            </span>
            <span className="text-xs font-mono font-medium">
              Optimizer: <span className={optStatus === "running" ? "text-indigo-400" : "text-slate-400"}>{optStatus.toUpperCase()}</span>
            </span>
          </div>

          <button
            onClick={applyRecommendations}
            className="px-4 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-semibold text-xs rounded-lg transition-transform active:scale-95 hover:opacity-90 flex items-center gap-1.5 shadow-md shadow-emerald-500/10"
          >
            <Award className="h-3.5 w-3.5 stroke-[2.5]" />
            Flash 66% Win Rate Setup
          </button>
        </div>
      </header>

      {/* ── BENTO DASHBOARD CONTAINER ── */}
      <main className="flex-1 p-6 grid grid-cols-1 xl:grid-cols-12 gap-6 max-w-[1920px] mx-auto w-full">
        
        {/* PANEL LEVEL A: PARAMETER EDITOR (WIDTHCol 4) */}
        <section className="xl:col-span-4 flex flex-col bg-slate-950 border border-slate-900 rounded-xl overflow-hidden shadow-xl" id="parameter-panel">
          
          <div className="p-4 bg-slate-950/60 border-b border-slate-900 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-emerald-400" />
              <h2 className="font-bold text-sm text-slate-200">System Configuration Portal</h2>
            </div>
            {saveStatus === "saving" && <span className="text-xs text-yellow-400">Saving config...</span>}
            {saveStatus === "saved" && <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Config Flashed!</span>}
            {saveStatus === "error" && <span className="text-xs text-rose-500 flex items-center gap-1"><XCircle className="h-3 w-3" /> Error Flashing</span>}
          </div>

          {/* Navigation Controls inside side column */}
          <div className="grid grid-cols-4 bg-slate-950 border-b border-slate-900/50">
            {(["general", "strategy", "cycle", "weights"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-3 text-2xs font-mono font-medium border-b-2 uppercase tracking-tight transition-colors ${
                  activeTab === tab
                    ? "border-emerald-500 text-emerald-400 bg-emerald-500/5"
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5 max-h-[640px]">
            {loadingConfig ? (
              <div className="h-48 flex items-center justify-center">
                <RefreshCw className="h-6 w-6 text-emerald-400 animate-spin" />
              </div>
            ) : config ? (
              <>
                {/* ── TAB 1: GENERAL & RISK ── */}
                {activeTab === "general" && (
                  <div className="space-y-4">
                    <div className="bg-slate-900/30 p-3 rounded-lg border border-slate-900/80">
                      <h3 className="text-2xs font-mono font-bold tracking-wider text-slate-400 uppercase mb-3">Asset Controls</h3>
                      <div className="space-y-3">
                        <label className="block">
                          <span className="text-2xs font-mono text-slate-400 block mb-1">Active Index Symbol</span>
                          <select
                            value={config.ACTIVE_SYMBOL}
                            onChange={(e) => handleInputChange("ACTIVE_SYMBOL", e.target.value)}
                            className="w-full bg-slate-900 border border-slate-800 text-sm py-1.5 px-2 rounded-md font-mono text-emerald-300 focus:outline-none focus:border-emerald-500"
                          >
                            <option value="BOOM1000">BOOM1000 (1 spike / 1k ticks)</option>
                            <option value="CRASH1000">CRASH1000 (1 spike / 1k ticks)</option>
                            <option value="BOOM500">BOOM500 (1 spike / 500 ticks)</option>
                            <option value="CRASH500">CRASH500 (1 spike / 500 ticks)</option>
                          </select>
                        </label>
                        <div className="border-t border-slate-800/60 pt-3 mt-3">
                          <span className="text-2xs font-mono text-slate-450 block mb-2 font-semibold">Ticks Data Feed Mode</span>
                          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800/80">
                            <button
                              type="button"
                              onClick={() => handleInputChange("FORCE_LIVE_WS", true)}
                              className={`flex-1 py-1.5 px-2 text-3xs font-mono rounded-md font-bold transition-all text-center ${
                                config.FORCE_LIVE_WS !== false
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                  : "text-slate-500 hover:text-slate-300 border border-transparent"
                              }`}
                            >
                              ● REAL LIVE DATA
                            </button>
                            <button
                              type="button"
                              onClick={() => handleInputChange("FORCE_LIVE_WS", false)}
                              className={`flex-1 py-1.5 px-2 text-3xs font-mono rounded-md font-bold transition-all text-center ${
                                config.FORCE_LIVE_WS === false
                                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                  : "text-slate-500 hover:text-slate-300 border border-transparent"
                              }`}
                            >
                              ⚠️ OFFLINE MODE
                            </button>
                          </div>
                          <p className="text-[10px] text-slate-450 font-mono mt-1.5 leading-relaxed">
                            {config.FORCE_LIVE_WS !== false 
                              ? "Locks data feed strictly to real-time high-frequency Deriv WebSocket. Offline sim feed is fully deactivated."
                              : "Enables fallback simulated price feed if internet goes down or symbols return API credentials errors."}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="text-2xs font-mono text-slate-400 block mb-1">Default Lot Size</span>
                            <input
                              type="number"
                              step="0.05"
                              value={config.DEFAULT_LOT_SIZE}
                              onChange={(e) => handleInputChange("DEFAULT_LOT_SIZE", parseFloat(e.target.value))}
                              className="w-full bg-slate-900 border border-slate-800 text-sm py-1 px-2 rounded-md font-mono text-teal-300"
                            />
                          </label>
                          <label className="block">
                            <span className="text-2xs font-mono text-slate-400 block mb-1">Cooldown Ticks</span>
                            <input
                              type="number"
                              value={config.POST_TRADE_COOLDOWN_TICKS}
                              onChange={(e) => handleInputChange("POST_TRADE_COOLDOWN_TICKS", parseInt(e.target.value))}
                              className="w-full bg-slate-900 border border-slate-800 text-sm py-1 px-2 rounded-md font-mono text-teal-300"
                            />
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-900/30 p-3 rounded-lg border border-slate-900/80">
                      <h3 className="text-2xs font-mono font-bold tracking-wider text-slate-400 uppercase mb-3">Defensive Risk Safeguards</h3>
                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between text-2xs font-mono mb-1">
                            <span className="text-slate-400">Max Daily Stop Loss</span>
                            <span className="text-amber-400">${config.MAX_DAILY_LOSS}</span>
                          </div>
                          <input
                            type="range"
                            min="20"
                            max="300"
                            step="5"
                            value={config.MAX_DAILY_LOSS}
                            onChange={(e) => handleInputChange("MAX_DAILY_LOSS", parseFloat(e.target.value))}
                            className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>
                        <div>
                          <div className="flex justify-between text-2xs font-mono mb-1">
                            <span className="text-slate-400">Max Drawdown Limit</span>
                            <span className="text-amber-400">{Math.round(config.MAX_DRAWDOWN_PCT * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min="0.05"
                            max="0.4"
                            step="0.01"
                            value={config.MAX_DRAWDOWN_PCT}
                            onChange={(e) => handleInputChange("MAX_DRAWDOWN_PCT", parseFloat(e.target.value))}
                            className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="text-2xs font-mono text-slate-400 block mb-1">Max Session Trades</span>
                            <input
                              type="number"
                              value={config.MAX_TRADES_PER_SESSION}
                              onChange={(e) => handleInputChange("MAX_TRADES_PER_SESSION", parseInt(e.target.value))}
                              className="w-full bg-slate-900 border border-slate-800 text-sm py-1 px-2 rounded-md font-mono"
                            />
                          </label>
                          <label className="block">
                            <span className="text-2xs font-mono text-slate-400 block mb-1">Streak Limit Lockout</span>
                            <input
                              type="number"
                              value={config.COOLDOWN_AFTER_LOSS_STREAK}
                              onChange={(e) => handleInputChange("COOLDOWN_AFTER_LOSS_STREAK", parseInt(e.target.value))}
                              className="w-full bg-slate-900 border border-slate-800 text-sm py-1 px-2 rounded-md font-mono"
                            />
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-900/30 p-3 rounded-lg border border-slate-900/80">
                      <div className="flex justify-between items-center mb-3">
                        <h3 className="text-2xs font-mono font-bold tracking-wider text-slate-400 uppercase">Martingale Multiplier Strategy</h3>
                        <label className="inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.MARTINGALE_ACTIVE}
                            onChange={(e) => handleInputChange("MARTINGALE_ACTIVE", e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="relative w-7 h-4 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500"></div>
                          <span className="ms-1.5 text-2xs font-mono text-slate-400">Active</span>
                        </label>
                      </div>
                      
                      {config.MARTINGALE_ACTIVE && (
                        <div className="space-y-3">
                          <div>
                            <div className="flex justify-between text-2xs font-mono mb-1">
                              <span className="text-slate-400">Streak Multiplier Factor</span>
                              <span className="text-amber-400">{config.MARTINGALE_FACTOR}x</span>
                            </div>
                            <input
                              type="range"
                              min="1.0"
                              max="2.5"
                              step="0.05"
                              value={config.MARTINGALE_FACTOR}
                              onChange={(e) => handleInputChange("MARTINGALE_FACTOR", parseFloat(e.target.value))}
                              className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                            />
                          </div>
                          <div>
                            <div className="flex justify-between text-2xs font-mono mb-1">
                              <span className="text-slate-400">Max Lot Multiplier Bound</span>
                              <span className="text-amber-400">{config.MARTINGALE_MAX_MULTIPLIER}x</span>
                            </div>
                            <input
                              type="range"
                              min="2.0"
                              max="10.0"
                              step="0.5"
                              value={config.MARTINGALE_MAX_MULTIPLIER}
                              onChange={(e) => handleInputChange("MARTINGALE_MAX_MULTIPLIER", parseFloat(e.target.value))}
                              className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                            />
                          </div>
                        </div>
                      )}
                      {!config.MARTINGALE_ACTIVE && (
                        <p className="text-[10px] text-zinc-500 font-mono">Trades use fixed sizing and do not amplify volume after losses.</p>
                      )}
                    </div>

                    <div className="bg-slate-900/30 p-3 rounded-lg border border-slate-900/80">
                      <div className="flex justify-between items-center mb-3">
                        <h3 className="text-2xs font-mono font-bold tracking-wider text-slate-400 uppercase">Counter-Spike Drift Trading</h3>
                        <label className="inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.TRADE_AGAINST_SPIKES}
                            onChange={(e) => handleInputChange("TRADE_AGAINST_SPIKES", e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="relative w-7 h-4 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500"></div>
                          <span className="ms-1.5 text-2xs font-mono text-slate-400">Active</span>
                        </label>
                      </div>

                      {config.TRADE_AGAINST_SPIKES && (
                        <div className="space-y-3">
                          <div>
                            <div className="flex justify-between text-2xs font-mono mb-1">
                              <span className="text-slate-400">Counter-Spike Lot Size</span>
                              <span className="text-teal-400">{config.ANTI_SPIKE_LOT_SIZE} lot</span>
                            </div>
                            <input
                              type="number"
                              step="0.01"
                              value={config.ANTI_SPIKE_LOT_SIZE}
                              onChange={(e) => handleInputChange("ANTI_SPIKE_LOT_SIZE", parseFloat(e.target.value))}
                              className="w-full bg-slate-900 border border-slate-800 text-sm py-1 px-2 rounded-md font-mono text-teal-300"
                            />
                          </div>
                          <p className="text-[10px] text-zinc-500 font-mono">Trades seek to exploit corrections by catching the drift in the recovery zone.</p>
                        </div>
                      )}
                      {!config.TRADE_AGAINST_SPIKES && (
                        <p className="text-[10px] text-zinc-500 font-mono">Only enters long positions in alignment with spikes (BUY on Boom / SELL on Crash).</p>
                      )}
                    </div>
                  </div>
                )}

                {/* ── TAB 2: SPIKE STRATEGY ── */}
                {activeTab === "strategy" && (
                  <div className="space-y-4">
                    <div className="bg-slate-900/30 p-3 rounded-lg border border-slate-900/80">
                      <h3 className="text-2xs font-mono font-bold tracking-wider text-slate-400 uppercase mb-3">Entry & Score Controls</h3>
                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between text-2xs font-mono mb-1">
                            <span className="text-slate-400">Trigger Threshold ({config.ACTIVE_SYMBOL})</span>
                            <span className="text-amber-400">{config.ENTRY_SCORE_THRESHOLD} Composite</span>
                          </div>
                          <input
                            type="range"
                            min="0.25"
                            max="0.75"
                            step="0.01"
                            value={config.ENTRY_SCORE_THRESHOLD}
                            onChange={(e) => handleInputChange("ENTRY_SCORE_THRESHOLD", parseFloat(e.target.value))}
                            className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                          <p className="text-[10px] text-zinc-500 mt-1">Minimum probability margin required to initiate long position.</p>
                        </div>

                        <div>
                          <div className="flex justify-between text-2xs font-mono mb-1">
                            <span className="text-slate-400">Spike Deviation Factor</span>
                            <span className="text-amber-400">{config.SPIKE_THRESHOLD_FACTOR}x</span>
                          </div>
                          <input
                            type="range"
                            min="1.5"
                            max="4.5"
                            step="0.1"
                            value={config.SPIKE_THRESHOLD_FACTOR}
                            onChange={(e) => handleInputChange("SPIKE_THRESHOLD_FACTOR", parseFloat(e.target.value))}
                            className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                          <p className="text-[10px] text-zinc-500 mt-1">Multiplier above rolling average tick range defining a true Spike event.</p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="text-2xs font-mono text-zinc-400 block mb-1">RSI Oversold Filter</span>
                            <input
                              type="number"
                              value={config.RSI_OVERSOLD}
                              onChange={(e) => handleInputChange("RSI_OVERSOLD", parseInt(e.target.value))}
                              className="w-full bg-slate-900 border border-slate-800 text-sm py-1 px-2 rounded-md font-mono"
                            />
                          </label>
                          <label className="block">
                            <span className="text-2xs font-mono text-zinc-400 block mb-1">Squeeze Threshold</span>
                            <input
                              type="number"
                              step="0.05"
                              value={config.SQUEEZE_THRESHOLD}
                              onChange={(e) => handleInputChange("SQUEEZE_THRESHOLD", parseFloat(e.target.value))}
                              className="w-full bg-slate-900 border border-slate-800 text-sm py-1 px-2 rounded-md font-mono"
                            />
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-900/30 p-3 rounded-lg border border-slate-900/80">
                      <h3 className="text-2xs font-mono font-bold tracking-wider text-slate-400 uppercase mb-3">Asymmetric Exits Limits</h3>
                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between text-2xs font-mono mb-1">
                            <span className="text-slate-400">Unrealised Stop Loss</span>
                            <span className="text-rose-400">-{config.STOP_LOSS_POINTS} pts</span>
                          </div>
                          <input
                            type="range"
                            min="1.5"
                            max="10.0"
                            step="0.1"
                            value={config.STOP_LOSS_POINTS}
                            onChange={(e) => handleInputChange("STOP_LOSS_POINTS", parseFloat(e.target.value))}
                            className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-rose-500"
                          />
                          <p className="text-[10px] text-zinc-500 mt-1">Wide stop allows breathing space for the geometric spike to occur.</p>
                        </div>

                        <div>
                          <div className="flex justify-between text-2xs font-mono mb-1">
                            <span className="text-slate-400">Force Take Profit limit</span>
                            <span className="text-green-400">+{config.TAKE_PROFIT_POINTS} pts</span>
                          </div>
                          <input
                            type="range"
                            min="5.0"
                            max="35.0"
                            step="0.5"
                            value={config.TAKE_PROFIT_POINTS}
                            onChange={(e) => handleInputChange("TAKE_PROFIT_POINTS", parseFloat(e.target.value))}
                            className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="text-2xs font-mono text-zinc-400 block mb-1">BOOM Holding Timeout</span>
                            <input
                              type="number"
                              value={config.BOOM_EXIT_TICKS}
                              onChange={(e) => handleInputChange("BOOM_EXIT_TICKS", parseInt(e.target.value))}
                              className="w-full bg-slate-900 border border-slate-800 text-sm py-1 px-2 rounded-md font-mono"
                            />
                          </label>
                          <label className="block">
                            <span className="text-2xs font-mono text-zinc-400 block mb-1">CRASH Holding Timeout</span>
                            <input
                              type="number"
                              value={config.CRASH_EXIT_TICKS}
                              onChange={(e) => handleInputChange("CRASH_EXIT_TICKS", parseInt(e.target.value))}
                              className="w-full bg-slate-900 border border-slate-800 text-sm py-1 px-2 rounded-md font-mono"
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── TAB 3: SPIKE CYCLE COUNTER ── */}
                {activeTab === "cycle" && (
                  <div className="space-y-4">
                    <div className="bg-slate-900/30 p-3 rounded-lg border border-slate-900/80">
                      <div className="flex justify-between items-center mb-3">
                        <h3 className="text-2xs font-mono font-bold tracking-wider text-slate-400 uppercase">Spike Cycle Timing (Proven Edge)</h3>
                        <label className="inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.CYCLE_LOT_SCALING}
                            onChange={(e) => handleInputChange("CYCLE_LOT_SCALING", e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="relative w-7 h-4 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500"></div>
                          <span className="ms-1.5 text-2xs font-mono text-slate-400">Scale Lots</span>
                        </label>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between text-2xs font-mono mb-1">
                            <span className="text-slate-400">Expected Spike Distance (N Ticks)</span>
                            <span className="text-amber-400">{config.SPIKE_CYCLE_LENGTH} Ticks</span>
                          </div>
                          <input
                            type="range"
                            min="200"
                            max="1500"
                            step="50"
                            value={config.SPIKE_CYCLE_LENGTH}
                            onChange={(e) => handleInputChange("SPIKE_CYCLE_LENGTH", parseInt(e.target.value))}
                            className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between text-2xs font-mono mb-1">
                            <span className="text-slate-400">Recovery Phase End Bound</span>
                            <span className="text-amber-400">{Math.round(config.CYCLE_EARLY_ZONE * 100)}% ({config.CYCLE_EARLY_ZONE})</span>
                          </div>
                          <input
                            type="range"
                            min="0.05"
                            max="0.40"
                            step="0.01"
                            value={config.CYCLE_EARLY_ZONE}
                            onChange={(e) => handleInputChange("CYCLE_EARLY_ZONE", parseFloat(e.target.value))}
                            className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                          <p className="text-[10px] text-zinc-500 mt-1">Block entries for this zone post-spike. Prevents drift burn.</p>
                        </div>

                        <div>
                          <div className="flex justify-between text-2xs font-mono mb-1">
                            <span className="text-slate-400">HOT Phase Trigger Start Bound</span>
                            <span className="text-amber-400">{Math.round(config.CYCLE_HOT_ZONE * 100)}% ({config.CYCLE_HOT_ZONE})</span>
                          </div>
                          <input
                            type="range"
                            min="0.45"
                            max="0.85"
                            step="0.01"
                            value={config.CYCLE_HOT_ZONE}
                            onChange={(e) => handleInputChange("CYCLE_HOT_ZONE", parseFloat(e.target.value))}
                            className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between text-2xs font-mono mb-1">
                            <span className="text-slate-400">Maximum Lot Scaling Factor</span>
                            <span className="text-emerald-400">{config.CYCLE_MAX_LOT_SCALE}x</span>
                          </div>
                          <input
                            type="range"
                            min="1.0"
                            max="3.5"
                            step="0.1"
                            value={config.CYCLE_MAX_LOT_SCALE}
                            onChange={(e) => handleInputChange("CYCLE_MAX_LOT_SCALE", parseFloat(e.target.value))}
                            className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                          <p className="text-[10px] text-zinc-500 mt-1">Multiplies the order volume up to this peak limit if deep overdue.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── TAB 4: WEIGHTS & COMPOSITES ── */}
                {activeTab === "weights" && (
                  <div className="space-y-4">
                    <div className="bg-slate-900/30 p-3 rounded-lg border border-slate-900/80">
                      <h3 className="text-2xs font-mono font-bold tracking-wider text-slate-400 uppercase mb-3">Probability Core Weights</h3>
                      <p className="text-[10px] text-slate-400 mb-4 font-mono leading-relaxed bg-slate-950 p-2 border border-slate-900 rounded">
                        Composite Probability Score (0.0 – 1.0) is dynamically computed. The total weights MUST sum to 1.0:
                        <br />
                        <span className="text-emerald-400 font-bold">Score = (w_cycle * Cycle_P) + (w_compress * Compress_P) + (w_energy * Energy_P)</span>
                      </p>

                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between text-2xs font-mono mb-1">
                            <span className="text-slate-400">Cycle Time Weight (Proven Edge)</span>
                            <span className="text-emerald-400">{config.WEIGHT_CYCLE}</span>
                          </div>
                          <input
                            type="range"
                            min="0.30"
                            max="0.85"
                            step="0.05"
                            value={config.WEIGHT_CYCLE}
                            onChange={(e) => handleInputChange("WEIGHT_CYCLE", parseFloat(e.target.value))}
                            className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between text-2xs font-mono mb-1">
                            <span className="text-slate-400">Compression Volatility Weight</span>
                            <span className="text-teal-400">{config.WEIGHT_COMPRESSION}</span>
                          </div>
                          <input
                            type="range"
                            min="0.05"
                            max="0.40"
                            step="0.05"
                            value={config.WEIGHT_COMPRESSION}
                            onChange={(e) => handleInputChange("WEIGHT_COMPRESSION", parseFloat(e.target.value))}
                            className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between text-2xs font-mono mb-1">
                            <span className="text-slate-400">Directional Momentum Weight</span>
                            <span className="text-teal-400">{config.WEIGHT_ENERGY}</span>
                          </div>
                          <input
                            type="range"
                            min="0.05"
                            max="0.40"
                            step="0.05"
                            value={config.WEIGHT_ENERGY}
                            onChange={(e) => handleInputChange("WEIGHT_ENERGY", parseFloat(e.target.value))}
                            className="w-full h-1 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>

                        <button
                          onClick={() => {
                            setConfig({
                              ...config,
                              WEIGHT_CYCLE: 0.60,
                              WEIGHT_COMPRESSION: 0.20,
                              WEIGHT_ENERGY: 0.20,
                            });
                          }}
                          className="w-full py-1 text-center font-mono text-[10px] bg-slate-900 hover:bg-slate-850 rounded border border-slate-800 text-zinc-400"
                        >
                          Reset to Audited Balances (0.6 / 0.2 / 0.2)
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Apply button */}
                <button
                  onClick={() => handleSaveConfig()}
                  disabled={saveStatus === "saving"}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 font-bold rounded-lg text-xs tracking-wider uppercase shadow-md transition-all uppercase flex items-center justify-center gap-2"
                >
                  <Sliders className="h-4 w-4" />
                  Flash Config & Apply Changes
                </button>
              </>
            ) : (
              <div className="text-slate-400 text-xs py-8">Config not found or corrupted.</div>
            )}
          </div>
        </section>

        {/* ── CENTRAL ACTIONS & LOGGING TERMINALS (WIDTHCol 5) ── */}
        <section className="xl:col-span-5 flex flex-col gap-6">
          
          {/* CONTROL SWITCHBOARD PANEL */}
          <div className="bg-slate-950 border border-slate-900 p-5 rounded-xl space-y-4">
            <h2 className="font-bold text-sm text-slate-200 flex items-center gap-2 border-b border-slate-900 pb-2">
              <Activity className="h-4 w-4 text-emerald-400 animate-pulse" />
              Agent Controls & Integration Panels
            </h2>

            {/* Quick Index Target Switcher */}
            <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-900 flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold font-mono tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  Target SynthiSpike Index:
                </span>
                {config && (
                  <span className="text-3xs font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold uppercase animate-pulse">
                    CURRENTLY TARGETING {config.ACTIVE_SYMBOL}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-4 gap-2">
                {[
                  { symbol: "BOOM1000", label: "BOOM 1000", desc: "1 spike / 16m" },
                  { symbol: "CRASH1000", label: "CRASH 1000", desc: "1 spike / 16m" },
                  { symbol: "BOOM500", label: "BOOM 500", desc: "1 spike / 8m" },
                  { symbol: "CRASH500", label: "CRASH 500", desc: "1 spike / 8m" },
                ].map((item) => {
                  const isActive = config?.ACTIVE_SYMBOL === item.symbol;
                  return (
                    <button
                      key={item.symbol}
                      onClick={() => selectActiveSymbol(item.symbol)}
                      disabled={!config}
                      className={`py-2 px-1 rounded-lg border font-mono text-center transition-all cursor-pointer flex flex-col justify-center items-center gap-0.5 ${
                        isActive
                          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/50 shadow-[0_0_12px_rgba(16,185,129,0.12)] font-bold ring-1 ring-emerald-500/30"
                          : "bg-slate-950/60 text-slate-500 hover:text-slate-305 border-slate-850 hover:border-slate-800"
                      }`}
                    >
                      <span className="text-3xs tracking-wider uppercase font-black">{item.label}</span>
                      <span className="text-[8px] opacity-60 leading-tight block">{item.desc}</span>
                    </button>
                  );
                })}
              </div>

              <p className="text-[10px] text-slate-500 font-mono leading-relaxed bg-slate-950/60 p-2 rounded border border-slate-900">
                ⚠️ <span className="text-slate-400">Target Shift:</span> Selecting an index saves config natively to <code className="text-slate-300 font-sans text-3xs">config.py</code>. If active streaming connection or optimization backtest is currently online, restart to apply.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Backtester Opt Board */}
              <div className="bg-slate-900/20 p-4 rounded-xl border border-slate-900 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-2xs font-bold font-mono tracking-wider text-slate-500 uppercase">Backtester Optimizer</span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${optStatus === "running" ? "bg-indigo-950 text-indigo-400 border border-indigo-800" : "bg-slate-900 text-slate-400"}`}>
                    {optStatus.toUpperCase()}
                  </span>
                </div>
                <p className="text-2xs text-slate-400 leading-relaxed min-h-[44px]">
                  Executes 3-STAGE search on generated tick sequences to detect optimal parameters. Writes the winner back.
                </p>
                <div className="flex gap-2">
                  {optStatus === "running" ? (
                    <button
                      onClick={stopOptimizer}
                      className="flex-1 py-2 bg-rose-600/20 hover:bg-rose-600/35 text-rose-300 font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 border border-rose-500/30 shadow-lg transition-transform active:scale-95"
                    >
                      <Square className="h-3.5 w-3.5 stroke-[2.5]" />
                      Terminate
                    </button>
                  ) : (
                    <button
                      onClick={startOptimizer}
                      className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 shadow-lg active:scale-95 transition-all"
                    >
                      <Play className="h-3.5 w-3.5 stroke-[2.5]" />
                      Grid Search
                    </button>
                  )}
                </div>
              </div>

              {/* Streaming Agent Board */}
              <div className="bg-slate-900/20 p-4 rounded-xl border border-slate-900 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-2xs font-bold font-mono tracking-wider text-slate-500 uppercase">Live Streaming Agent</span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${botStatus === "running" ? "bg-emerald-950 text-emerald-400 border border-emerald-800" : "bg-slate-900 text-slate-400"}`}>
                    {botStatus.toUpperCase()}
                  </span>
                </div>
                <p className="text-2xs text-slate-400 leading-relaxed min-h-[44px]">
                  Streams real tick movements via websocket API and runs virtual order book. Tracks balance PnL.
                </p>
                <div className="flex gap-2">
                  {botStatus === "running" ? (
                    <button
                      onClick={stopLiveBot}
                      className="flex-1 py-2 bg-rose-600/20 hover:bg-rose-600/35 text-rose-300 font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 border border-rose-500/30 shadow-lg transition-transform active:scale-95"
                    >
                      <Square className="h-3.5 w-3.5 stroke-[2.5]" />
                      Safe Halt
                    </button>
                  ) : (
                    <button
                      onClick={startLiveBot}
                      className="flex-1 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 shadow-lg active:scale-95 transition-all"
                    >
                      <Play className="h-3.5 w-3.5 stroke-[2.5]" />
                      Power Up
                    </button>
                  )}
                </div>
              </div>

            </div>
          </div>

          {/* LIVE TICK CHART DISPLAY */}
          <LiveChart
            liveData={liveData}
            botStatus={botStatus}
            stopLossPoints={config?.STOP_LOSS_POINTS}
            takeProfitPoints={config?.TAKE_PROFIT_POINTS}
          />

          {/* DUAL TERMINAL EMULATOR */}
          <div className="flex-1 bg-slate-950 border border-slate-900 rounded-xl overflow-hidden flex flex-col min-h-[380px] max-h-[580px] shadow-xl">
            <div className="p-3 bg-slate-950 border-b border-slate-900 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-indigo-400" />
                <span className="font-mono text-xs font-bold text-slate-300 uppercase tracking-tight">Active Execution console</span>
              </div>
              <div className="flex gap-1 bg-slate-900/60 p-0.5 rounded-lg border border-slate-850 overflow-x-auto">
                <button
                  onClick={() => setTerminalType("optimizer")}
                  className={`px-2.5 py-1 text-[10px] font-mono font-bold rounded-md uppercase tracking-tight transition-colors whitespace-nowrap ${
                    terminalType === "optimizer" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Optimizer Logs
                </button>
                <button
                  onClick={() => setTerminalType("live-bot")}
                  className={`px-2.5 py-1 text-[10px] font-mono font-bold rounded-md uppercase tracking-tight transition-colors whitespace-nowrap ${
                    terminalType === "live-bot" ? "bg-emerald-500 text-slate-950 font-black" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Live Agent
                </button>
                <button
                  onClick={() => setTerminalType("exporter")}
                  className={`px-2.5 py-1 text-[10px] font-mono font-bold rounded-md uppercase tracking-tight transition-colors whitespace-nowrap ${
                    terminalType === "exporter" ? "bg-amber-500 text-slate-950 font-black" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Brain & GitHub
                </button>
              </div>
            </div>

            {/* Output terminal container / Exporter Portal */}
            <div className="flex-1 overflow-auto bg-slate-955 p-3.5 font-mono selection:bg-indigo-500/20">
              {terminalType === "optimizer" && (
                <div className="space-y-1">
                  {optOutput
                    ? optOutput.split("\n").map((line, i) => formatTerminalLine(line, i))
                    : <span className="text-zinc-600 text-xs">Terminal ready. Waiting for optimization grid triggers...</span>}
                  <div ref={optTerminalEndRef} />
                </div>
              )}

              {terminalType === "live-bot" && (
                <div className="space-y-1">
                  {botOutput
                    ? botOutput.split("\n").map((line, i) => formatTerminalLine(line, i))
                    : <span className="text-zinc-600 text-xs">Live socket terminal ready. Start the Bot to load stream indices...</span>}
                  <div ref={botTerminalEndRef} />
                </div>
              )}

              {terminalType === "exporter" && (
                <div className="space-y-5 font-sans text-xs text-slate-300">
                  {/* Top Intro Section */}
                  <div className="bg-slate-900/40 p-4 rounded-lg border border-slate-900 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                      <h4 className="text-sm font-bold text-slate-250 flex items-center gap-1.5 font-mono">
                        <span className="text-amber-400">🤖</span> Deriv Spike Bot "Brain" Exporter
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                        These Python files constitute the algorithmic logic ("the brain") of your bot. Update parameter calibrations on your phone's Termux client, or push code directly to your GitHub repository.
                      </p>
                    </div>
                    <a
                      href="/api/export/zip"
                      className="px-4 py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 text-xs font-bold rounded-lg shadow-lg hover:shadow-amber-500/10 active:scale-95 transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Download className="h-4 w-4 stroke-[2.5]" />
                      Download ZIP Bundle
                    </a>
                  </div>

                  {/* Two Column Layout for Desktop */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 leading-normal">
                    
                    {/* Left Sync Terminal Column (Col 5) */}
                    <div className="lg:col-span-5 space-y-4">
                      {/* One-Click Termux Sync */}
                      <div className="bg-slate-950 border border-slate-900 rounded-lg p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-2xs font-mono font-bold tracking-wider text-amber-400 uppercase flex items-center gap-1.5">
                            <RefreshCw className="h-3 w-3 animate-spin duration-[4s]" /> One-Command Termux Sync
                          </span>
                          <button
                            onClick={() => {
                              const curlCommand = `curl -sSf -L ${window.location.origin}/api/export/sh | bash`;
                              navigator.clipboard.writeText(curlCommand);
                              setCopiedCurl(true);
                              setTimeout(() => setCopiedCurl(false), 2000);
                            }}
                            className="text-[10px] font-mono text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors bg-slate-900/50 px-1.5 py-0.5 rounded border border-slate-800"
                          >
                            <Copy className="h-3 w-3" />
                            {copiedCurl ? "Copied!" : "Copy Curl"}
                          </button>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-normal">
                          Run this command in your Android Termux terminal or local CLI. It will dynamically fetch and overwrite all brain script modules in seconds.
                        </p>
                        <div className="bg-slate-900 border border-slate-850 p-2.5 rounded-md relative select-all scrollbar-thin">
                          <code className="text-[10px] font-mono text-emerald-400 break-all select-all block h-10 overflow-y-auto leading-relaxed">
                            curl -sSf -L {window.location.origin}/api/export/sh | bash
                          </code>
                        </div>
                      </div>

                      {/* GitHub Upload Portal */}
                      <div className="bg-slate-950 border border-slate-900 rounded-lg p-3.5 space-y-3">
                        <span className="text-2xs font-mono font-bold tracking-wider text-indigo-400 uppercase flex items-center gap-1.5">
                          <Github className="h-3.5 w-3.5" /> GitHub Repository Lifter
                        </span>
                        <p className="text-[11px] text-slate-400 leading-normal">
                          Ready to upload your calibrated spike bot to GitHub? Paste your target Git repository URL below to generate exact synchronization commands.
                        </p>
                        <div>
                          <label className="text-[10px] font-mono text-slate-500 block mb-1">Target Repository URL</label>
                          <input
                            type="text"
                            value={githubRepoUrl}
                            onChange={(e) => setGithubRepoUrl(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-850 text-xs py-1.5 px-2 rounded font-mono text-indigo-300 focus:outline-none focus:border-indigo-700"
                            placeholder="https://github.com/YourUsername/your-repo.git"
                          />
                        </div>

                        {/* Sequenced Git Commands */}
                        <div className="space-y-1.5 pt-1">
                          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest block mb-1">Git Push Playbook</span>
                          <div className="bg-slate-900 border border-slate-850 p-2 rounded text-[10px] font-mono text-slate-305 space-y-1 select-all font-semibold leading-relaxed">
                            <div>git init</div>
                            <div>git add .</div>
                            <div>git commit -m "Calibrate Deriv Spike Bot parameters"</div>
                            <div>git branch -M main</div>
                            <div>git remote add origin {githubRepoUrl || "YOUR_REPO_URL"} 2&gt;/dev/null || git remote set-url origin {githubRepoUrl || "YOUR_REPO_URL"}</div>
                            <div>git push -u origin main</div>
                          </div>
                          <button
                            onClick={() => {
                              const gitSuite = `git init\ngit add .\ngit commit -m "Calibrate Deriv Spike Bot parameters"\ngit branch -M main\ngit remote add origin ${githubRepoUrl} 2>/dev/null || git remote set-url origin ${githubRepoUrl}\ngit push -u origin main`;
                              navigator.clipboard.writeText(gitSuite);
                              setCopiedCurl(true);
                              setTimeout(() => setCopiedCurl(false), 2000);
                            }}
                            className="w-full py-1.5 bg-indigo-950/40 hover:bg-indigo-900/40 text-indigo-400 border border-indigo-900/50 rounded text-3xs font-mono font-bold transition-colors uppercase tracking-wider cursor-pointer"
                          >
                            Copy Full Git Payload
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Right File Browser Module (Col 7) */}
                    <div className="lg:col-span-7 flex flex-col bg-slate-950 border border-slate-900 rounded-lg overflow-hidden h-[460px]">
                      
                      {/* Sub-header File Selector Bar */}
                      <div className="p-2.5 bg-slate-950/80 border-b border-slate-900 flex justify-between items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <FileCode className="h-3.5 w-3.5 text-amber-500" />
                          <select
                            value={selectedExportFile}
                            onChange={(e) => setSelectedExportFile(e.target.value)}
                            className="bg-slate-900 border border-slate-850 text-2xs text-slate-205 py-1 px-2 rounded-md font-mono focus:outline-none focus:border-amber-500 cursor-pointer"
                          >
                            {exportFiles.map((file) => (
                              <option key={file.filename} value={file.filename}>
                                {file.filename} ({file.exists ? `${(file.size / 1024).toFixed(1)} KB` : "Missing"})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <a
                            href={`/api/export/file/${selectedExportFile}`}
                            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-3xs font-mono text-slate-300 font-bold rounded transition-colors uppercase tracking-wider flex items-center gap-1 cursor-pointer"
                            title="Download standalone file"
                          >
                            <Download className="h-3 w-3" />
                            Download
                          </a>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(exportFileContent);
                              setCopiedFile(true);
                              setTimeout(() => setCopiedFile(false), 2000);
                            }}
                            className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 text-3xs font-mono font-bold rounded transition-colors uppercase tracking-wider flex items-center gap-1 cursor-pointer"
                          >
                            <Copy className="h-3 w-3" />
                            {copiedFile ? "Copied!" : "Copy"}
                          </button>
                        </div>
                      </div>

                      {/* Code Block Inspector Container */}
                      <div className="flex-1 overflow-auto bg-slate-955 p-3.5 relative">
                        {loadingExportFile ? (
                          <div className="absolute inset-0 flex items-center justify-center bg-slate-955/80 z-20">
                            <RefreshCw className="h-5 w-5 text-amber-400 animate-spin" />
                          </div>
                        ) : null}
                        <pre className="text-3xs font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap selection:bg-amber-500/20">
                          {exportFileContent || "# Selected file is currently empty or loading..."}
                        </pre>
                      </div>
                    </div>

                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── SECTION LEVEL C: METRICS & JOURNAL REPORT (WIDTHCol 3) ── */}
        <section className="xl:col-span-3 flex flex-col gap-6">
          
          {/* PERFORMANCE CARD SCOREBOARD */}
          <div className="bg-slate-955 border border-slate-900/80 p-4 rounded-xl space-y-4">
            <h2 className="font-bold text-xs font-mono tracking-wider text-slate-400 uppercase flex items-center justify-between">
              Session Performance Metrics
              <span className="text-emerald-500 animate-pulse text-[10px]">Real Time</span>
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-900/30 p-2.5 rounded-lg border border-slate-900">
                <span className="text-[10px] font-mono text-slate-500 uppercase">Win Rate %</span>
                <p className="text-2xl font-black text-emerald-400 mt-1 font-mono">
                  {simulatedWinRate ? `${simulatedWinRate.toFixed(1)}%` : "0.0%"}
                </p>
                <div className="w-full bg-slate-900 h-1 rounded mt-2.5 overflow-hidden">
                  <div className="bg-emerald-500 h-1 transition-all duration-500" style={{ width: `${Math.min(simulatedWinRate, 100)}%` }}></div>
                </div>
              </div>
              <div className="bg-slate-900/30 p-2.5 rounded-lg border border-slate-900">
                <span className="text-[10px] font-mono text-zinc-500 uppercase">Net Profit</span>
                <p className={`text-2xl font-black mt-1 font-mono ${simulatedPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {simulatedPnL >= 0 ? "+" : ""}${simulatedPnL.toFixed(2)}
                </p>
                <div className="text-[9px] text-zinc-500 font-mono mt-2">
                  Session Bal: ${config ? config.INITIAL_BALANCE + simulatedPnL : 1000.0}
                </div>
              </div>
              <div className="bg-slate-900/30 p-2.5 rounded-lg border border-slate-900">
                <span className="text-[10px] font-mono text-zinc-500 uppercase">Total Trades</span>
                <p className="text-xl font-bold mt-1 text-slate-300 font-mono">{totalSimTrades} Pos</p>
                <div className="text-[9px] text-slate-500 font-mono mt-1">
                  Wins: {simulatedWins} | Losses: {totalSimTrades - simulatedWins}
                </div>
              </div>
              <div className="bg-slate-900/30 p-2.5 rounded-lg border border-slate-900 flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-mono text-zinc-500 uppercase">Optimizer Best Score</span>
                  <p className="text-lg font-bold text-indigo-400 mt-0.5 font-mono">
                    {metrics?.optimization_report?.score ? metrics.optimization_report.score.toFixed(1) : "0.0"}/100
                  </p>
                </div>
                {metrics?.optimization_report?.report?.profit_factor && (
                  <span className="text-[9px] text-zinc-500 font-mono mt-0.5">
                    PF: {metrics.optimization_report.report?.profit_factor?.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* LEDGER TRADE JOURNAL TABLE */}
          <div className="flex-1 bg-slate-950 border border-slate-900 p-4 rounded-xl flex flex-col overflow-hidden min-h-[300px] max-h-[500px]">
            <h2 className="font-bold text-xs font-mono text-slate-300 uppercase tracking-widest flex items-center justify-between border-b border-slate-900 pb-2.5 mb-3">
              <span className="flex items-center gap-1.5"><History className="h-3.5 w-3.5 text-indigo-400" /> Virtual Trade Ledger</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClearTrades}
                  className={`px-2 py-0.5 border rounded font-bold text-[10px] transition-all cursor-pointer ${
                    confirmClear 
                      ? "bg-rose-600 hover:bg-rose-500 text-white border-rose-500 animate-pulse" 
                      : "bg-rose-950/40 hover:bg-rose-900/40 text-rose-400 hover:text-rose-300 border-rose-900/60"
                  }`}
                >
                  {confirmClear ? "Sure?" : "Clear Log"}
                </button>
                <span className="text-slate-500 text-[10px] font-mono">Last {trades.length}</span>
              </div>
            </h2>

            <div className="flex-1 overflow-y-auto space-y-2">
              {trades.length === 0 ? (
                <div className="h-36 flex flex-col items-center justify-center text-center p-4">
                  <AlertTriangle className="h-5 w-5 text-zinc-600 mb-2" />
                  <span className="text-2xs font-mono text-zinc-500">No trading records found inside this session log directory.</span>
                </div>
              ) : (
                trades.map((trade, i) => (
                  <div
                    key={trade.trade_id || i}
                    className="p-3 bg-slate-900/20 border border-slate-900 hover:border-slate-800 rounded-lg flex justify-between items-center gap-3 transition-colors text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded font-mono ${trade.direction === "BUY" ? "bg-emerald-950 text-emerald-400" : "bg-rose-950 text-rose-400"}`}>
                          {trade.direction}
                        </span>
                        <span className="text-slate-300 font-mono text-2xs font-bold">{trade.symbol}</span>
                      </div>
                      <p className="text-[10px] text-zinc-500 font-mono">
                        {trade.entry_price?.toFixed(2)} &rarr; {trade.exit_price?.toFixed(2)} &bull; {trade.ticks_held}tk
                      </p>
                      <span className="text-zinc-600 text-3xs font-mono select-none block">
                        Reason: {trade.exit_reason || "timeout"}
                      </span>
                    </div>

                    <div className="text-right">
                      <p className={`font-mono font-black ${trade.pnl > 0 ? "text-green-400" : "text-rose-400"}`}>
                        {trade.pnl > 0 ? "+" : ""}{trade.pnl?.toFixed(2)}
                      </p>
                      <span className="text-[9px] text-zinc-500 font-mono">
                        Bal: ${trade.balance?.toFixed(1)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>

      {/* ── STATS AND CALIBRATIONS EXPLAINER SECTION ── */}
      <footer className="border-t border-slate-900/80 bg-slate-950/80 text-xs px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-3">
        <div className="text-slate-500 flex items-center gap-1.5">
          <FileCode className="h-4 w-4 text-zinc-500" />
          <span>Flashed configuration files reside in <code className="text-zinc-400 font-mono">local_repo/config.py</code>. Package them natively into Android WebView wrappers.</span>
        </div>
        <div className="text-slate-500 font-mono text-[10px]">
          &bull; COMPLYING SECURELY WITH ALL RUNTIME CONTAINER BOUNDS &bull;
        </div>
      </footer>

      {/* ── TOAST OVERLAY NOTIFICATIONS PANEL ── */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => {
          let bgClass = "bg-slate-955/95 border-sky-500/30 text-sky-200 shadow-sky-500/5";
          let iconColor = "text-sky-400";

          if (toast.type === "success") {
            bgClass = "bg-emerald-955/95 border-emerald-500/35 text-emerald-250 shadow-emerald-500/5";
            iconColor = "text-emerald-400";
          } else if (toast.type === "warning") {
            bgClass = "bg-rose-955/95 border-rose-500/35 text-rose-250 shadow-rose-500/5";
            iconColor = "text-rose-450";
          } else if (toast.type === "error") {
            bgClass = "bg-red-955/95 border-red-500/34 text-red-250 shadow-red-500/5";
            iconColor = "text-red-400";
          }

          return (
            <div
              key={toast.id}
              className={`p-4 rounded-xl border border-solid backdrop-blur-md shadow-2xl flex items-start gap-3 pointer-events-auto ${bgClass} animate-slide-in`}
              style={{
                boxShadow: "0 10px 30px -10px rgba(0,0,0,0.5)",
              }}
            >
              <div className="mt-0.5 shrink-0">
                {toast.type === "success" ? (
                  <CheckCircle className={`h-4 w-4 ${iconColor}`} />
                ) : toast.type === "warning" || toast.type === "error" ? (
                  <AlertTriangle className={`h-4 w-4 ${iconColor}`} />
                ) : (
                  <Activity className={`h-4 w-4 ${iconColor}`} />
                )}
              </div>
              <div className="flex-1">
                <p className="text-[11px] font-mono leading-relaxed font-semibold">
                  {toast.message}
                </p>
              </div>
              <button
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0 text-3xs font-serif font-black ml-1 bg-slate-900/40 hover:bg-slate-850 border border-slate-800 rounded px-1"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
