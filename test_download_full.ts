import { spawn } from "child_process";

console.log("⚡ Spawning a full download of BOOM1000 with 50,000 ticks...");
const proc = spawn("npx", ["tsx", "download_ticks.ts", "BOOM1000", "50000"], {
  cwd: process.cwd(),
});

proc.stdout.on("data", (data) => {
  process.stdout.write("OUT: " + data.toString());
});

proc.stderr.on("data", (data) => {
  process.stderr.write("ERR: " + data.toString());
});

proc.on("close", (code) => {
  console.log(`\n🏁 Full download finished with code ${code}`);
});
