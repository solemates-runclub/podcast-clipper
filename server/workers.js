const repo = require('./repo');
const jobQueue = require('./jobQueue');
const ytdlp = require('./services/ytdlp');
const transcribeService = require('./services/transcribe');

function registerWorkers() {
  jobQueue.registerHandler('download', async (job) => {
    const source = repo.getSource(job.target_id);
    if (!source) throw new Error('source not found');

    repo.updateSource(source.id, { status: 'downloading' });
    try {
      const filePath = await ytdlp.downloadSource(source.youtube_url, source.id);
      const probe = await ytdlp.probeVideo(filePath);

      repo.updateSource(source.id, {
        file_path: filePath,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        duration: probe.duration || source.duration,
        status: 'downloaded',
      });
    } catch (err) {
      repo.updateSource(source.id, { status: 'failed', error_message: String((err && err.message) || err).slice(0, 4000) });
      throw err;
    }

    jobQueue.enqueue('transcribe', source.id);
  });

  jobQueue.registerHandler('transcribe', async (job) => {
    const source = repo.getSource(job.target_id);
    if (!source) throw new Error('source not found');

    repo.updateSource(source.id, { status: 'transcribing' });
    try {
      const model = source.whisper_model || transcribeService.DEFAULT_MODEL;
      const jsonPath = await transcribeService.transcribe(source.file_path, source.id, model);

      repo.updateSource(source.id, {
        transcript_json_path: jsonPath,
        whisper_model: model,
        status: 'ready',
        transcribed_at: new Date().toISOString(),
      });
    } catch (err) {
      repo.updateSource(source.id, { status: 'failed', error_message: String((err && err.message) || err).slice(0, 4000) });
      throw err;
    }
  });
}

module.exports = { registerWorkers };
