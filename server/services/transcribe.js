const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PY_SCRIPT = path.join(__dirname, '..', '..', 'python', 'transcribe.py');
const TMP_DIR = path.join(__dirname, '..', '..', 'tmp');
const VENV_PYTHON = path.join(__dirname, '..', '..', 'python', '.venv', 'Scripts', 'python.exe');

const DEFAULT_MODEL = 'distil-small.en';

// Prefer the project's own venv (set up by scripts/setup.js) so transcription doesn't
// depend on whatever happens to be installed globally on this machine -- that's what
// makes faster-whisper's install portable across PCs instead of a one-off global pip install.
function pythonBin() {
  return fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python';
}

function transcribe(videoPath, sourceId, model = DEFAULT_MODEL) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
    const outJsonPath = path.join(TMP_DIR, `${sourceId}.transcript.json`);

    const proc = spawn(pythonBin(), [PY_SCRIPT, videoPath, outJsonPath, model, 'en'], {
      windowsHide: true,
    });

    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`transcribe.py exited ${code}: ${stderr.slice(-2000)}`));
        return;
      }
      if (!fs.existsSync(outJsonPath)) {
        reject(new Error('transcribe.py finished but produced no output JSON'));
        return;
      }
      resolve(outJsonPath);
    });
  });
}

function loadTranscript(jsonPath) {
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

module.exports = { transcribe, loadTranscript, DEFAULT_MODEL };
