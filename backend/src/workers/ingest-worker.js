const { createWorker, closeQueues, hasRedis } = require("../dsp/queues");
const { closeDatabase } = require("../dsp/db");
const { ensureInfrastructure, processIngestQueueJob } = require("../dsp/service");

let worker;

async function start() {
  await ensureInfrastructure();

  if (!hasRedis()) {
    throw new Error("REDIS_URL is required to run ingest worker.");
  }

  worker = createWorker(
    "ingestQueue",
    async (job) => processIngestQueueJob(job.data || {}),
    { concurrency: Number(process.env.INGEST_WORKER_CONCURRENCY || 4) }
  );

  worker.on("completed", (job) => {
    console.log(`[ingest-worker] completed ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[ingest-worker] failed ${job?.id || "unknown"}: ${error.message}`);
  });

  console.log("ingest worker started");
}

async function shutdown(signal) {
  console.log(`ingest worker shutting down (${signal})`);
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
  console.error("Failed to start ingest worker:", error.message || error);
  process.exit(1);
});
