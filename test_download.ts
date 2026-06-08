import { spawn } from "child_process";

console.log("⚡ Spawning a fast test of download_history.py for BOOM1000 with 1000 ticks...");
const proc = spawn("python3", ["download_history.py", "BOOM1000", "1000"], {
  cwd: "local_repo",
});

proc.stdout.on("data", (data) => {
  process.stdout.write("OUT: " + data.toString());
});

proc.stderr.on("data", (data) => {
  process.stderr.write("ERR: " + data.toString());
});

proc.on("close", (code) => {
  console.log(`\n🏁 Test finished with code ${code}`);
});
