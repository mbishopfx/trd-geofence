const { createWorker, enqueue, closeQueues, hasRedis } = require("../dsp/queues");
const { closeDatabase } = require("../dsp/db");
const { ensureInfrastructure, processSchedulerQueueJob, expireAudienceMemberships } = require("../dsp/service");

const expiryEveryMs = Math.max(60, Number(process.env.SCHEDULER_EXPIRY_INTERVAL_SEC || 3600)) * 1000;
let worker;
let interval;

async function runExpiryTick() {
  if (hasRedis()) {
    await enqueue("schedulerQueue", "expire-memberships", { kind: "expire-memberships" }, { removeOnComplete: 50 });
    return;
  }

  await expireAudienceMemberships("scheduler-worker");
}

async function start() {
  await ensureInfrastructure();

  if (hasRedis()) {
    worker = createWorker(
      "schedulerQueue",
      async (job) => processSchedulerQueueJob(job.data || {}),
      { concurrency: Number(process.env.SCHEDULER_WORKER_CONCURRENCY || 1) }
    );

    worker.on("failed", (job, error) => {
      console.error(`[scheduler-worker] failed ${job?.id || "unknown"}: ${error.message}`);
    });
  }

  await runExpiryTick();
  interval = setInterval(() => {
    runExpiryTick().catch((error) => {
      console.error("scheduler tick failed:", error.message || error);
    });
  }, expiryEveryMs);

  console.log(`scheduler worker started (expiry tick every ${Math.round(expiryEveryMs / 1000)}s)`);
}

async function shutdown(signal) {
  console.log(`scheduler worker shutting down (${signal})`);
  if (interval) {
    clearInterval(interval);
  }
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
  console.error("Failed to start scheduler worker:", error.message || error);
  process.exit(1);
});
