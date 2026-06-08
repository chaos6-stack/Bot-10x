import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Settings, TrendingUp, Play, Square, RefreshCw, Sliders,
  DollarSign, Terminal, Activity, Download, AlertTriangle,
  History, FileCode, CheckCircle, XCircle, Copy, Github,
  Upload, Edit3, Save, RotateCcw, Zap, ShieldAlert, Target,
  BarChart2, ChevronRight, AlertCircle,
} from "lucide-react";
import { StrategyConfig, TradeRecord } from "./types";
import LiveChart from "./components/LiveChart";

// ─── Zone colour helper ────────────────────────────────────────────────────
function zoneColor(zone: string) {
  switch (zone) {
    case "RECOVERY": return "text-rose-400";
    case "BUILDING": return "text-sky-400";
    case "HOT":      return "text-amber-400";
    case "OVERDUE":  return "text-purple-400";
    default:         return "text-slate-400";
  }
}
function zoneBg(zone: string) {
  switch (zone) {
    case "RECOVERY": return "bg-rose-500";
    case "BUILDING": return "bg-sky-500";
    case "HOT":      return "bg-amber-500";
    case "OVERDUE":  return "bg-purple-500";
    default:         return "bg-slate-600";
  }
}

export default function App() {
  // ── CORE DATA ──
  const [config, setConfig]               = useState<StrategyConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [saveStatus, setSaveStatus]       = useState<"idle"|"saving"|"saved"|"error">("idle");

  // ── TOAST ──
  interface Toast { id: string; message: string; type: "success"|"error"|"info"|"warning"; }
  const [toasts, setToasts] = useState<Toast[]>([]);
  const addToast = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 5000);
  }, []);

  // ── LIVE DATA ──
  const [liveData, setLiveData] = useState<{
    symbol: string; ticks: any[]; candles?: any[];
    active_trade: any | null; balance: number; is_fallback?: boolean;
  }>({ symbol: "", ticks: [], active_trade: null, balance: 50.0 });

  const prevActiveTradeIdRef = useRef<string | null>(null);
  const prevTradesCountRef   = useRef<number>(0);

  // ── PROCESS STATE ──
  const [optStatus, setOptStatus] = useState("idle");
  const [optOutput, setOptOutput] = useState("");
  const [optSymbol, setOptSymbol] = useState("BOOM1000");
  const [botStatus, setBotStatus] = useState("idle");
  const [botOutput, setBotOutput] = useState("");

  // ── TRADE / METRICS ──
  const [trades,  setTrades]  = useState<TradeRecord[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmStopBot, setConfirmStopBot] = useState(false);

  // ── TABS ──
  const [activeTab,     setActiveTab]     = useState<"general"|"strategy"|"cycle"|"weights"|"martingale">("general");
  const [terminalType,  setTerminalType]  = useState<"optimizer"|"live-bot"|"exporter">("optimizer");
  const [rightPanelTab, setRightPanelTab] = useState<"stats"|"optimizer-result">("stats");

  // ── FILE EDITOR ──
  const [exportFiles,      setExportFiles]      = useState<Array<{filename:string;exists:boolean;size:number}>>([]);
  const [selectedFile,     setSelectedFile]      = useState("config.py");
  const [fileContent,      setFileContent]       = useState("");
  const [editedContent,    setEditedContent]     = useState("");
  const [loadingFile,      setLoadingFile]       = useState(false);
  const [fileSaveStatus,   setFileSaveStatus]    = useState<"idle"|"saving"|"saved"|"error">("idle");
  const [isEditing,        setIsEditing]         = useState(false);
  const [uploadStatus,     setUploadStatus]      = useState<"idle"|"uploading"|"done"|"error">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── MULTI-SYMBOL ──
  const ALL_SYMBOLS = ["BOOM1000","CRASH1000","BOOM500","CRASH500"];
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(["BOOM1000"]);
  const [botActiveSymbols, setBotActiveSymbols] = useState<string[]>([]);

  const toggleSymbol = (sym: string) => {
    setSelectedSymbols(prev => {
      if (prev.includes(sym)) {
        if (prev.length === 1) return prev; // always keep at least one
        return prev.filter(s => s !== sym);
      }
      if (prev.length >= 4) return prev; // max 4
      return [...prev, sym];
    });
  };

  // ── MISC ──
  const [copiedCurl,    setCopiedCurl]    = useState(false);
  const [githubRepoUrl, setGithubRepoUrl] = useState("https://github.com/Username/deriv-spike-bot-brain.git");
  const optTerminalEndRef = useRef<HTMLDivElement>(null);
  const botTerminalEndRef = useRef<HTMLDivElement>(null);

  // ─────────────────────────────────────────────────────────────────────────
  //  DATA FETCHERS
  // ─────────────────────────────────────────────────────────────────────────

  const fetchConfig = async () => {
    try {
      setLoadingConfig(true);
      const data = await fetch("/api/config").then(r => r.json());
      setConfig(data);
    } catch { } finally { setLoadingConfig(false); }
  };

  const fetchTrades = async () => {
    try {
      const data = await fetch("/api/trades").then(r => r.json());
      if (Array.isArray(data)) setTrades([...data].reverse());
    } catch { }
  };

  const fetchMetrics = async () => {
    try {
      const data = await fetch("/api/metrics").then(r => r.json());
      setMetrics(data);
    } catch { }
  };

  const fetchTicks = async () => {
    try {
      const data = await fetch("/api/ticks").then(r => r.json());
      setLiveData(data);
    } catch { }
  };

  const checkOptimizerStatus = async () => {
    try {
      const data = await fetch("/api/optimize/status").then(r => r.json());
      setOptStatus(data.status); setOptOutput(data.output); setOptSymbol(data.symbol);
    } catch { }
  };

  const checkBotStatus = async () => {
    try {
      const data = await fetch("/api/bot/status").then(r => r.json());
      setBotStatus(data.status); setBotOutput(data.output);
      if (data.symbols) setBotActiveSymbols(data.symbols);
    } catch { }
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  EFFECTS
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchConfig(); fetchTrades(); fetchMetrics(); fetchTicks();
    const fast = setInterval(() => { checkOptimizerStatus(); checkBotStatus(); fetchTicks(); }, 1500);
    const slow = setInterval(() => { fetchTrades(); fetchMetrics(); }, 5000);
    return () => { clearInterval(fast); clearInterval(slow); };
  }, []);

  useEffect(() => {
    if (!liveData?.ticks?.length) return;
    const activeTrade = liveData.active_trade;
    const prevId = prevActiveTradeIdRef.current;
    if (activeTrade && (!prevId || activeTrade.trade_id !== prevId)) {
      addToast(`🚀 OPENED ${activeTrade.direction} ${liveData.symbol} @ ${activeTrade.entry_price.toFixed(3)}`, "info");
      prevActiveTradeIdRef.current = activeTrade.trade_id;
    } else if (!activeTrade && prevId) {
      fetchTrades(); fetchMetrics();
      prevActiveTradeIdRef.current = null;
    }
  }, [liveData, addToast]);

  useEffect(() => {
    if (trades.length > 0 && prevTradesCountRef.current > 0 && trades.length > prevTradesCountRef.current) {
      const t = trades[0];
      if (t) {
        const win = t.pnl > 0;
        addToast(
          `🏁 CLOSED ${t.direction} ${t.symbol} | ${win ? "+" : ""}$${t.pnl.toFixed(2)} (${win ? "WIN 🟢" : "LOSS 🔴"}) | ${t.exit_reason || "timeout"}`,
          win ? "success" : "warning"
        );
      }
    }
    prevTradesCountRef.current = trades.length;
  }, [trades, addToast]);

  useEffect(() => {
    if (terminalType === "optimizer") optTerminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
    else if (terminalType === "live-bot") botTerminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [optOutput, botOutput, terminalType]);

  useEffect(() => {
    if (terminalType === "exporter") {
      fetchExportFiles();
      fetchFileContent(selectedFile);
    }
  }, [terminalType, selectedFile]);

  // ─────────────────────────────────────────────────────────────────────────
  //  FILE EDITOR ACTIONS
  // ─────────────────────────────────────────────────────────────────────────

  const fetchExportFiles = async () => {
    try {
      const data = await fetch("/api/export/files").then(r => r.json());
      if (Array.isArray(data)) setExportFiles(data);
    } catch { }
  };

  const fetchFileContent = async (filename: string) => {
    try {
      setLoadingFile(true);
      setIsEditing(false);
      const text = await fetch(`/api/files/read/${filename}`).then(r => r.text());
      setFileContent(text);
      setEditedContent(text);
    } catch { setFileContent("# Error loading file"); setEditedContent("# Error loading file"); }
    finally { setLoadingFile(false); }
  };

  const saveFileContent = async () => {
    try {
      setFileSaveStatus("saving");
      const res = await fetch(`/api/files/write/${selectedFile}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editedContent }),
      });
      if (res.ok) {
        setFileContent(editedContent);
        setFileSaveStatus("saved");
        setIsEditing(false);
        addToast(`✅ ${selectedFile} saved. Restart the bot to apply.`, "success");
        setTimeout(() => setFileSaveStatus("idle"), 3000);
        if (selectedFile === "config.py") fetchConfig();
      } else {
        setFileSaveStatus("error");
        addToast(`Failed to save ${selectedFile}`, "error");
      }
    } catch { setFileSaveStatus("error"); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadStatus("uploading");
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/files/upload", { method: "POST", body: form });
      if (res.ok) {
        setUploadStatus("done");
        addToast(`✅ ${file.name} uploaded successfully. Restart the bot to apply.`, "success");
        fetchExportFiles();
        if (selectedFile === file.name) fetchFileContent(file.name);
        setTimeout(() => setUploadStatus("idle"), 3000);
      } else {
        const err = await res.json();
        setUploadStatus("error");
        addToast(`Upload failed: ${err.error}`, "error");
      }
    } catch { setUploadStatus("error"); addToast("Upload failed", "error"); }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  CONFIG ACTIONS
  // ─────────────────────────────────────────────────────────────────────────

  const handleInputChange = (key: keyof StrategyConfig, value: any) => {
    if (!config) return;
    setConfig({ ...config, [key]: value });
    setSaveStatus("idle");
  };

  const handleSaveConfig = async (configToSave = config) => {
    if (!configToSave) return;
    try {
      setSaveStatus("saving");
      const res = await fetch("/api/config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configToSave),
      });
      if (res.ok) {
        const result = await res.json();
        setConfig(result.data);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 3000);
      } else { setSaveStatus("error"); }
    } catch { setSaveStatus("error"); }
  };

  const selectActiveSymbol = async (symbol: string) => {
    if (!config) return;
    const updated = { ...config, ACTIVE_SYMBOL: symbol };
    setConfig(updated);
    try {
      setSaveStatus("saving");
      const res = await fetch("/api/config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        const result = await res.json();
        setConfig(result.data);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);

        // If bot is running, restart it with the new symbol automatically
        if (botStatus === "running") {
          addToast(`Switching stream to ${symbol} — restarting bot...`, "info");
          await fetch("/api/bot/restart", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol }),
          });
          setTimeout(checkBotStatus, 1200);
        } else {
          addToast(`Symbol saved: ${symbol}. Start the bot to stream it.`, "success");
        }
      } else { setSaveStatus("error"); }
    } catch { setSaveStatus("error"); }
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  BOT / OPTIMIZER CONTROLS
  // ─────────────────────────────────────────────────────────────────────────

  const startOptimizer = async () => {
    setTerminalType("optimizer");
    setOptOutput("Initiating 3-stage grid search...");
    await fetch("/api/optimize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: config?.ACTIVE_SYMBOL || "BOOM1000" }),
    });
    checkOptimizerStatus();
  };

  const stopOptimizer = async () => {
    await fetch("/api/optimize/stop", { method: "POST" });
    checkOptimizerStatus();
  };

  const startLiveBot = async () => {
    setTerminalType("live-bot");
    setBotOutput(`Starting streams for: ${selectedSymbols.join(" + ")}...`);
    await fetch("/api/bot/start", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: selectedSymbols }),
    });
    checkBotStatus();
  };

  const stopLiveBot = async () => {
    setConfirmStopBot(false);
    await fetch("/api/bot/stop", { method: "POST" });
    checkBotStatus();
  };

  const handleClearTrades = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3050);
      return;
    }
    const res = await fetch("/api/trades/clear", { method: "POST" });
    if (res.ok) { setTrades([]); setMetrics(null); setConfirmClear(false); }
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  STATS
  // ─────────────────────────────────────────────────────────────────────────

  const totalTrades    = trades.length;
  const wins           = trades.filter(t => t.pnl > 0).length;
  const winRate        = totalTrades ? (wins / totalTrades) * 100 : 0;
  const totalPnL       = trades.reduce((a, t) => a + t.pnl, 0);
  const liveBalance    = liveData.balance ?? 50.0;
  const botMetrics     = metrics?.bot_metrics ?? {};
  const optReport      = metrics?.optimization_report ?? {};

  // Live tick analytics from latest tick
  const latestTick     = liveData.ticks?.[liveData.ticks.length - 1] ?? null;
  const cycleZone      = latestTick?.cycle_zone ?? "UNKNOWN";
  const ticksSinceSpike = liveData.ticks?.reduce((acc: number, t: any) => {
    if (t.cycle_zone) return acc; return acc;
  }, 0) ?? 0;

  // Read spike_probability_pct from the latest live_ticks payload if present
  const latestSpikePct: number = (liveData as any).spike_probability_pct ?? 0;
  const latestConfidence: number = (liveData as any).confidence_score ?? 0;
  const latestCyclePos: number = (liveData as any).cycle_position ?? 0;
  const latestTicksSinceSpike: number = (liveData as any).ticks_since_spike ?? 0;

  // ─────────────────────────────────────────────────────────────────────────
  //  WEIGHT NORMALIZATION HELPER
  // ─────────────────────────────────────────────────────────────────────────

  const weightsSum = config
    ? +(config.WEIGHT_CYCLE + config.WEIGHT_COMPRESSION + config.WEIGHT_ENERGY).toFixed(3)
    : 1.0;
  const weightsSumOk = Math.abs(weightsSum - 1.0) < 0.01;

  // ─────────────────────────────────────────────────────────────────────────
  //  TERMINAL LINE FORMATTER
  // ─────────────────────────────────────────────────────────────────────────

  const formatTerminalLine = (line: string, index: number) => {
    if (!line.trim()) return null;
    let cls = "text-sky-300";
    if (line.includes("OPENED"))                           cls = "text-emerald-400 font-semibold";
    else if (line.includes("CLOSED [WIN"))                 cls = "text-green-400 font-bold bg-green-950/20 px-1 rounded";
    else if (line.includes("CLOSED [LOSS"))                cls = "text-rose-400 font-bold bg-rose-950/20 px-1 rounded";
    else if (line.includes("[OVERDUE]") || line.includes("CYCLE OVERDUE")) cls = "text-purple-400 font-bold";
    else if (line.includes("[HOT]"))                       cls = "text-amber-400 font-semibold";
    else if (line.includes("[RECOVERY]"))                  cls = "text-rose-400";
    else if (line.includes("[BUILDING]"))                  cls = "text-sky-400";
    else if (line.includes("WARNING") || line.includes("Blocked")) cls = "text-amber-400";
    else if (line.includes("[ERROR]"))                     cls = "text-rose-500 font-semibold";
    else if (line.includes("[STAGE") || line.includes("FINAL RESULT")) cls = "text-purple-400 font-bold";
    else if (line.includes("best so far") || line.includes("Validated")) cls = "text-emerald-300";
    else if (line.includes("Authenticated"))               cls = "text-emerald-400 font-bold";
    else if (line.includes("[STREAM]"))                    cls = "text-teal-400";
    return (
      <div key={index} className={`font-mono text-xs py-0.5 leading-relaxed ${cls}`}>
        <span className="text-zinc-600 select-none mr-2">{String(index + 1).padStart(3, "0")} |</span>
        {line}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500/30">

      {/* ── TOAST CONTAINER ── */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map(t => (
          <div key={t.id} className={`px-4 py-2.5 rounded-lg text-xs font-mono shadow-xl border backdrop-blur-sm animate-in slide-in-from-right-4
            ${t.type === "success" ? "bg-emerald-950/90 border-emerald-700 text-emerald-300"
            : t.type === "error"   ? "bg-rose-950/90 border-rose-700 text-rose-300"
            : t.type === "warning" ? "bg-amber-950/90 border-amber-700 text-amber-300"
            : "bg-slate-900/90 border-slate-700 text-slate-300"}`}>
            {t.message}
          </div>
        ))}
      </div>

      {/* ── STOP BOT CONFIRMATION MODAL ── */}
      {confirmStopBot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-rose-800/60 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="h-5 w-5 text-rose-400" />
              <span className="font-bold text-slate-100">Stop Live Bot?</span>
            </div>
            <p className="text-xs text-slate-400 mb-5 leading-relaxed">
              This will immediately terminate the bot process. Any open paper trade will be abandoned without a formal close. Are you sure?
            </p>
            <div className="flex gap-3">
              <button onClick={stopLiveBot}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-lg transition-colors">
                Yes, Stop Bot
              </button>
              <button onClick={() => setConfirmStopBot(false)}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-lg transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── HEADER ── */}
      <header className="border-b border-slate-900 bg-slate-950/90 backdrop-blur-md sticky top-0 z-40 px-6 py-3 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-tr from-emerald-500 to-teal-400 rounded-xl shadow-lg shadow-emerald-500/10">
            <TrendingUp className="h-5 w-5 text-slate-950 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              SynthiSpike AI Agent
            </h1>
            <p className="text-[10px] text-slate-500 font-mono tracking-wider">
              DERIV SPIKE BRAIN v4.0 &bull; PAPER TRADING
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Live balance */}
          <div className="flex items-center gap-1.5 bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-800">
            <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-xs font-mono font-bold text-emerald-400">${liveBalance.toFixed(2)}</span>
            <span className="text-[10px] text-slate-500 font-mono">balance</span>
          </div>

          {/* Bot status */}
          <div className="flex items-center gap-2 bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-800">
            <span className="flex h-2.5 w-2.5 relative">
              {botStatus === "running" && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${botStatus === "running" ? "bg-emerald-500" : "bg-slate-600"}`} />
            </span>
            <span className="text-xs font-mono">
              Bot: <span className={botStatus === "running" ? "text-emerald-400 font-bold" : "text-slate-400"}>{botStatus.toUpperCase()}</span>
            </span>
          </div>

          {/* Optimizer status */}
          <div className="flex items-center gap-2 bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-800">
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${optStatus === "running" ? "bg-indigo-500 animate-pulse" : "bg-slate-600"}`} />
            <span className="text-xs font-mono">
              Opt: <span className={optStatus === "running" ? "text-indigo-400 font-bold" : "text-slate-400"}>{optStatus.toUpperCase()}</span>
            </span>
          </div>

          {/* Fallback warning */}
          {liveData.is_fallback && (
            <div className="flex items-center gap-1.5 bg-amber-950/60 px-3 py-1.5 rounded-lg border border-amber-700/60 animate-pulse">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-xs font-mono text-amber-400 font-bold">SIMULATION — NOT LIVE</span>
            </div>
          )}
        </div>
      </header>

      {/* ── MAIN GRID ── */}
      <main className="flex-1 p-4 grid grid-cols-1 xl:grid-cols-12 gap-4 max-w-[1920px] mx-auto w-full">

        {/* ═══ LEFT COLUMN: Config Editor (col-span-3) ═══ */}
        <section className="xl:col-span-3 flex flex-col bg-slate-950 border border-slate-900 rounded-xl overflow-hidden shadow-xl">
          <div className="p-3 bg-slate-950/60 border-b border-slate-900 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-emerald-400" />
              <span className="font-bold text-xs text-slate-200">Configuration</span>
            </div>
            <div className="text-[10px] font-mono">
              {saveStatus === "saving" && <span className="text-yellow-400">Saving...</span>}
              {saveStatus === "saved"  && <span className="text-emerald-400 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Saved!</span>}
              {saveStatus === "error"  && <span className="text-rose-400 flex items-center gap-1"><XCircle className="h-3 w-3" /> Error</span>}
            </div>
          </div>

          {/* Config Tabs */}
          <div className="grid grid-cols-5 border-b border-slate-900/50 bg-slate-950">
            {(["general","strategy","cycle","weights","martingale"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`py-2.5 text-[9px] font-mono font-bold uppercase tracking-tight border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-emerald-500 text-emerald-400 bg-emerald-500/5"
                    : "border-transparent text-slate-500 hover:text-slate-300"
                }`}>
                {tab}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4 max-h-[700px]">
            {loadingConfig ? (
              <div className="h-40 flex items-center justify-center">
                <RefreshCw className="h-5 w-5 text-emerald-400 animate-spin" />
              </div>
            ) : config ? (
              <>
                {/* ── TAB: GENERAL ── */}
                {activeTab === "general" && (
                  <div className="space-y-4">
                    {/* Symbol selector */}
                    <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-900/80 space-y-2">
                      <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Active Symbol</h3>
                      <div className="grid grid-cols-2 gap-1.5">
                        {[
                          { s: "BOOM1000",  l: "BOOM 1000",  d: "~1 spike/16m" },
                          { s: "CRASH1000", l: "CRASH 1000", d: "~1 spike/16m" },
                          { s: "BOOM500",   l: "BOOM 500",   d: "~1 spike/8m"  },
                          { s: "CRASH500",  l: "CRASH 500",  d: "~1 spike/8m"  },
                        ].map(item => {
                          const active = config.ACTIVE_SYMBOL === item.s;
                          return (
                            <button key={item.s} onClick={() => selectActiveSymbol(item.s)}
                              className={`py-2 px-1 rounded-lg border font-mono text-center transition-all flex flex-col items-center gap-0.5 ${
                                active
                                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/50 ring-1 ring-emerald-500/30 font-bold"
                                  : "bg-slate-950/60 text-slate-500 border-slate-800 hover:border-slate-700 hover:text-slate-300"
                              }`}>
                              <span className="text-[9px] font-black uppercase">{item.l}</span>
                              <span className="text-[8px] opacity-60">{item.d}</span>
                            </button>
                          );
                        })}
                      </div>
                      {botStatus === "running" && (
                        <p className="text-[9px] text-amber-400 font-mono bg-amber-950/20 px-2 py-1 rounded border border-amber-900/40">
                          ⚡ Bot is running — switching symbol will auto-restart the stream.
                        </p>
                      )}
                    </div>

                    {/* ── Multi-symbol monitor ── */}
                    <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-900/80 space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Multi-Symbol Mode</h3>
                        <span className="text-[9px] font-mono text-slate-500">{selectedSymbols.length}/4 selected</span>
                      </div>
                      <p className="text-[9px] text-slate-500 font-mono leading-relaxed">
                        Select 1–4 indices to monitor simultaneously. Bot opens trades on whichever has the best signal.
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {ALL_SYMBOLS.map(sym => {
                          const on = selectedSymbols.includes(sym);
                          const isBoom = sym.startsWith("BOOM");
                          return (
                            <button key={sym} onClick={() => toggleSymbol(sym)}
                              className={`py-2 px-1.5 rounded-lg border font-mono text-center transition-all flex items-center gap-1.5 ${
                                on
                                  ? isBoom
                                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/50 ring-1 ring-emerald-500/30"
                                    : "bg-rose-500/10 text-rose-300 border-rose-500/50 ring-1 ring-rose-500/30"
                                  : "bg-slate-950/60 text-slate-600 border-slate-800 hover:border-slate-700 hover:text-slate-400"
                              }`}>
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${on ? (isBoom ? "bg-emerald-400" : "bg-rose-400") : "bg-slate-700"}`} />
                              <div className="flex flex-col items-start">
                                <span className="text-[9px] font-black uppercase leading-none">{sym.replace("1000","1K").replace("500","500")}</span>
                                <span className="text-[8px] opacity-60">{sym.includes("1000") ? "~1/16m" : "~1/8m"}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      {botStatus === "running" && botActiveSymbols.length > 0 && (
                        <div className="text-[9px] font-mono text-emerald-400 bg-emerald-950/20 px-2 py-1 rounded border border-emerald-900/40">
                          ● Active: {botActiveSymbols.join(" + ")}
                        </div>
                      )}
                      {botStatus !== "running" && selectedSymbols.length > 1 && (
                        <p className="text-[9px] text-sky-400 font-mono">
                          ℹ Start the bot to monitor {selectedSymbols.length} symbols simultaneously.
                        </p>
                      )}
                    </div>

                    {/* Data mode */}
                    <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-900/80 space-y-2">
                      <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Data Feed</h3>
                      <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800">
                        <button onClick={() => handleInputChange("FORCE_LIVE_WS", true)}
                          className={`flex-1 py-1.5 px-2 text-[9px] font-mono rounded font-bold transition-all ${
                            config.FORCE_LIVE_WS !== false
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                              : "text-slate-500 border border-transparent"
                          }`}>
                          ● LIVE DERIV
                        </button>
                        <button onClick={() => handleInputChange("FORCE_LIVE_WS", false)}
                          className={`flex-1 py-1.5 px-2 text-[9px] font-mono rounded font-bold transition-all ${
                            config.FORCE_LIVE_WS === false
                              ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                              : "text-slate-500 border border-transparent"
                          }`}>
                          ◌ SIMULATION
                        </button>
                      </div>
                      {config.FORCE_LIVE_WS === false && (
                        <p className="text-[9px] text-amber-400 font-mono">⚠ Simulation mode: prices are synthetic, not from Deriv.</p>
                      )}
                    </div>

                    {/* Risk */}
                    <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-900/80 space-y-3">
                      <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Risk Management</h3>
                      {([
                        ["MAX_DAILY_LOSS",       "Max Daily Loss ($)",      0.5, 200,  0.5],
                        ["MAX_DRAWDOWN_PCT",      "Max Drawdown (%)",        0.05,0.5, 0.05],
                        ["MAX_TRADES_PER_SESSION","Max Trades / Session",    5,   200, 5],
                        ["COOLDOWN_AFTER_LOSS_STREAK","Cooldown Streak",     2,   10,  1],
                        ["COOLDOWN_MINUTES",      "Cooldown Duration (min)", 1,   60,  1],
                        ["INITIAL_BALANCE",       "Starting Balance ($)",    10,  1000,10],
                      ] as [keyof StrategyConfig, string, number, number, number][]).map(([k, label, min, max, step]) => (
                        <label key={k} className="block">
                          <div className="flex justify-between text-[10px] font-mono mb-1">
                            <span className="text-slate-400">{label}</span>
                            <span className="text-emerald-400 font-bold">{config[k] as any}</span>
                          </div>
                          <input type="number" min={min} max={max} step={step}
                            value={config[k] as any}
                            onChange={e => handleInputChange(k, k === "MAX_TRADES_PER_SESSION" || k === "COOLDOWN_AFTER_LOSS_STREAK" || k === "COOLDOWN_MINUTES"
                              ? parseInt(e.target.value) : parseFloat(e.target.value))}
                            className="w-full bg-slate-900 border border-slate-800 text-xs py-1 px-2 rounded font-mono text-emerald-300 focus:outline-none focus:border-emerald-600" />
                        </label>
                      ))}
                    </div>

                    {/* Lot sizing */}
                    <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-900/80 space-y-3">
                      <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Lot Sizing</h3>
                      {([
                        ["DEFAULT_LOT_SIZE","Default Lot Size", 0.01, 10, 0.01],
                        ["MIN_LOT_SIZE",    "Min Lot Size",     0.01, 5,  0.01],
                      ] as [keyof StrategyConfig, string, number, number, number][]).map(([k, label, min, max, step]) => (
                        <label key={k} className="block">
                          <div className="flex justify-between text-[10px] font-mono mb-1">
                            <span className="text-slate-400">{label}</span>
                            <span className="text-emerald-400 font-bold">{config[k] as any}</span>
                          </div>
                          <input type="number" min={min} max={max} step={step}
                            value={config[k] as any}
                            onChange={e => handleInputChange(k, parseFloat(e.target.value))}
                            className="w-full bg-slate-900 border border-slate-800 text-xs py-1 px-2 rounded font-mono text-emerald-300 focus:outline-none focus:border-emerald-600" />
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── TAB: STRATEGY ── */}
                {activeTab === "strategy" && (
                  <div className="space-y-4">
                    <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-900/80 space-y-3">
                      <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Exit Parameters</h3>
                      {([
                        ["BOOM_EXIT_TICKS",      "BOOM Exit Ticks",      10, 300, 10],
                        ["CRASH_EXIT_TICKS",     "CRASH Exit Ticks",     10, 300, 10],
                        ["STOP_LOSS_POINTS",     "Stop Loss (pts)",      0.5,20, 0.5],
                        ["TAKE_PROFIT_POINTS",   "Take Profit (pts)",    2,  100,0.5],
                        ["POST_TRADE_COOLDOWN_TICKS","Post-Trade Cooldown (ticks)",10,200,10],
                      ] as [keyof StrategyConfig, string, number, number, number][]).map(([k,label,min,max,step]) => (
                        <label key={k} className="block">
                          <div className="flex justify-between text-[10px] font-mono mb-1">
                            <span className="text-slate-400">{label}</span>
                            <span className="text-emerald-400 font-bold">{config[k] as any}</span>
                          </div>
                          <input type="number" min={min} max={max} step={step}
                            value={config[k] as any}
                            onChange={e => handleInputChange(k,
                              k === "BOOM_EXIT_TICKS" || k === "CRASH_EXIT_TICKS" || k === "POST_TRADE_COOLDOWN_TICKS"
                                ? parseInt(e.target.value) : parseFloat(e.target.value))}
                            className="w-full bg-slate-900 border border-slate-800 text-xs py-1 px-2 rounded font-mono text-emerald-300 focus:outline-none focus:border-emerald-600" />
                        </label>
                      ))}
                    </div>

                    <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-900/80 space-y-3">
                      <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Entry Threshold</h3>
                      <label className="block">
                        <div className="flex justify-between text-[10px] font-mono mb-1">
                          <span className="text-slate-400">Score Threshold</span>
                          <span className="text-emerald-400 font-bold">{config.ENTRY_SCORE_THRESHOLD}</span>
                        </div>
                        <input type="range" min="0.20" max="0.80" step="0.01"
                          value={config.ENTRY_SCORE_THRESHOLD}
                          onChange={e => handleInputChange("ENTRY_SCORE_THRESHOLD", parseFloat(e.target.value))}
                          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                        <div className="flex justify-between text-[9px] text-slate-600 font-mono mt-0.5">
                          <span>0.20 (loose)</span><span>0.80 (tight)</span>
                        </div>
                      </label>
                      <label className="block">
                        <div className="flex justify-between text-[10px] font-mono mb-1">
                          <span className="text-slate-400">Spike Threshold Factor</span>
                          <span className="text-emerald-400 font-bold">{config.SPIKE_THRESHOLD_FACTOR}</span>
                        </div>
                        <input type="number" min="1.5" max="6" step="0.1"
                          value={config.SPIKE_THRESHOLD_FACTOR}
                          onChange={e => handleInputChange("SPIKE_THRESHOLD_FACTOR", parseFloat(e.target.value))}
                          className="w-full bg-slate-900 border border-slate-800 text-xs py-1 px-2 rounded font-mono text-emerald-300 focus:outline-none focus:border-emerald-600" />
                      </label>
                    </div>

                    {/* Trade Against Spikes */}
                    <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-900/80 space-y-3">
                      <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Counter-Spike Trading</h3>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-slate-400">Trade Against Spikes (RECOVERY drift)</span>
                        <button onClick={() => handleInputChange("TRADE_AGAINST_SPIKES", !config.TRADE_AGAINST_SPIKES)}
                          className={`w-10 h-5 rounded-full transition-colors relative ${config.TRADE_AGAINST_SPIKES ? "bg-emerald-500" : "bg-slate-700"}`}>
                          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${config.TRADE_AGAINST_SPIKES ? "left-5" : "left-0.5"}`} />
                        </button>
                      </div>
                      {config.TRADE_AGAINST_SPIKES && (
                        <label className="block">
                          <div className="flex justify-between text-[10px] font-mono mb-1">
                            <span className="text-slate-400">Anti-Spike Lot Size</span>
                            <span className="text-emerald-400 font-bold">{config.ANTI_SPIKE_LOT_SIZE}</span>
                          </div>
                          <input type="number" min="0.01" max="2" step="0.01"
                            value={config.ANTI_SPIKE_LOT_SIZE}
                            onChange={e => handleInputChange("ANTI_SPIKE_LOT_SIZE", parseFloat(e.target.value))}
                            className="w-full bg-slate-900 border border-slate-800 text-xs py-1 px-2 rounded font-mono text-emerald-300 focus:outline-none focus:border-emerald-600" />
                        </label>
                      )}
                    </div>
                  </div>
                )}

                {/* ── TAB: CYCLE ── */}
                {activeTab === "cycle" && (
                  <div className="space-y-4">
                    <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-900/80 space-y-3">
                      <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Spike Cycle Counter</h3>
                      <p className="text-[9px] text-slate-500 leading-relaxed">
                        BOOM1000 fires ~1 spike per 1000 ticks. The cycle counter tracks ticks since the last spike and scales entry aggressiveness accordingly.
                      </p>
                      <label className="block">
                        <div className="flex justify-between text-[10px] font-mono mb-1">
                          <span className="text-slate-400">Cycle Length (ticks)</span>
                          <span className="text-emerald-400 font-bold">{config.SPIKE_CYCLE_LENGTH}</span>
                        </div>
                        <input type="number" min="100" max="5000" step="100"
                          value={config.SPIKE_CYCLE_LENGTH}
                          onChange={e => handleInputChange("SPIKE_CYCLE_LENGTH", parseInt(e.target.value))}
                          className="w-full bg-slate-900 border border-slate-800 text-xs py-1 px-2 rounded font-mono text-emerald-300 focus:outline-none focus:border-emerald-600" />
                      </label>
                      {([
                        ["CYCLE_EARLY_ZONE","Recovery Zone End (%)", 0.05, 0.40, 0.05],
                        ["CYCLE_HOT_ZONE",  "HOT Zone Start (%)",    0.40, 0.95, 0.05],
                        ["CYCLE_MAX_LOT_SCALE","Max Lot Scale (x)",  1.0,  5.0,  0.25],
                      ] as [keyof StrategyConfig, string, number, number, number][]).map(([k,label,min,max,step]) => (
                        <label key={k} className="block">
                          <div className="flex justify-between text-[10px] font-mono mb-1">
                            <span className="text-slate-400">{label}</span>
                            <span className="text-emerald-400 font-bold">{config[k] as any}</span>
                          </div>
                          <input type="range" min={min} max={max} step={step}
                            value={config[k] as any}
                            onChange={e => handleInputChange(k, parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                        </label>
                      ))}
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] font-mono text-slate-400">Cycle Lot Scaling</span>
                        <button onClick={() => handleInputChange("CYCLE_LOT_SCALING", !config.CYCLE_LOT_SCALING)}
                          className={`w-10 h-5 rounded-full transition-colors relative ${config.CYCLE_LOT_SCALING ? "bg-emerald-500" : "bg-slate-700"}`}>
                          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${config.CYCLE_LOT_SCALING ? "left-5" : "left-0.5"}`} />
                        </button>
                      </div>
                    </div>

                    {/* Zone legend */}
                    <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-900/80 space-y-2">
                      <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Zone Guide</h3>
                      {[
                        { zone: "RECOVERY", desc: "Just after spike — no entries",    color: "bg-rose-500" },
                        { zone: "BUILDING", desc: "Building up — normal signals",      color: "bg-sky-500" },
                        { zone: "HOT",      desc: "Spike is near — relaxed thresholds",color: "bg-amber-500" },
                        { zone: "OVERDUE",  desc: "Past due — score-gated at 0.30",   color: "bg-purple-500" },
                      ].map(z => (
                        <div key={z.zone} className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${z.color}`} />
                          <span className="text-[10px] font-mono font-bold text-slate-300 w-16">{z.zone}</span>
                          <span className="text-[9px] text-slate-500">{z.desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── TAB: WEIGHTS ── */}
                {activeTab === "weights" && (
                  <div className="space-y-4">
                    <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-900/80 space-y-3">
                      <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Probability Score Weights</h3>
                      <p className="text-[9px] text-slate-500 leading-relaxed">
                        Score = (w_cycle × Cycle_P) + (w_compress × Compress_P) + (w_energy × Energy_P)
                      </p>
                      {!weightsSumOk && (
                        <div className="flex items-center gap-1.5 bg-rose-950/40 border border-rose-700/50 rounded px-2 py-1.5">
                          <AlertCircle className="h-3 w-3 text-rose-400 shrink-0" />
                          <span className="text-[9px] text-rose-400 font-mono">
                            Weights sum to {weightsSum} — must equal 1.0. Adjust before saving.
                          </span>
                        </div>
                      )}
                      {weightsSumOk && (
                        <div className="text-[9px] text-emerald-400 font-mono bg-emerald-950/20 border border-emerald-900/30 rounded px-2 py-1">
                          ✓ Weights sum: {weightsSum}
                        </div>
                      )}
                      {([
                        ["WEIGHT_CYCLE",       "Cycle Timing (proven)",     0.30, 0.90, 0.05, "text-emerald-400"],
                        ["WEIGHT_COMPRESSION", "Volatility Compression",    0.05, 0.40, 0.05, "text-teal-400"],
                        ["WEIGHT_ENERGY",      "Directional Energy",        0.05, 0.40, 0.05, "text-teal-400"],
                      ] as [keyof StrategyConfig, string, number, number, number, string][]).map(([k,label,min,max,step,valColor]) => (
                        <div key={k}>
                          <div className="flex justify-between text-[10px] font-mono mb-1">
                            <span className="text-slate-400">{label}</span>
                            <span className={`${valColor} font-bold`}>{config[k] as any}</span>
                          </div>
                          <input type="range" min={min} max={max} step={step}
                            value={config[k] as any}
                            onChange={e => handleInputChange(k, parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                        </div>
                      ))}
                      <button onClick={() => setConfig({ ...config, WEIGHT_CYCLE: 0.60, WEIGHT_COMPRESSION: 0.20, WEIGHT_ENERGY: 0.20 })}
                        className="w-full py-1.5 text-[9px] font-mono bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-slate-400 transition-colors">
                        Reset to Audited Defaults (0.60 / 0.20 / 0.20)
                      </button>
                    </div>
                  </div>
                )}

                {/* ── TAB: MARTINGALE ── */}
                {activeTab === "martingale" && (
                  <div className="space-y-4">
                    <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-900/80 space-y-3">
                      <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Martingale System</h3>
                      <p className="text-[9px] text-slate-500 leading-relaxed">
                        Doubles lot size after each loss up to the max multiplier. High risk — use with a wide max drawdown setting.
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-slate-400">Martingale Active</span>
                        <button onClick={() => handleInputChange("MARTINGALE_ACTIVE", !config.MARTINGALE_ACTIVE)}
                          className={`w-10 h-5 rounded-full transition-colors relative ${config.MARTINGALE_ACTIVE ? "bg-amber-500" : "bg-slate-700"}`}>
                          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${config.MARTINGALE_ACTIVE ? "left-5" : "left-0.5"}`} />
                        </button>
                      </div>
                      {config.MARTINGALE_ACTIVE && (
                        <>
                          {([
                            ["MARTINGALE_FACTOR",         "Multiplier Factor",    1.1, 3.0, 0.1],
                            ["MARTINGALE_MAX_MULTIPLIER", "Max Multiplier Cap",   1.5, 20,  0.5],
                          ] as [keyof StrategyConfig, string, number, number, number][]).map(([k,label,min,max,step]) => (
                            <label key={k} className="block">
                              <div className="flex justify-between text-[10px] font-mono mb-1">
                                <span className="text-slate-400">{label}</span>
                                <span className="text-amber-400 font-bold">{config[k] as any}</span>
                              </div>
                              <input type="number" min={min} max={max} step={step}
                                value={config[k] as any}
                                onChange={e => handleInputChange(k, parseFloat(e.target.value))}
                                className="w-full bg-slate-900 border border-slate-800 text-xs py-1 px-2 rounded font-mono text-amber-300 focus:outline-none focus:border-amber-600" />
                            </label>
                          ))}
                          <div className="bg-amber-950/20 border border-amber-800/30 rounded p-2">
                            <p className="text-[9px] text-amber-400/70 font-mono">
                              ⚠ After {Math.floor(Math.log(config.MARTINGALE_MAX_MULTIPLIER) / Math.log(config.MARTINGALE_FACTOR))} consecutive losses, lots will be at max {config.MARTINGALE_MAX_MULTIPLIER}× = {(config.DEFAULT_LOT_SIZE * config.MARTINGALE_MAX_MULTIPLIER).toFixed(2)} lots.
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Save Button */}
                <button onClick={() => handleSaveConfig()} disabled={saveStatus === "saving" || !weightsSumOk}
                  className={`w-full py-2.5 font-bold rounded-lg text-xs tracking-wider uppercase flex items-center justify-center gap-2 transition-all
                    ${!weightsSumOk ? "bg-slate-800 text-slate-600 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white shadow-md"}`}>
                  <Sliders className="h-3.5 w-3.5" />
                  Flash Config to Brain
                </button>
              </>
            ) : (
              <div className="text-slate-500 text-xs py-8 text-center">Config not found.</div>
            )}
          </div>
        </section>

        {/* ═══ CENTRE COLUMN (col-span-6) ═══ */}
        <section className="xl:col-span-6 flex flex-col gap-4">

          {/* ── MULTI-SYMBOL STATUS BAR (shown when 2+ symbols active) ── */}
          {(() => {
            const perSym = (liveData as any).per_symbol as Record<string, any> | undefined;
            const mode   = (liveData as any).mode as string | undefined;
            const best   = (liveData as any).best_signal_symbol as string | undefined;
            if (!perSym || !mode || mode !== "multi") return null;
            const syms = Object.keys(perSym);
            return (
              <div className="bg-slate-950 border border-slate-900 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-3.5 w-3.5 text-teal-400" />
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                    Multi-Symbol Monitor — {syms.length} Active Streams
                  </span>
                </div>
                <div className={`grid gap-2 ${syms.length === 2 ? "grid-cols-2" : "grid-cols-4"}`}>
                  {syms.map(sym => {
                    const d     = perSym[sym];
                    const zone  = d.cycle_zone as string || "UNKNOWN";
                    const prob  = d.spike_probability_pct as number || 0;
                    const cycP  = ((d.cycle_position as number) || 0) * 100;
                    const price = d.last_price as number || 0;
                    const isFb  = d.is_fallback as boolean;
                    const isBest = sym === best;
                    const isBoom = sym.startsWith("BOOM");
                    const zoneColors: Record<string,string> = {
                      RECOVERY: "border-rose-800/60 bg-rose-950/20",
                      BUILDING: "border-sky-800/60 bg-sky-950/20",
                      HOT:      "border-amber-700/60 bg-amber-950/20",
                      OVERDUE:  "border-purple-700/60 bg-purple-950/20",
                    };
                    const zoneTxtColors: Record<string,string> = {
                      RECOVERY: "text-rose-400",
                      BUILDING: "text-sky-400",
                      HOT:      "text-amber-400",
                      OVERDUE:  "text-purple-400",
                    };
                    return (
                      <div key={sym}
                        className={`relative rounded-lg border p-2.5 transition-all ${zoneColors[zone] || "border-slate-800 bg-slate-900/20"} ${isBest ? "ring-1 ring-teal-500/50" : ""}`}>
                        {isBest && (
                          <div className="absolute -top-2 left-2 text-[8px] font-mono font-black bg-teal-600 text-white px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                            Best Signal
                          </div>
                        )}
                        <div className="flex justify-between items-start mb-1.5">
                          <div>
                            <div className="text-[9px] font-black font-mono uppercase text-slate-200 leading-none">{sym}</div>
                            {isFb && <span className="text-[7px] font-mono text-amber-500">SIM</span>}
                          </div>
                          <span className={`text-[8px] font-mono font-bold px-1 py-0.5 rounded ${zoneTxtColors[zone] || "text-slate-400"}`}>
                            {zone}
                          </span>
                        </div>
                        <div className="flex justify-between items-center mb-1">
                          <span className={`text-[10px] font-mono font-bold ${isBoom ? "text-emerald-400" : "text-rose-400"}`}>
                            {price > 0 ? price.toFixed(2) : "—"}
                          </span>
                          <span className="text-[9px] font-mono font-bold text-white">
                            {prob.toFixed(1)}%
                          </span>
                        </div>
                        {/* Cycle progress mini-bar */}
                        <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              zone === "RECOVERY" ? "bg-rose-500" :
                              zone === "BUILDING" ? "bg-sky-500" :
                              zone === "HOT"      ? "bg-amber-500" :
                              "bg-purple-500"
                            }`}
                            style={{ width: `${Math.min(cycP, 100)}%` }}
                          />
                        </div>
                        <div className="text-[7px] font-mono text-slate-600 mt-0.5 text-right">{cycP.toFixed(0)}% cycle</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ── SYMBOL SWITCHER + BOT/OPT CONTROLS ── */}
          <div className="bg-slate-950 border border-slate-900 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-900 pb-2">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-emerald-400 animate-pulse" />
                <span className="font-bold text-xs text-slate-200">Agent Controls</span>
              </div>
              {config && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold uppercase">
                  {config.ACTIVE_SYMBOL}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Optimizer */}
              <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-900 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-mono font-bold text-slate-500 uppercase">Backtester</span>
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full ${optStatus === "running" ? "bg-indigo-950 text-indigo-400 border border-indigo-800" : "bg-slate-900 text-slate-500"}`}>
                    {optStatus.toUpperCase()}
                  </span>
                </div>
                <p className="text-[9px] text-slate-500 leading-relaxed">3-stage grid search. Finds optimal params and writes them to config.</p>
                {optStatus === "running" ? (
                  <button onClick={stopOptimizer}
                    className="w-full py-1.5 bg-rose-600/20 hover:bg-rose-600/35 text-rose-300 font-bold text-[10px] rounded-lg flex items-center justify-center gap-1.5 border border-rose-500/30 transition-all active:scale-95">
                    <Square className="h-3 w-3 stroke-[2.5]" /> Terminate
                  </button>
                ) : (
                  <button onClick={startOptimizer}
                    className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] rounded-lg flex items-center justify-center gap-1.5 transition-all active:scale-95">
                    <Play className="h-3 w-3 stroke-[2.5]" /> Grid Search
                  </button>
                )}
              </div>

              {/* Live Bot */}
              <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-900 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-mono font-bold text-slate-500 uppercase">Live Agent</span>
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full ${botStatus === "running" ? "bg-emerald-950 text-emerald-400 border border-emerald-800" : "bg-slate-900 text-slate-500"}`}>
                    {botStatus.toUpperCase()}
                  </span>
                </div>
                <p className="text-[9px] text-slate-500 leading-relaxed">
                  {liveData.is_fallback ? "⚠ Simulation mode active." : "Streams real Deriv ticks. Paper trades only."}
                </p>
                {botStatus === "running" ? (
                  <button onClick={() => setConfirmStopBot(true)}
                    className="w-full py-1.5 bg-rose-600/20 hover:bg-rose-600/35 text-rose-300 font-bold text-[10px] rounded-lg flex items-center justify-center gap-1.5 border border-rose-500/30 transition-all active:scale-95">
                    <Square className="h-3 w-3 stroke-[2.5]" /> Safe Halt
                  </button>
                ) : (
                  <button onClick={startLiveBot}
                    className="w-full py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[10px] rounded-lg flex items-center justify-center gap-1.5 transition-all active:scale-95">
                    <Play className="h-3 w-3 stroke-[2.5]" /> Power Up
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── CYCLE ZONE GAUGE ── */}
          {botStatus === "running" && (
            <div className="bg-slate-950 border border-slate-900 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-xs font-mono font-bold text-slate-300">Spike Cycle Monitor</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                    cycleZone === "RECOVERY" ? "bg-rose-950/40 text-rose-400 border-rose-800/40"
                    : cycleZone === "HOT"     ? "bg-amber-950/40 text-amber-400 border-amber-800/40"
                    : cycleZone === "OVERDUE" ? "bg-purple-950/40 text-purple-400 border-purple-800/40 animate-pulse"
                    : "bg-sky-950/40 text-sky-400 border-sky-800/40"
                  }`}>{cycleZone}</span>
                  {latestSpikePct > 0 && (
                    <span className="text-[10px] font-mono text-slate-400">
                      Score: <span className="text-emerald-400 font-bold">{latestSpikePct.toFixed(1)}%</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="relative h-4 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                  {config && (() => {
                    const cycleLen = config.SPIKE_CYCLE_LENGTH || 1000;
                    const earlyEnd = config.CYCLE_EARLY_ZONE || 0.15;
                    const hotStart = config.CYCLE_HOT_ZONE || 0.60;
                    const pct = Math.min((latestTicksSinceSpike / cycleLen) * 100, 105);
                    return (
                      <>
                        <div className="absolute inset-0 flex">
                          <div className="bg-rose-900/40" style={{ width: `${earlyEnd * 100}%` }} />
                          <div className="bg-sky-900/30" style={{ width: `${(hotStart - earlyEnd) * 100}%` }} />
                          <div className="bg-amber-900/40" style={{ width: `${(1.0 - hotStart) * 100}%` }} />
                          <div className="bg-purple-900/50 flex-1" />
                        </div>
                        <div className={`absolute top-0 left-0 h-full rounded-full transition-all duration-500 opacity-80 ${zoneBg(cycleZone)}`}
                          style={{ width: `${Math.min(pct, 100)}%` }} />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-[9px] font-mono font-bold text-white drop-shadow">
                            {latestTicksSinceSpike} / {cycleLen} ticks ({(latestTicksSinceSpike / cycleLen * 100).toFixed(0)}%)
                          </span>
                        </div>
                      </>
                    );
                  })()}
                </div>
                <div className="flex justify-between text-[8px] font-mono text-slate-600">
                  <span>RECOVERY</span><span>BUILDING</span><span>HOT</span><span>OVERDUE</span>
                </div>
              </div>

              {/* Score breakdown */}
              {latestSpikePct > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Cycle P", val: `${latestSpikePct.toFixed(1)}%`, color: "text-emerald-400" },
                    { label: "Confidence", val: `${latestConfidence.toFixed(0)}%`, color: "text-teal-400" },
                    { label: "Cycle Pos", val: `${(latestCyclePos * 100).toFixed(0)}%`, color: "text-sky-400" },
                  ].map(s => (
                    <div key={s.label} className="bg-slate-900/50 rounded-lg p-2 text-center border border-slate-800/60">
                      <div className={`text-xs font-mono font-bold ${s.color}`}>{s.val}</div>
                      <div className="text-[8px] text-slate-600 font-mono">{s.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── LIVE CHART ── */}
          <LiveChart
            liveData={liveData}
            botStatus={botStatus}
            stopLossPoints={config?.STOP_LOSS_POINTS}
            takeProfitPoints={config?.TAKE_PROFIT_POINTS}
          />

          {/* ── TERMINALS ── */}
          <div className="flex-1 bg-slate-950 border border-slate-900 rounded-xl overflow-hidden flex flex-col min-h-[320px] max-h-[500px]">
            <div className="p-2.5 border-b border-slate-900 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-indigo-400" />
                <span className="font-mono text-[10px] font-bold text-slate-300 uppercase">Execution Console</span>
              </div>
              <div className="flex gap-0.5 bg-slate-900/60 p-0.5 rounded-lg border border-slate-850">
                {([
                  { id: "optimizer", label: "Optimizer", cls: "bg-indigo-600" },
                  { id: "live-bot",  label: "Live Agent", cls: "bg-emerald-500" },
                  { id: "exporter",  label: "Brain Editor", cls: "bg-amber-500" },
                ] as { id: "optimizer"|"live-bot"|"exporter"; label: string; cls: string }[]).map(t => (
                  <button key={t.id} onClick={() => setTerminalType(t.id)}
                    className={`px-2.5 py-1 text-[9px] font-mono font-bold rounded transition-colors whitespace-nowrap ${
                      terminalType === t.id ? `${t.cls} text-slate-950` : "text-slate-400 hover:text-slate-200"
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-slate-955 p-3 font-mono">
              {terminalType === "optimizer" && (
                <div className="space-y-0.5">
                  {optOutput ? optOutput.split("\n").map((l, i) => formatTerminalLine(l, i))
                    : <span className="text-zinc-600 text-xs">Terminal ready. Waiting for optimization triggers...</span>}
                  <div ref={optTerminalEndRef} />
                </div>
              )}
              {terminalType === "live-bot" && (
                <div className="space-y-0.5">
                  {botOutput ? botOutput.split("\n").map((l, i) => formatTerminalLine(l, i))
                    : <span className="text-zinc-600 text-xs">Start the bot to see live stream output...</span>}
                  <div ref={botTerminalEndRef} />
                </div>
              )}
              {terminalType === "exporter" && (
                <div className="space-y-4 font-sans text-xs">
                  {/* Header */}
                  <div className="bg-slate-900/40 p-3 rounded-lg border border-slate-900 flex justify-between items-center gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-slate-200 font-mono flex items-center gap-1.5">
                        <FileCode className="h-3.5 w-3.5 text-amber-400" /> Brain File Editor
                      </h4>
                      <p className="text-[10px] text-slate-500 mt-0.5">Edit Python files directly or upload new versions. Restart bot to apply.</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Upload button */}
                      <label className={`px-3 py-1.5 text-[10px] font-mono font-bold rounded-lg border cursor-pointer flex items-center gap-1.5 transition-all ${
                        uploadStatus === "uploading" ? "bg-slate-800 text-slate-500" :
                        uploadStatus === "done"      ? "bg-emerald-950/40 text-emerald-400 border-emerald-800/40" :
                        "bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border-amber-700/40"
                      }`}>
                        <Upload className="h-3 w-3" />
                        {uploadStatus === "uploading" ? "Uploading..." : uploadStatus === "done" ? "Uploaded!" : "Upload .py"}
                        <input ref={fileInputRef} type="file" accept=".py,.txt,.md" className="hidden" onChange={handleFileUpload} />
                      </label>
                      <a href="/api/export/zip"
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono font-bold rounded-lg border border-slate-700 flex items-center gap-1.5 transition-colors">
                        <Download className="h-3 w-3" /> ZIP
                      </a>
                    </div>
                  </div>

                  {/* File selector + editor */}
                  <div className="flex flex-col bg-slate-950 border border-slate-900 rounded-lg overflow-hidden" style={{ minHeight: 320 }}>
                    <div className="p-2 border-b border-slate-900 flex items-center justify-between gap-2">
                      <select value={selectedFile} onChange={e => { setSelectedFile(e.target.value); setIsEditing(false); }}
                        className="bg-slate-900 border border-slate-800 text-[10px] text-slate-300 py-1 px-2 rounded font-mono focus:outline-none focus:border-amber-600 cursor-pointer">
                        {exportFiles.map(f => (
                          <option key={f.filename} value={f.filename}>
                            {f.filename} {f.exists ? `(${(f.size/1024).toFixed(1)} KB)` : "(missing)"}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-1.5">
                        {!isEditing ? (
                          <button onClick={() => setIsEditing(true)}
                            className="px-2.5 py-1 text-[9px] font-mono font-bold bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-700/40 rounded flex items-center gap-1 transition-colors">
                            <Edit3 className="h-2.5 w-2.5" /> Edit
                          </button>
                        ) : (
                          <>
                            <button onClick={saveFileContent} disabled={fileSaveStatus === "saving"}
                              className="px-2.5 py-1 text-[9px] font-mono font-bold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-700/40 rounded flex items-center gap-1 transition-colors">
                              <Save className="h-2.5 w-2.5" />
                              {fileSaveStatus === "saving" ? "Saving..." : fileSaveStatus === "saved" ? "Saved!" : "Save"}
                            </button>
                            <button onClick={() => { setEditedContent(fileContent); setIsEditing(false); }}
                              className="px-2.5 py-1 text-[9px] font-mono font-bold bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700 rounded flex items-center gap-1 transition-colors">
                              <RotateCcw className="h-2.5 w-2.5" /> Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {loadingFile ? (
                      <div className="flex-1 flex items-center justify-center p-8">
                        <RefreshCw className="h-5 w-5 text-amber-400 animate-spin" />
                      </div>
                    ) : (
                      <textarea
                        value={isEditing ? editedContent : fileContent}
                        onChange={e => isEditing && setEditedContent(e.target.value)}
                        readOnly={!isEditing}
                        spellCheck={false}
                        className={`flex-1 w-full p-3 font-mono text-[10px] leading-relaxed resize-none focus:outline-none bg-transparent
                          ${isEditing ? "text-amber-200 caret-amber-400" : "text-slate-400 cursor-default"}`}
                        style={{ minHeight: 280 }}
                      />
                    )}
                  </div>

                  {/* Termux curl sync */}
                  <div className="bg-slate-900/40 border border-slate-900 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-bold text-amber-400">One-Command Termux Sync</span>
                      <button onClick={() => { navigator.clipboard.writeText(`curl -sSf -L ${window.location.origin}/api/export/sh | bash`); setCopiedCurl(true); setTimeout(() => setCopiedCurl(false), 2000); }}
                        className="text-[9px] font-mono text-slate-400 hover:text-slate-200 flex items-center gap-1 bg-slate-900 px-2 py-0.5 rounded border border-slate-800 transition-colors">
                        <Copy className="h-2.5 w-2.5" /> {copiedCurl ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <code className="block text-[10px] font-mono text-emerald-400 bg-slate-900 border border-slate-800 px-2.5 py-2 rounded break-all select-all">
                      curl -sSf -L {window.location.origin}/api/export/sh | bash
                    </code>

                    <div className="pt-1 space-y-1">
                      <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider block">GitHub Push (run inside local_repo/ folder)</span>
                      <div className="bg-slate-900 border border-slate-800 p-2 rounded text-[9px] font-mono text-slate-400 space-y-0.5 select-all">
                        <div>git init && git add .</div>
                        <div>git commit -m "Brain update: calibrated params"</div>
                        <div>git branch -M main</div>
                        <div>git remote add origin {githubRepoUrl} 2&gt;/dev/null || git remote set-url origin {githubRepoUrl}</div>
                        <div>git push -u origin main</div>
                      </div>
                      <input value={githubRepoUrl} onChange={e => setGithubRepoUrl(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 text-[10px] py-1 px-2 rounded font-mono text-indigo-300 focus:outline-none focus:border-indigo-700"
                        placeholder="https://github.com/You/repo.git" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ═══ RIGHT COLUMN (col-span-3) ═══ */}
        <section className="xl:col-span-3 flex flex-col gap-4">

          {/* ── STATS / OPTIMIZER RESULT TABS ── */}
          <div className="bg-slate-950 border border-slate-900 rounded-xl overflow-hidden">
            <div className="flex border-b border-slate-900">
              {([
                { id: "stats",           label: "Session Stats" },
                { id: "optimizer-result",label: "Last Opt Run"  },
              ] as { id: "stats"|"optimizer-result"; label: string }[]).map(t => (
                <button key={t.id} onClick={() => setRightPanelTab(t.id)}
                  className={`flex-1 py-2.5 text-[9px] font-mono font-bold uppercase tracking-tight border-b-2 transition-colors ${
                    rightPanelTab === t.id
                      ? "border-emerald-500 text-emerald-400 bg-emerald-500/5"
                      : "border-transparent text-slate-500 hover:text-slate-300"
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>

            {rightPanelTab === "stats" && (
              <div className="p-3 space-y-2">
                {/* Balance + Win Rate primary stats */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Balance",  val: `$${liveBalance.toFixed(2)}`,    color: liveBalance >= 50 ? "text-emerald-400" : "text-rose-400" },
                    { label: "Win Rate", val: `${winRate.toFixed(1)}%`,        color: winRate >= 50 ? "text-emerald-400" : "text-rose-400" },
                    { label: "Net P&L",  val: `${totalPnL >= 0 ? "+" : ""}$${totalPnL.toFixed(2)}`, color: totalPnL >= 0 ? "text-emerald-400" : "text-rose-400" },
                    { label: "Trades",   val: `${totalTrades}`,               color: "text-slate-300" },
                  ].map(s => (
                    <div key={s.label} className="bg-slate-900/50 rounded-lg p-2.5 border border-slate-800/60">
                      <div className={`text-sm font-mono font-bold ${s.color}`}>{s.val}</div>
                      <div className="text-[9px] text-slate-500 font-mono mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* From bot_metrics if available */}
                {botMetrics.total_trades > 0 && (
                  <div className="bg-slate-900/30 rounded-lg border border-slate-800/40 p-2.5 space-y-1.5">
                    <span className="text-[9px] font-mono font-bold text-slate-500 uppercase tracking-wider">Bot Session Metrics</span>
                    {[
                      { k: "win_rate",    label: "Win Rate",    fmt: (v: number) => `${(v * 100).toFixed(1)}%`, color: (v: number) => v > 0.5 ? "text-emerald-400" : "text-rose-400" },
                      { k: "net_profit",  label: "Net Profit",  fmt: (v: number) => `${v >= 0 ? "+" : ""}$${v.toFixed(2)}`, color: (v: number) => v >= 0 ? "text-emerald-400" : "text-rose-400" },
                      { k: "max_drawdown",label: "Max Drawdown",fmt: (v: number) => `$${v.toFixed(2)}`, color: () => "text-amber-400" },
                      { k: "total_trades",label: "Total Trades",fmt: (v: number) => `${v}`, color: () => "text-slate-300" },
                    ].map(row => {
                      const val = botMetrics[row.k];
                      if (val == null) return null;
                      return (
                        <div key={row.k} className="flex justify-between items-center">
                          <span className="text-[9px] font-mono text-slate-500">{row.label}</span>
                          <span className={`text-[10px] font-mono font-bold ${row.color(val)}`}>{row.fmt(val)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Active trade box */}
                {liveData.active_trade && (() => {
                  const t = liveData.active_trade;
                  const win = t.pnl > 0;
                  return (
                    <div className={`rounded-lg border p-2.5 space-y-1 ${win ? "border-emerald-800/50 bg-emerald-950/20" : "border-rose-800/50 bg-rose-950/20"}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-mono font-bold text-slate-400 uppercase">Open Trade</span>
                        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${t.direction === "BUY" ? "bg-emerald-950 text-emerald-400" : "bg-rose-950 text-rose-400"}`}>
                          {t.direction}
                        </span>
                      </div>
                      <div className="flex justify-between text-[9px] font-mono">
                        <span className="text-slate-500">Entry</span>
                        <span className="text-slate-200 font-bold">{t.entry_price.toFixed(3)}</span>
                      </div>
                      <div className="flex justify-between text-[9px] font-mono">
                        <span className="text-slate-500">P&L</span>
                        <span className={`font-bold ${win ? "text-emerald-400" : "text-rose-400"}`}>
                          {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between text-[9px] font-mono">
                        <span className="text-slate-500">Held</span>
                        <span className="text-slate-300">{t.ticks_held} ticks</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Win rate progress bar */}
                {totalTrades > 0 && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px] font-mono text-slate-500">
                      <span>Win Rate Progress</span>
                      <span className={winRate >= 66 ? "text-emerald-400 font-bold" : "text-slate-400"}>{winRate.toFixed(1)}% / 66% goal</span>
                    </div>
                    <div className="h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                      <div className={`h-full rounded-full transition-all ${winRate >= 66 ? "bg-emerald-500" : winRate >= 40 ? "bg-amber-500" : "bg-rose-500"}`}
                        style={{ width: `${Math.min(winRate / 66 * 100, 100)}%` }} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {rightPanelTab === "optimizer-result" && (
              <div className="p-3 space-y-3">
                {optReport.symbol ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-mono text-slate-500 uppercase">Symbol</span>
                      <span className="text-[10px] font-mono font-bold text-emerald-400">{optReport.symbol}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-mono text-slate-500">Final Score</span>
                      <span className="text-[10px] font-mono font-bold text-purple-400">{optReport.score?.toFixed(2) ?? "—"} / 100</span>
                    </div>
                    <div className="h-px bg-slate-800/60" />
                    <div className="space-y-1.5">
                      <span className="text-[9px] font-mono font-bold text-slate-500 uppercase">Report Metrics</span>
                      {[
                        { k: "win_rate",          label: "Win Rate",       fmt: (v: number) => `${(v*100).toFixed(1)}%`,  color: (v: number) => v > 0.3 ? "text-emerald-400" : "text-rose-400" },
                        { k: "net_profit",         label: "Net Profit",     fmt: (v: number) => `$${v.toFixed(2)}`,        color: (v: number) => v > 0 ? "text-emerald-400" : "text-rose-400" },
                        { k: "profit_factor",      label: "Profit Factor",  fmt: (v: number) => `${v.toFixed(2)}x`,        color: (v: number) => v > 1 ? "text-emerald-400" : "text-rose-400" },
                        { k: "max_drawdown",       label: "Max Drawdown",   fmt: (v: number) => `$${v.toFixed(2)}`,        color: () => "text-amber-400" },
                        { k: "total_trades",       label: "Trades",         fmt: (v: number) => `${v}`,                   color: () => "text-slate-300" },
                        { k: "spike_capture_ratio",label: "Spike Captures", fmt: (v: number) => `${(v*100).toFixed(1)}%`, color: () => "text-teal-400" },
                        { k: "timeout_ratio",      label: "Timeouts",       fmt: (v: number) => `${(v*100).toFixed(1)}%`, color: (v: number) => v > 0.7 ? "text-rose-400" : "text-slate-300" },
                      ].map(row => {
                        const val = optReport.report?.[row.k];
                        if (val == null) return null;
                        return (
                          <div key={row.k} className="flex justify-between items-center">
                            <span className="text-[9px] font-mono text-slate-500">{row.label}</span>
                            <span className={`text-[10px] font-mono font-bold ${row.color(val)}`}>{row.fmt(val)}</span>
                          </div>
                        );
                      })}
                    </div>
                    {optReport.params && (
                      <>
                        <div className="h-px bg-slate-800/60" />
                        <div className="space-y-1">
                          <span className="text-[9px] font-mono font-bold text-slate-500 uppercase">Applied Params</span>
                          {Object.entries(optReport.params).map(([k, v]) => (
                            <div key={k} className="flex justify-between text-[9px] font-mono">
                              <span className="text-slate-600">{k}</span>
                              <span className="text-slate-300 font-bold">{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className="py-8 text-center">
                    <BarChart2 className="h-8 w-8 text-slate-700 mx-auto mb-2" />
                    <p className="text-[10px] text-slate-600 font-mono">No optimization run yet.<br />Run Grid Search to see results.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── TRADE HISTORY ── */}
          <div className="bg-slate-950 border border-slate-900 rounded-xl overflow-hidden flex flex-col flex-1">
            <div className="p-3 border-b border-slate-900 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <History className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-bold text-xs text-slate-300">Trade History</span>
                {totalTrades > 0 && <span className="text-[9px] font-mono bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">{totalTrades}</span>}
              </div>
              <button onClick={handleClearTrades}
                className={`text-[9px] font-mono px-2 py-1 rounded border transition-colors ${
                  confirmClear
                    ? "bg-rose-600 text-white border-rose-500"
                    : "bg-slate-900 text-slate-500 border-slate-800 hover:text-rose-400 hover:border-rose-800/50"
                }`}>
                {confirmClear ? "Confirm Clear" : "Clear"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[400px]">
              {trades.length === 0 ? (
                <div className="p-8 text-center text-slate-600 text-[10px] font-mono">No trades yet this session.</div>
              ) : (
                <table className="w-full text-[9px] font-mono">
                  <thead className="sticky top-0 bg-slate-950 border-b border-slate-900">
                    <tr className="text-slate-600 uppercase tracking-wider">
                      <th className="text-left px-3 py-1.5">Dir</th>
                      <th className="text-left px-2 py-1.5">Symbol</th>
                      <th className="text-right px-2 py-1.5">P&L</th>
                      <th className="text-right px-2 py-1.5">Lots</th>
                      <th className="text-right px-2 py-1.5">Ticks</th>
                      <th className="text-left px-2 py-1.5">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, i) => {
                      const win = t.pnl > 0;
                      return (
                        <tr key={t.trade_id || i} className={`border-b border-slate-900/50 hover:bg-slate-900/30 transition-colors ${win ? "bg-emerald-950/5" : "bg-rose-950/5"}`}>
                          <td className="px-3 py-1.5">
                            <span className={`font-bold px-1 py-0.5 rounded text-[8px] ${t.direction === "BUY" ? "text-emerald-400 bg-emerald-950/40" : "text-rose-400 bg-rose-950/40"}`}>
                              {t.direction}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-slate-500">{t.symbol}</td>
                          <td className={`px-2 py-1.5 text-right font-bold ${win ? "text-emerald-400" : "text-rose-400"}`}>
                            {win ? "+" : ""}{t.pnl.toFixed(2)}
                          </td>
                          <td className="px-2 py-1.5 text-right text-slate-400">{t.lot_size?.toFixed(2) ?? "—"}</td>
                          <td className="px-2 py-1.5 text-right text-slate-500">{t.ticks_held}</td>
                          <td className="px-2 py-1.5 text-slate-600 max-w-[80px] truncate" title={t.exit_reason}>{t.exit_reason}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
