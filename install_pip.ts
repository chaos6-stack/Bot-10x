import { exec } from "child_process";

console.log("Installing python packages: websockets, websocket-client...");
exec("python3 -m pip install websockets websocket-client", (err, stdout, stderr) => {
  if (err) {
    console.error("❌ Error during pip install:", err);
    console.error("Stderr:", stderr);
  } else {
    console.log("✅ Packages successfully installed!");
    console.log("Stdout:", stdout);
  }
});
