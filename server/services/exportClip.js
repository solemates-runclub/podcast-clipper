const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXPORT_DIR = path.join(__dirname, '..', '..', 'tmp', 'clip-exports');

// Lossless stream-copy trim -- no re-encoding, so it's near-instant regardless of the
// source's length/resolution. Note: since there's no decoding, ffmpeg can only cut at
// the nearest preceding keyframe for the start point (typically within a couple of
// seconds), so the exported file may start slightly earlier than clip.start_sec. That's
// fine here -- the user does the precise trim themselves in CapCut; this just hands
// them a full-quality, much smaller file instead of the whole source.
function exportClip({ id, sourcePath, start, end }) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });
    const outPath = path.join(EXPORT_DIR, `${id}.mp4`);
    const duration = end - start;

    const args = [
      '-y',
      '-ss', String(start),
      '-i', sourcePath,
      '-t', String(duration),
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      outPath,
    ];

    const proc = spawn('ffmpeg', args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath)) {
        resolve(outPath);
      } else {
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`));
      }
    });
  });
}

module.exports = { exportClip };
