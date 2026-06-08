import { spawn } from "child_process";

console.log("🚀 Spawning Python Backtester & Optimizer on BOOM1000...");
const proc = spawn("python3", ["backtester.py", "BOOM1000", "--apply"], {
  cwd: "local_repo",
});

proc.stdout.on("data", (data) => {
  process.stdout.write(data.toString());
});

proc.stderr.on("data", (data) => {
  process.stderr.write(data.toString());
});

proc.on("close", (code) => {
  console.log(`\n🏁 Optimizer finished with exit code ${code}`);
});
