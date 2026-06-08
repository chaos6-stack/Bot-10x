import { spawn } from "child_process";

console.log("⚡ Spawning a non-blocking test run of backtester.py with immediate output flushing...");
const proc = spawn("python3", ["-u", "backtester.py", "BOOM1000", "--apply"], {
  cwd: "local_repo",
  env: {
    ...process.env,
    PYTHONUNBUFFERED: "1",
  }
});

proc.stdout.on("data", (data) => {
  process.stdout.write(data.toString());
});

proc.stderr.on("data", (data) => {
  process.stderr.write(data.toString());
});

proc.on("close", (code) => {
  console.log(`\n🏁 Test finished with code ${code}`);
});
