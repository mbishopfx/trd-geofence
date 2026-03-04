const { createWorker, closeQueues, hasRedis } = require("../dsp/queues");
const { closeDatabase } = require("../dsp/db");
const { ensureInfrastructure, processActivationQueueJob } = require("../dsp/service");

let worker;

async function start() {
  await ensureInfrastructure();

  if (!hasRedis()) {
    throw new Error("REDIS_URL is required to run activation worker.");
  }

  worker = createWorker(
    "activationQueue",
    async (job) => processActivationQueueJob(job.data || {}),
    { concurrency: Number(process.env.ACTIVATION_WORKER_CONCURRENCY || 3) }
  );

  worker.on("completed", (job) => {
    console.log(`[activation-worker] completed ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[activation-worker] failed ${job?.id || "unknown"}: ${error.message}`);
  });

  console.log("activation worker started");
}

async function shutdown(signal) {
  console.log(`activation worker shutting down (${signal})`);
  if (worker) {
    await worker.close();
  }
  await Promise.allSettled([closeQueues(), closeDatabase()]);
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT").catch(() => process.exit(1));
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch(() => process.exit(1));
});

start().catch((error) => {
  console.error("Failed to start activation worker:", error.message || error);
  process.exit(1);
});
