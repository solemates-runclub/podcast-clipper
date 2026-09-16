const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { exportClip } = require('./exportClip');

function slugify(text, maxLen = 40) {
  const slug = (text || 'clip')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
  return slug || 'clip';
}

function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
    });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`powershell exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

// Exports every clip for a source (fast lossless trims, same as the single-clip
// download), stages them under readable numbered filenames, and zips them into one
// archive so the whole batch downloads as a single file.
async function exportAllClipsZip(source, clips) {
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podcast-clipper-batch-'));
  try {
    let i = 1;
    for (const clip of clips) {
      const outPath = await exportClip({
        id: clip.id,
        sourcePath: source.file_path,
        start: clip.start_sec,
        end: clip.end_sec,
      });
      const niceName = `${String(i).padStart(2, '0')}-${slugify(clip.hook_text)}.mp4`;
      fs.copyFileSync(outPath, path.join(stageDir, niceName));
      i++;
    }

    const zipPath = path.join(os.tmpdir(), `podcast-clipper-${source.id}-${Date.now()}.zip`);
    await runPowerShell(
      `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force`
    );
    return zipPath;
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

module.exports = { exportAllClipsZip };
