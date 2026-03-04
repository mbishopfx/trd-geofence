const { spawn } = require("child_process");
const path = require("path");

const workers = [
  "ingest-worker.js",
  "qualifier-worker.js",
  "activation-worker.js",
  "scheduler-worker.js"
];

const children = workers.map((file) => {
  const child = spawn(process.execPath, [path.resolve(__dirname, file)], {
    stdio: "inherit",
    env: process.env
  });

  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`${file} exited with code ${code}`);
      process.exitCode = 1;
    }
  });

  return child;
});

function shutdown(signal) {
  console.log(`run-all worker shutdown (${signal})`);
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
