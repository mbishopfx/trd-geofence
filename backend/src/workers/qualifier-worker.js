const { createWorker, closeQueues, hasRedis } = require("../dsp/queues");
const { closeDatabase } = require("../dsp/db");
const { ensureInfrastructure, processQualificationQueueJob } = require("../dsp/service");

let worker;

async function start() {
  await ensureInfrastructure();

  if (!hasRedis()) {
    throw new Error("REDIS_URL is required to run qualifier worker.");
  }

  worker = createWorker(
    "qualifyQueue",
    async (job) => processQualificationQueueJob(job.data || {}),
    { concurrency: Number(process.env.QUALIFIER_WORKER_CONCURRENCY || 6) }
  );

  worker.on("completed", (job) => {
    console.log(`[qualifier-worker] completed ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[qualifier-worker] failed ${job?.id || "unknown"}: ${error.message}`);
  });

  console.log("qualifier worker started");
}

async function shutdown(signal) {
  console.log(`qualifier worker shutting down (${signal})`);
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
  console.error("Failed to start qualifier worker:", error.message || error);
  process.exit(1);
});
