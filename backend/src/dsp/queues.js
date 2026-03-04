const IORedis = require("ioredis");
const { Queue, Worker, QueueEvents } = require("bullmq");
const { dspConfig } = require("./config");

let connection;
let ingestQueue;
let qualifyQueue;
let activationQueue;
let schedulerQueue;
let queueEvents;

function hasRedis() {
  return Boolean(dspConfig.redisUrl);
}

function getConnection() {
  if (!hasRedis()) {
    return null;
  }

  if (!connection) {
    connection = new IORedis(dspConfig.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    });
  }

  return connection;
}

function queueName(name) {
  return `${String(dspConfig.queuePrefix || "trd_dsp").replace(/[:\\s]+/g, "_")}-${name}`;
}

function getQueues() {
  const conn = getConnection();
  if (!conn) {
    return null;
  }

  if (!ingestQueue) {
    ingestQueue = new Queue(queueName("ingest"), { connection: conn });
    qualifyQueue = new Queue(queueName("qualify"), { connection: conn });
    activationQueue = new Queue(queueName("activation"), { connection: conn });
    schedulerQueue = new Queue(queueName("scheduler"), { connection: conn });
    queueEvents = new QueueEvents(queueName("activation"), { connection: conn });
  }

  return {
    ingestQueue,
    qualifyQueue,
    activationQueue,
    schedulerQueue,
    queueEvents
  };
}

async function enqueue(queueKey, name, data, opts = {}) {
  const queues = getQueues();
  if (!queues) {
    return null;
  }

  const queue = queues[queueKey];
  if (!queue) {
    throw new Error(`Queue not found: ${queueKey}`);
  }

  return queue.add(name, data, opts);
}

function createWorker(queueKey, processor, options = {}) {
  const queues = getQueues();
  if (!queues) {
    return null;
  }

  const queue = queues[queueKey];
  if (!queue) {
    throw new Error(`Queue not found: ${queueKey}`);
  }

  const name = queue.name;
  return new Worker(name, processor, {
    connection: getConnection(),
    concurrency: options.concurrency || 2,
    ...(options.settings ? { settings: options.settings } : {})
  });
}

async function closeQueues() {
  const queues = [ingestQueue, qualifyQueue, activationQueue, schedulerQueue].filter(Boolean);
  for (const queue of queues) {
    await queue.close();
  }

  if (queueEvents) {
    await queueEvents.close();
  }

  if (connection) {
    await connection.quit();
  }

  ingestQueue = null;
  qualifyQueue = null;
  activationQueue = null;
  schedulerQueue = null;
  queueEvents = null;
  connection = null;
}

module.exports = {
  hasRedis,
  getConnection,
  getQueues,
  enqueue,
  createWorker,
  closeQueues
};
