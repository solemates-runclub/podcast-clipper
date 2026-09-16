const db = require('./db');

// Every update function below only ever builds SQL from its own hardcoded column
// allowlist, never from caller-supplied keys, so request bodies can't inject columns.
function buildUpdate(table, allowedColumns, id, fields) {
  const sets = [];
  const values = [];
  for (const col of allowedColumns) {
    if (Object.prototype.hasOwnProperty.call(fields, col)) {
      sets.push(`${col} = ?`);
      values.push(fields[col]);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

// --- sources ---

const SOURCE_COLUMNS = [
  'youtube_id', 'title', 'duration', 'width', 'height', 'fps', 'file_path',
  'whisper_model', 'language', 'status', 'transcript_json_path', 'error_message',
  'transcribed_at',
];

function createSource({ id, youtubeUrl, youtubeId, title, duration }) {
  db.prepare(
    `INSERT INTO sources (id, youtube_url, youtube_id, title, duration, status) VALUES (?, ?, ?, ?, ?, 'pending')`
  ).run(id, youtubeUrl, youtubeId || null, title || null, duration || null);
}

function updateSource(id, fields) {
  buildUpdate('sources', SOURCE_COLUMNS, id, fields);
}

function getSource(id) {
  return db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
}

function listSources() {
  return db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all();
}

// --- clips ---

const CLIP_COLUMNS = [
  'start_sec', 'end_sec', 'score', 'transcript_snippet', 'topic_text', 'hook_text', 'hook_options',
];

function createClip({ id, sourceId, start, end, score, transcriptSnippet, topicText, hookText, hookOptions }) {
  db.prepare(
    `INSERT INTO clips (id, source_id, start_sec, end_sec, score, transcript_snippet, topic_text, hook_text, hook_options)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, sourceId, start, end, score || null, transcriptSnippet || null, topicText || null, hookText || null, JSON.stringify(hookOptions || []));
}

function updateClip(id, fields) {
  buildUpdate('clips', CLIP_COLUMNS, id, fields);
}

function getClip(id) {
  return db.prepare('SELECT * FROM clips WHERE id = ?').get(id);
}

function listClipsBySource(sourceId) {
  return db.prepare('SELECT * FROM clips WHERE source_id = ? ORDER BY start_sec ASC').all(sourceId);
}

function deleteClipsBySource(sourceId) {
  db.prepare('DELETE FROM clips WHERE source_id = ?').run(sourceId);
}

module.exports = {
  createSource, updateSource, getSource, listSources,
  createClip, updateClip, getClip, listClipsBySource, deleteClipsBySource,
};
