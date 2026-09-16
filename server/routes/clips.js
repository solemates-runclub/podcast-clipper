const express = require('express');
const repo = require('../repo');
const transcribeService = require('../services/transcribe');
const { describeRange } = require('../services/highlights');
const { exportClip } = require('../services/exportClip');

const router = express.Router();

router.get('/', (req, res) => {
  const { sourceId } = req.query;
  if (!sourceId) return res.status(400).json({ error: 'sourceId is required' });
  res.json(repo.listClipsBySource(sourceId));
});

router.get('/:id', (req, res) => {
  const clip = repo.getClip(req.params.id);
  if (!clip) return res.status(404).json({ error: 'not found' });
  res.json(clip);
});

router.patch('/:id', (req, res) => {
  const clip = repo.getClip(req.params.id);
  if (!clip) return res.status(404).json({ error: 'not found' });

  const body = req.body || {};
  const fields = {};

  let start = clip.start_sec;
  let end = clip.end_sec;
  let timesChanged = false;

  if (body.start_sec !== undefined) {
    start = Number(body.start_sec);
    fields.start_sec = start;
    timesChanged = true;
  }
  if (body.end_sec !== undefined) {
    end = Number(body.end_sec);
    fields.end_sec = end;
    timesChanged = true;
  }
  if (body.hook_text !== undefined) fields.hook_text = String(body.hook_text).slice(0, 300);

  if (end <= start) {
    return res.status(400).json({ error: 'end_sec must be after start_sec' });
  }

  if (timesChanged) {
    const source = repo.getSource(clip.source_id);
    if (source && source.transcript_json_path) {
      const transcript = transcribeService.loadTranscript(source.transcript_json_path);
      const { transcriptSnippet, hookOptions, topicText } = describeRange(transcript, start, end);
      fields.transcript_snippet = transcriptSnippet;
      fields.topic_text = topicText;
      fields.hook_options = JSON.stringify(hookOptions);
      // Only replace the hook text with a fresh draft if the user hadn't just set one
      // in this same request and the old hook no longer matches any drafted option.
      if (body.hook_text === undefined && hookOptions.length) {
        fields.hook_text = hookOptions[0];
      }
    }
  }

  repo.updateClip(req.params.id, fields);
  res.json(repo.getClip(req.params.id));
});

router.get('/:id/download', async (req, res) => {
  const clip = repo.getClip(req.params.id);
  if (!clip) return res.status(404).json({ error: 'not found' });
  const source = repo.getSource(clip.source_id);
  if (!source || !source.file_path) {
    return res.status(409).json({ error: 'source video is not available yet' });
  }

  try {
    const outPath = await exportClip({
      id: clip.id,
      sourcePath: source.file_path,
      start: clip.start_sec,
      end: clip.end_sec,
    });
    const filename = `clip-${Math.round(clip.start_sec)}s-${Math.round(clip.end_sec)}s.mp4`;
    res.download(outPath, filename);
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
});

module.exports = router;
