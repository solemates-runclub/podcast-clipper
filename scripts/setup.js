// One-time machine setup. Run after copying/unpacking the project onto a PC:
//   npm install
//   node scripts/setup.js
//
// This rebuilds everything that is specific to *this* machine rather than copying it
// from another one -- the pot-provider's `canvas` addon is a native binary compiled for
// a specific Node version/architecture, so a copy that worked on the old PC can silently
// fail (or crash) on a new one. Re-running this script on a fresh PC regenerates:
//   - bin/yt-dlp.exe
//   - pot-provider/ (downloaded + npm installed + built fresh)
//   - python/.venv (created + faster-whisper installed fresh)
// It never touches data/app.db, cookies.txt, sources/, or .env -- those are your data,
// not build output, and should be copied over manually (see MOVE-TO-NEW-PC.md).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const YTDLP_PATH = path.join(ROOT, 'bin', 'yt-dlp.exe');
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

const POT_PROVIDER_DIR = path.join(ROOT, 'pot-provider');
const POT_PROVIDER_SERVER_DIR = path.join(POT_PROVIDER_DIR, 'server');
const POT_PROVIDER_BUILD = path.join(POT_PROVIDER_SERVER_DIR, 'build', 'main.js');
// Pinned to the version already vetted with this project, so a fresh setup can't pull in
// a newer pot-provider release that changes behavior out from under you.
const POT_PROVIDER_TAG = '1.3.2';
const POT_PROVIDER_ZIP_URL = `https://github.com/Brainicism/bgutil-ytdlp-pot-provider/archive/refs/tags/${POT_PROVIDER_TAG}.zip`;

const PYTHON_DIR = path.join(ROOT, 'python');
const VENV_DIR = path.join(PYTHON_DIR, '.venv');
const VENV_PYTHON = path.join(VENV_DIR, 'Scripts', 'python.exe');
const REQUIREMENTS = path.join(PYTHON_DIR, 'requirements.txt');

function run(cmd, args, opts = {}) {
  console.log(`  $ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', windowsHide: true, shell: false, ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${cmd} exited with code ${res.status}`);
}

function commandExists(cmd) {
  const res = spawnSync('where', [cmd], { windowsHide: true });
  return res.status === 0;
}

async function downloadTo(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  console.log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`  -> ${dest} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
}

async function setupYtDlp() {
  if (fs.existsSync(YTDLP_PATH)) {
    console.log('[yt-dlp] already present, skipping.');
    return;
  }
  await downloadTo(YTDLP_URL, YTDLP_PATH);
}

async function setupPotProvider() {
  if (fs.existsSync(POT_PROVIDER_BUILD)) {
    console.log('[pot-provider] already built, skipping.');
    return;
  }

  console.log(`[pot-provider] fetching bgutil-ytdlp-pot-provider ${POT_PROVIDER_TAG}...`);
  const zipPath = path.join(ROOT, 'tmp', 'pot-provider-src.zip');
  await downloadTo(POT_PROVIDER_ZIP_URL, zipPath);

  const extractDir = path.join(ROOT, 'tmp', 'pot-provider-extract');
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  console.log('[pot-provider] extracting...');
  run('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}" -Force`]);

  const extractedRoot = path.join(extractDir, `bgutil-ytdlp-pot-provider-${POT_PROVIDER_TAG}`);
  fs.rmSync(POT_PROVIDER_DIR, { recursive: true, force: true });
  fs.renameSync(extractedRoot, POT_PROVIDER_DIR);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });

  console.log('[pot-provider] npm install (this builds the native canvas addon for this machine)...');
  run('npm.cmd', ['install'], { cwd: POT_PROVIDER_SERVER_DIR });

  console.log('[pot-provider] compiling...');
  run('npx.cmd', ['tsc'], { cwd: POT_PROVIDER_SERVER_DIR });

  if (!fs.existsSync(POT_PROVIDER_BUILD)) {
    throw new Error('pot-provider build finished but build/main.js was not produced');
  }
  console.log('[pot-provider] ready.');
}

function setupPythonVenv() {
  if (fs.existsSync(VENV_PYTHON)) {
    console.log('[python] venv already present, skipping.');
    return;
  }
  if (!commandExists('python')) {
    console.warn('[python] WARNING: no "python" on PATH -- install Python 3.10+ from python.org, then re-run this script.');
    return;
  }
  console.log('[python] creating virtual environment...');
  run('python', ['-m', 'venv', VENV_DIR]);
  console.log('[python] installing faster-whisper (this can take a few minutes)...');
  run(VENV_PYTHON, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  run(VENV_PYTHON, ['-m', 'pip', 'install', '-r', REQUIREMENTS]);
  console.log('[python] ready.');
}

function checkFfmpeg() {
  const missing = ['ffmpeg', 'ffprobe'].filter((c) => !commandExists(c));
  if (missing.length) {
    console.warn(`[ffmpeg] WARNING: ${missing.join(', ')} not found on PATH.`);
    console.warn('          Install with: winget install --id Gyan.FFmpeg -e');
    console.warn('          (clip export and video probing will not work until this is on PATH)');
  } else {
    console.log('[ffmpeg] found on PATH.');
  }
}

async function main() {
  await setupYtDlp();
  await setupPotProvider();
  setupPythonVenv();
  checkFfmpeg();
  console.log('\nSetup complete. Run start.bat to launch Podcast Clipper.');
}

main().catch((err) => {
  console.error('\nSetup failed:', err.message || err);
  process.exit(1);
});
