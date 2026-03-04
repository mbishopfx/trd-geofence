const { spawn } = require("child_process");
const path = require("path");

const role = String(process.env.SERVICE_ROLE || "api").trim().toLowerCase();

const roleToScript = {
  api: path.resolve(__dirname, "..", "server.js"),
  ingest: path.resolve(__dirname, "workers", "ingest-worker.js"),
  qualifier: path.resolve(__dirname, "workers", "qualifier-worker.js"),
  activation: path.resolve(__dirname, "workers", "activation-worker.js"),
  scheduler: path.resolve(__dirname, "workers", "scheduler-worker.js"),
  "all-workers": path.resolve(__dirname, "workers", "run-all.js")
};

const script = roleToScript[role] || roleToScript.api;

console.log(`[runner] SERVICE_ROLE=${role} -> ${path.relative(process.cwd(), script)}`);

const child = spawn(process.execPath, [script], {
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code || 0);
});

function forward(signal) {
  if (!child.killed) {
    child.kill(signal);
  }
}

process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));
