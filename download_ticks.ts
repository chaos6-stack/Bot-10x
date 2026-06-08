import fs from "fs";
import path from "path";

const APP_ID = "1089";
const SYMBOLS = ["BOOM1000", "CRASH1000", "BOOM500", "CRASH500"];

async function fetchTicksForSymbol(symbol: string, targetCount: number = 50000): Promise<void> {
  const dirPath = path.join(process.cwd(), "local_repo", "market_data");
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  const csvPath = path.join(dirPath, `${symbol}_ticks.csv`);
  console.log(`Connecting to Deriv to fetch ${targetCount} ticks for ${symbol}...`);

  const uri = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
  
  let allTimes: number[] = [];
  let allPrices: number[] = [];
  
  let remaining = targetCount;
  let endTime: string | number = "latest";
  const batchSize = 5000;

  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      // @ts-ignore - Node.js global WebSocket in node 21+
      ws = new WebSocket(uri);
    } catch (e) {
      reject(new Error("Global WebSocket is not supported on this Node.js version. Please install 'ws' package."));
      return;
    }

    const requestNextBatch = () => {
      if (remaining <= 0) {
        ws.close();
        return;
      }

      const requestCount = Math.min(remaining, batchSize);
      const req = {
        ticks_history: symbol,
        adjust_start_time: 1,
        count: requestCount,
        end: endTime,
        style: "ticks"
      };

      ws.send(JSON.stringify(req));
    };

    ws.onopen = () => {
      requestNextBatch();
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const res = JSON.parse(event.data);
        if (res.error) {
          console.error(`❌ Deriv API Error: ${res.error.message}`);
          ws.close();
          reject(new Error(res.error.message));
          return;
        }

        if (res.history) {
          const times = res.history.times as number[];
          const prices = res.history.prices as number[];

          if (!times || times.length === 0) {
            console.log("No more ticks returned by API.");
            ws.close();
            return;
          }

          // Prepend historical batches to keep chronological order
          allTimes = times.concat(allTimes);
          allPrices = prices.concat(allPrices);

          endTime = times[0];
          remaining -= times.length;

          console.log(`  > Downloaded ${allTimes.length}/${targetCount} ticks...`);
          
          // Brief pause before requesting the next batch to stay under limits
          setTimeout(requestNextBatch, 300);
        } else {
          console.log("Unexpected response shape, closing stream.");
          ws.close();
        }
      } catch (err) {
        console.error("Error processing message:", err);
        ws.close();
        reject(err);
      }
    };

    ws.onerror = (err) => {
      console.error("WebSocket socket error:", err);
      reject(err);
    };

    ws.onclose = () => {
      if (allPrices.length > 0) {
        try {
          const writeStream = fs.createWriteStream(csvPath);
          writeStream.write("Timestamp,Time_UTC,Price\n");
          
          for (let i = 0; i < allPrices.length; i++) {
            const t = allTimes[i];
            const p = allPrices[i];
            const dtString = new Date(t * 1000).toISOString().replace("T", " ").substring(0, 19);
            writeStream.write(`${t},${dtString},${p}\n`);
          }
          
          writeStream.end();
          console.log(`✅ Success! Saved ${allPrices.length} ticks to: ${csvPath}`);
          resolve();
        } catch (err) {
          console.error("Error writing CSV:", err);
          reject(err);
        }
      } else {
        reject(new Error("No ticks downloaded."));
      }
    };
  });
}

// Main runner block
(async () => {
  const args = process.argv.slice(2);
  let symbolsToDownload = SYMBOLS;
  let tickCount = 50000;

  if (args.length > 0) {
    const specifiedSymbol = args[0].toUpperCase();
    if (SYMBOLS.includes(specifiedSymbol)) {
      symbolsToDownload = [specifiedSymbol];
    }
  }

  if (args.length > 1) {
    const countArg = parseInt(args[1], 10);
    if (!isNaN(countArg)) {
      tickCount = countArg;
    }
  }

  for (const symbol of symbolsToDownload) {
    console.log(`\n=== Batch Downloading ${symbol} ===`);
    try {
      await fetchTicksForSymbol(symbol, tickCount);
    } catch (e: any) {
      console.error(`⚠️ Failed to download ${symbol}: ${e.message}`);
    }
  }
})();
