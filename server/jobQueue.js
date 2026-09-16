const { nanoid } = require('nanoid');
const db = require('./db');

const insertJob = db.prepare(`INSERT INTO jobs (id, type, target_id, status) VALUES (?, ?, ?, 'pending')`);
const nextPending = db.prepare(`SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`);
const markRunning = db.prepare(`UPDATE jobs SET status='running', started_at=datetime('now'), attempts=attempts+1 WHERE id=?`);
const markDone = db.prepare(`UPDATE jobs SET status='done', finished_at=datetime('now') WHERE id=?`);
const markFailed = db.prepare(`UPDATE jobs SET status='failed', finished_at=datetime('now'), error_message=? WHERE id=?`);

const handlers = {};

function registerHandler(type, fn) {
  handlers[type] = fn;
}

function enqueue(type, targetId) {
  const id = nanoid();
  insertJob.run(id, type, targetId);
  kick();
  return id;
}

// Both whisper transcription and ffmpeg encoding are CPU-bound on this no-GPU box, so
// jobs run strictly sequentially — parallelizing would just cause resource contention.
let running = false;

async function processNext() {
  const job = nextPending.get();
  if (!job) return false;
  markRunning.run(job.id);
  try {
    const handler = handlers[job.type];
    if (!handler) throw new Error(`no handler registered for job type "${job.type}"`);
    await handler(job);
    markDone.run(job.id);
  } catch (err) {
    console.error(`[jobQueue] job ${job.id} (${job.type}) failed:`, err);
    markFailed.run(String((err && err.message) || err).slice(0, 4000), job.id);
  }
  return true;
}

async function loop() {
  if (running) return;
  running = true;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const did = await processNext();
      if (!did) break;
    }
  } finally {
    running = false;
  }
}

function kick() {
  loop().catch((err) => console.error('[jobQueue] loop error', err));
}

function start() {
  kick();
  // Backstop poll: picks up any pending job even if enqueue() was called from a
  // process that has since restarted (the jobs table survives restarts).
  setInterval(kick, 5000);
}

module.exports = { registerHandler, enqueue, start };
