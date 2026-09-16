const fs = require('fs');
const express = require('express');
const { nanoid } = require('nanoid');
const repo = require('../repo');
const jobQueue = require('../jobQueue');
const ytdlp = require('../services/ytdlp');
const transcribeService = require('../services/transcribe');
const { generateHighlights } = require('../services/highlights');
const { exportAllClipsZip } = require('../services/exportBatch');

const router = express.Router();

const MAX_CLIP_COUNT = 50;
const MIN_DURATION = 5;
const MAX_DURATION = 300;

router.get('/', (req, res) => {
  res.json(repo.listSources());
});

router.post('/', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  try {
    const meta = await ytdlp.fetchMetadata(url);
    const id = meta.youtubeId || nanoid();
    const existing = repo.getSource(id);
    if (existing) {
      return res.status(409).json({ error: 'this source was already added', source: existing });
    }
    repo.createSource({ id, youtubeUrl: url, youtubeId: meta.youtubeId, title: meta.title, duration: meta.duration });
    jobQueue.enqueue('download', id);
    res.status(201).json(repo.getSource(id));
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
});

router.get('/:id', (req, res) => {
  const source = repo.getSource(req.params.id);
  if (!source) return res.status(404).json({ error: 'not found' });
  res.json(source);
});

router.post('/:id/retranscribe', (req, res) => {
  const source = repo.getSource(req.params.id);
  if (!source) return res.status(404).json({ error: 'not found' });
  if (!source.file_path) {
    return res.status(409).json({ error: 'source has not finished downloading yet' });
  }
  // Clear the pinned model so this re-run always picks up the current default
  // (e.g. after upgrading the model/VAD settings), not whatever was used last time.
  repo.updateSource(source.id, { whisper_model: null });
  jobQueue.enqueue('transcribe', source.id);
  res.json({ ok: true });
});

router.post('/:id/generate-clips', (req, res) => {
  const source = repo.getSource(req.params.id);
  if (!source) return res.status(404).json({ error: 'not found' });
  if (source.status !== 'ready') {
    return res.status(409).json({ error: `source is not ready yet (status: ${source.status})` });
  }

  const count = Number((req.body || {}).count);
  const duration = Number((req.body || {}).duration);

  if (!Number.isFinite(count) || count < 1 || count > MAX_CLIP_COUNT) {
    return res.status(400).json({ error: `count must be between 1 and ${MAX_CLIP_COUNT}` });
  }
  if (!Number.isFinite(duration) || duration < MIN_DURATION || duration > MAX_DURATION) {
    return res.status(400).json({ error: `duration must be between ${MIN_DURATION} and ${MAX_DURATION} seconds` });
  }

  const transcript = transcribeService.loadTranscript(source.transcript_json_path);
  const highlights = generateHighlights(transcript, { count, targetLen: duration });

  repo.deleteClipsBySource(source.id);
  for (const h of highlights) {
    repo.createClip({
      id: nanoid(),
      sourceId: source.id,
      start: h.start,
      end: h.end,
      score: h.score,
      transcriptSnippet: h.transcriptSnippet,
      topicText: h.topicText,
      hookText: h.hookOptions[0],
      hookOptions: h.hookOptions,
    });
  }

  res.json(repo.listClipsBySource(source.id));
});

router.get('/:id/download-all', async (req, res) => {
  const source = repo.getSource(req.params.id);
  if (!source) return res.status(404).json({ error: 'not found' });
  if (!source.file_path) {
    return res.status(409).json({ error: 'source video is not available yet' });
  }
  const clips = repo.listClipsBySource(source.id);
  if (clips.length === 0) {
    return res.status(404).json({ error: 'no clips to download for this source' });
  }

  try {
    const zipPath = await exportAllClipsZip(source, clips);
    const filename = `${(source.title || source.id).replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}-clips.zip`;
    res.download(zipPath, filename, () => {
      fs.unlink(zipPath, () => {});
    });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
});

module.exports = router;
