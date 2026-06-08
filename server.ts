import express from "express";
import path from "path";
import fs from "fs";
import { exec, spawn, ChildProcess } from "child_process";
import { createServer as createViteServer } from "vite";
import AdmZip from "adm-zip";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const localRepoPath = path.join(process.cwd(), "local_repo");
  const configPath = path.join(localRepoPath, "config.py");
  const logsPath = path.join(localRepoPath, "logs");
  const tradeLogPath = path.join(logsPath, "trade_log.json");
  const botMetricsPath = path.join(logsPath, "bot_metrics.json");
  const optReportPath = path.join(logsPath, "optimization_report.json");

  // State managers for background tasks
  let optimizerProcess: ChildProcess | null = null;
  let optimizerOutput = "";
  let optimizerStatus = "idle"; // "idle" | "running" | "completed" | "failed"
  let optimizerSymbol = "BOOM1000";

  let botProcess: ChildProcess | null = null;
  let botOutput = "";
  let botStatus = "idle"; // "idle" | "running" | "failed"

  // ──────────────────────────────────────────────────────────────────────────
  //  CONFIG HELPERS (Regex Parser / Replacer)
  // ──────────────────────────────────────────────────────────────────────────

  const configKeys = [
    "ACTIVE_SYMBOL",
    "BOOM_EXIT_TICKS",
    "CRASH_EXIT_TICKS",
    "STOP_LOSS_POINTS",
    "TAKE_PROFIT_POINTS",
    "SPIKE_THRESHOLD_FACTOR",
    "RSI_OVERSOLD",
    "RSI_OVERBOUGHT",
    "SQUEEZE_THRESHOLD",
    "ZSCORE_ENTRY",
    "ENTRY_SCORE_THRESHOLD",
    "WEIGHT_CYCLE",
    "WEIGHT_COMPRESSION",
    "WEIGHT_ENERGY",
    "SPIKE_CYCLE_LENGTH",
    "CYCLE_EARLY_ZONE",
    "CYCLE_HOT_ZONE",
    "CYCLE_MAX_LOT_SCALE",
    "CYCLE_LOT_SCALING",
    "POST_TRADE_COOLDOWN_TICKS",
    "MAX_DAILY_LOSS",
    "MAX_TRADES_PER_SESSION",
    "COOLDOWN_AFTER_LOSS_STREAK",
    "COOLDOWN_MINUTES",
    "MAX_DRAWDOWN_PCT",
    "DEFAULT_LOT_SIZE",
    "MARTINGALE_ACTIVE",
    "MARTINGALE_FACTOR",
    "MARTINGALE_MAX_MULTIPLIER",
    "TRADE_AGAINST_SPIKES",
    "ANTI_SPIKE_LOT_SIZE",
    "FORCE_LIVE_WS",
  ];

  function parseConfig(): Record<string, any> {
    if (!fs.existsSync(configPath)) {
      return {};
    }
    const content = fs.readFileSync(configPath, "utf-8");
    const result: Record<string, any> = {};

    configKeys.forEach((key) => {
      // Look for lines like Key = Value
      const regex = new RegExp(`^\\s*${key}\\s*=\\s*([^\\n#]+)`, "m");
      const match = content.match(regex);
      if (match) {
        const rawVal = match[1].trim();
        // Parse into exact types
        if (rawVal === "True") {
          result[key] = true;
        } else if (rawVal === "False") {
          result[key] = false;
        } else if (rawVal.startsWith('"') || rawVal.startsWith("'")) {
          // String
          result[key] = rawVal.substring(1, rawVal.length - 1);
        } else {
          // Number
          const num = Number(rawVal);
          result[key] = isNaN(num) ? rawVal : num;
        }
      }
    });

    return result;
  }

  function writeConfig(params: Record<string, any>): boolean {
    if (!fs.existsSync(configPath)) {
      return false;
    }
    let content = fs.readFileSync(configPath, "utf-8");

    Object.entries(params).forEach(([key, val]) => {
      if (!configKeys.includes(key)) return;

      // Create regex matching variable assignment
      const regex = new RegExp(`^(\\s*${key}\\s*=\\s*)([^\\n#\\s]+)(.*)$`, "m");
      let strVal = "";
      if (typeof val === "boolean") {
        strVal = val ? "True" : "False";
      } else if (typeof val === "string") {
        strVal = `"${val}"`;
      } else {
        strVal = String(val);
      }

      content = content.replace(regex, `$1${strVal}$3`);
    });

    fs.writeFileSync(configPath, content, "utf-8");
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  API ENDPOINTS
  // ──────────────────────────────────────────────────────────────────────────

  app.get("/api/config", (req, res) => {
    try {
      const configData = parseConfig();
      res.json(configData);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/config", (req, res) => {
    try {
      const success = writeConfig(req.body);
      if (success) {
        res.json({ status: "success", data: parseConfig() });
      } else {
        res.status(404).json({ error: "Config file not found" });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/trades", (req, res) => {
    try {
      if (fs.existsSync(tradeLogPath)) {
        const fileContent = fs.readFileSync(tradeLogPath, "utf-8");
        // Deriv bots write multiple json records separated by newlines or as a single json list
        try {
          const parsed = JSON.parse(fileContent);
          res.json(parsed);
        } catch {
          // If stored line-by-line:
          const lines = fileContent.trim().split("\n");
          const trades = lines.map((l) => JSON.parse(l));
          res.json(trades);
        }
      } else {
        res.json([]);
      }
    } catch (err: any) {
      res.json([]);
    }
  });

  app.post("/api/trades/clear", (req, res) => {
    try {
      if (fs.existsSync(tradeLogPath)) {
        fs.unlinkSync(tradeLogPath);
      }
      if (fs.existsSync(botMetricsPath)) {
        fs.unlinkSync(botMetricsPath);
      }
      const csvPath = path.join(logsPath, "trade_log.csv");
      if (fs.existsSync(csvPath)) {
        fs.unlinkSync(csvPath);
      }
      res.json({ status: "success", message: "Trading log cleared successfully" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/metrics", (req, res) => {
    try {
      let botMetrics = {};
      let optReport = {};

      if (fs.existsSync(botMetricsPath)) {
        botMetrics = JSON.parse(fs.readFileSync(botMetricsPath, "utf-8"));
      }
      if (fs.existsSync(optReportPath)) {
        optReport = JSON.parse(fs.readFileSync(optReportPath, "utf-8"));
      }

      res.json({
        bot_metrics: botMetrics,
        optimization_report: optReport,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ticks", (req, res) => {
    try {
      const ticksPath = path.join(logsPath, "live_ticks.json");
      if (fs.existsSync(ticksPath)) {
        res.json(JSON.parse(fs.readFileSync(ticksPath, "utf-8")));
      } else {
        res.json({ symbol: "", ticks: [], active_trade: null });
      }
    } catch {
      res.json({ symbol: "", ticks: [], active_trade: null });
    }
  });

  // ── OPTIMIZER PROCESS MANAGER ─────────────────────────────────────────────

  app.post("/api/optimize", (req, res) => {
    if (optimizerStatus === "running") {
      return res.status(400).json({ error: "Optimizer is already running" });
    }

    const symbol = req.body.symbol || "BOOM1000";
    optimizerSymbol = symbol;
    optimizerOutput = `Starting optimization grid search for ${symbol}...\n`;
    optimizerStatus = "running";

    // Set active symbol in config before starting
    writeConfig({ ACTIVE_SYMBOL: symbol });

    optimizerProcess = spawn("python3", ["backtester.py", symbol, "--apply"], {
      cwd: localRepoPath,
    });

    optimizerProcess.on("error", (err) => {
      optimizerOutput += `\n[SPAWN ERROR] Failed to start optimizer: ${err.message}\n`;
      optimizerStatus = "failed";
      optimizerProcess = null;
    });

    optimizerProcess.stdout?.on("data", (data) => {
      optimizerOutput += data.toString();
    });

    optimizerProcess.stderr?.on("data", (data) => {
      optimizerOutput += `[ERROR] ${data.toString()}`;
    });

    optimizerProcess.on("close", (code) => {
      if (code === 0) {
        optimizerStatus = "completed";
        optimizerOutput += "\n[OPTIMIZATION COMPLETED SUCCESSFULLY] Best parameters applied back to config.py.\n";
      } else {
        optimizerStatus = "failed";
        optimizerOutput += `\n[OPTIMIZATION FAILED] Process exited with code ${code}.\n`;
      }
      optimizerProcess = null;
    });

    res.json({ status: "started", symbol });
  });

  app.get("/api/optimize/status", (req, res) => {
    res.json({
      status: optimizerStatus,
      symbol: optimizerSymbol,
      output: optimizerOutput,
    });
  });

  app.post("/api/optimize/stop", (req, res) => {
    if (optimizerProcess) {
      optimizerProcess.kill();
      optimizerStatus = "failed";
      optimizerOutput += "\n[OPTIMIZATION TERMINATED BY USER]\n";
      optimizerProcess = null;
      res.json({ status: "stopped" });
    } else {
      res.status(400).json({ error: "No active optimizer running" });
    }
  });

  // ── LIVE BOT PROCESS MANAGER ──────────────────────────────────────────────

  app.post("/api/bot/start", (req, res) => {
    if (botStatus === "running") {
      return res.status(400).json({ error: "Bot is already running" });
    }

    botOutput = "Powering up trading agent & establishing direct connections...\n";
    botStatus = "running";

    botProcess = spawn("python3", ["main.py"], {
      cwd: localRepoPath,
    });

    botProcess.on("error", (err) => {
      botOutput += `\n[BOT SPAWN ERROR] Failed to start live trading bot: ${err.message}\n`;
      botStatus = "failed";
      botProcess = null;
    });

    botProcess.stdout?.on("data", (data) => {
      botOutput += data.toString();
      // Keep output reasonable (max 100k characters) to prevent memory bloating
      if (botOutput.length > 200000) {
        botOutput = botOutput.substring(botOutput.length - 100000);
      }
    });

    botProcess.stderr?.on("data", (data) => {
      botOutput += `[ERROR] ${data.toString()}`;
    });

    botProcess.on("close", (code) => {
      botStatus = "idle";
      botOutput += `\n[BOT DISCONNECTED] Exited with code ${code}.\n`;
      botProcess = null;
    });

    res.json({ status: "started" });
  });

  app.get("/api/bot/status", (req, res) => {
    res.json({
      status: botStatus,
      output: botOutput,
    });
  });

  app.post("/api/bot/stop", (req, res) => {
    if (botProcess) {
      botProcess.kill();
      botStatus = "idle";
      botOutput += "\n[BOT SHUT DOWN SAFELY BY USER]\n";
      botProcess = null;
      res.json({ status: "stopped" });
    } else {
      res.status(400).json({ error: "No active bot running" });
    }
  });

  // ── BRAIN EXPORTER ROUTING ────────────────────────────────────────────────
  const exportableFiles = [
    "config.py",
    "strategy.py",
    "trader.py",
    "risk_manager.py",
    "main.py",
    "ml_features.py",
    "data_stream.py",
    "backtester.py",
    "audit.py",
    "logger.py",
    "evaluator.py",
    "download_history.py",
    "requirements.txt",
    "README.md"
  ];

  app.get("/api/export/files", (req, res) => {
    try {
      const filesInfo = exportableFiles.map((filename) => {
        const fullPath = path.join(localRepoPath, filename);
        const exists = fs.existsSync(fullPath);
        const size = exists ? fs.statSync(fullPath).size : 0;
        return { filename, exists, size };
      });
      res.json(filesInfo);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/export/file/:filename", (req, res) => {
    try {
      const { filename } = req.params;
      if (!exportableFiles.includes(filename)) {
        return res.status(400).json({ error: "Invalid file name for export" });
      }
      const fullPath = path.join(localRepoPath, filename);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: "File not found" });
      }
      const raw = req.query.raw === "true";
      if (raw) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        return res.sendFile(fullPath);
      }
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "application/octet-stream");
      res.sendFile(fullPath);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/export/sh", (req, res) => {
    try {
      const host = `${req.protocol}://${req.get("host")}`;
      const fileUrls = exportableFiles.map((f) => `  "${f}"`).join("\n");

      const script = `#!/bin/bash
# ==============================================================================
#  DERIV SPIKE BOT - BRAIN MODULE LIFTER
#  Autogenerated sync client for Android Termux / local environment
# ==============================================================================
set -e

# Setup terminal colors
GREEN='\\033[0;32m'
BLUE='\\033[0;34m'
YELLOW='\\033[1;33m'
RED='\\033[0;31m'
NC='\\033[0m' # No Color

echo -e "\${BLUE}=====================================================\${NC}"
echo -e "\${GREEN}🤖 DERIV SPIKE BOT — SYNCING BRAIN SCRIPTS\${NC}"
echo -e "\${BLUE}=====================================================\${NC}"

# Target folder check
CURRENT_DIR=\$(basename "\$PWD")
if [ "\$CURRENT_DIR" = "local_repo" ] || [ "\$CURRENT_DIR" = "deriv-spike-bot" ] || [ -f "config.py" ] || [ -f "strategy.py" ]; then
  echo -e "\${YELLOW}⚠️  Files will be downloaded and OVERWRITTEN in the current directory: \$PWD\${NC}"
else
  echo -e "\${BLUE}Creating separate directory: 'deriv-spike-bot'...\${NC}"
  mkdir -p deriv-spike-bot
  cd deriv-spike-bot
fi

HOST="${host}"
FILES=(
${fileUrls}
)

echo -e "Pulling from server: \${YELLOW}\$HOST\${NC}\\n"

# Verify curl is present
if ! command -v curl &> /dev/null; then
  echo -e "\${RED}❌ Error: curl is not installed. Please run: pkg install curl\${NC}"
  exit 1
fi

for f in "\${FILES[@]}"; do
  echo -n -e "  📥 Syncing \${BLUE}\$f\${NC}... "
  HTTP_CODE=\$(curl -s -w "%{http_code}" -L "\$HOST/api/export/file/\$f?raw=true" -o "\$f")
  
  if [ "\$HTTP_CODE" -eq 200 ]; then
    echo -e "[\${GREEN}OK\${NC}]"
  else
    echo -e "[\${RED}FAILED - HTTP \$HTTP_CODE\${NC}]"
    exit 1
  fi
done

# Ensure logs and market_data directories exist in the target
mkdir -p logs market_data
touch market_data/.gitkeep

echo -e "\\n\${GREEN}✅ Success: Brain modules updated completely!\${NC}"
echo -e "You can now run: \${YELLOW}python main.py\${NC} or \${YELLOW}python backtester.py BOOM1000\${NC}"
echo -e "\${BLUE}=====================================================\${NC}"
`;

      res.setHeader("Content-Type", "text/x-shellscript; charset=utf-8");
      res.setHeader("Content-Disposition", 'inline; filename="update_brain.sh"');
      res.send(script);
    } catch (err: any) {
      res.status(500).send(`echo "Error generating update script: ${err.message}"`);
    }
  });

  app.get("/api/export/zip", (req, res) => {
    try {
      const zip = new AdmZip();
      
      exportableFiles.forEach((filename) => {
        const fullPath = path.join(localRepoPath, filename);
        if (fs.existsSync(fullPath)) {
          zip.addLocalFile(fullPath);
        }
      });
      
      const marketDataDir = path.join(localRepoPath, "market_data");
      if (fs.existsSync(marketDataDir)) {
        zip.addLocalFile(path.join(marketDataDir, ".gitkeep"), "market_data");
        const csvs = ["BOOM1000_ticks.csv", "BOOM500_ticks.csv", "CRASH1000_ticks.csv", "CRASH500_ticks.csv"];
        csvs.forEach((csvName) => {
          const csvPath = path.join(marketDataDir, csvName);
          if (fs.existsSync(csvPath)) {
            zip.addLocalFile(csvPath, "market_data");
          }
        });
      }

      const zipBuffer = zip.toBuffer();
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="deriv_spike_bot_brain.zip"');
      res.send(zipBuffer);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── STATIC SERVING WITH VITE MIDDLEWARE ───────────────────────────────────

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    
    // Automatically install websocket packages for Python on startup
    console.log("Checking and installing Python Web Socket dependencies...");
    exec("python3 -m pip install websockets websocket-client", (error, stdout, stderr) => {
      if (error) {
        console.error("⚠️ Failed to verify/install python dependencies:", error.message);
      } else {
        console.log("✅ Python dependencies successfully verified:\n", stdout);
      }
    });
  });
}

startServer();
