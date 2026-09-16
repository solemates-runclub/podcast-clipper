const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const YTDLP_BIN = path.join(__dirname, '..', '..', 'bin', 'yt-dlp.exe');
const SOURCES_DIR = path.join(__dirname, '..', '..', 'sources');

function ensureYtDlp() {
  if (!fs.existsSync(YTDLP_BIN)) {
    throw new Error('bin/yt-dlp.exe not found. Run "node scripts/setup.js" first.');
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-2000) || stdout.slice(-2000)}`));
    });
  });
}

// YouTube occasionally demands proof of a real signed-in session ("Sign in to confirm
// you're not a bot"), especially from non-residential-feeling traffic patterns. Rather
// than paying the cost of attaching cookies on every request, only retry with them when
// a request actually hits that specific wall.
const COOKIES_FILE = path.join(__dirname, '..', '..', 'cookies.txt');
const COOKIES_BROWSER = 'chrome';

function isBotCheckError(message) {
  return /sign in to confirm/i.test(message || '');
}

// A static exported cookies.txt is preferred over live --cookies-from-browser
// extraction: reading a running browser's cookie DB on Windows fails whenever that
// browser is actually open (file lock), whereas a file has no such dependency.
function cookieArgs() {
  if (fs.existsSync(COOKIES_FILE)) {
    return ['--cookies', COOKIES_FILE];
  }
  return ['--cookies-from-browser', COOKIES_BROWSER];
}

// YouTube's "n" signature challenge requires yt-dlp to run a bit of YouTube's own JS
// locally to descramble format URLs; without an enabled JS runtime, formats can be
// silently degraded or missing. Node isn't auto-enabled for this (unlike Deno), so it
// has to be requested explicitly. The bundled yt-dlp.exe already ships the solver
// scripts themselves (yt-dlp-ejs), so this is the only extra flag needed.
// Separately, the bgutil PO-token provider server (pot-provider/) supplies the proof-
// of-origin token YouTube increasingly requires; yt-dlp finds it automatically via its
// plugin in bin/yt-dlp-plugins as long as that server is running on its default port.
const BASE_ARGS = ['--js-runtimes', 'node'];

async function runYtDlp(args) {
  ensureYtDlp();
  const fullArgs = [...BASE_ARGS, ...args];
  try {
    return await run(YTDLP_BIN, fullArgs);
  } catch (err) {
    if (isBotCheckError(err.message)) {
      return run(YTDLP_BIN, [...fullArgs, ...cookieArgs()]);
    }
    throw err;
  }
}

async function fetchMetadata(url) {
  const { stdout } = await runYtDlp(['--no-playlist', '--dump-single-json', '--no-warnings', url]);
  const info = JSON.parse(stdout);
  return {
    youtubeId: info.id,
    title: info.title || info.id,
    duration: info.duration || null,
  };
}

// True best available video+audio, any codec/resolution -- no reason to cap at 1080p/
// H.264 anymore since nothing re-encodes the source (clip export is a lossless stream
// copy, and preview playback in a modern browser handles VP9/AV1 fine).
const FORMAT = 'bv*+ba/b';

async function downloadSource(url, id) {
  if (!fs.existsSync(SOURCES_DIR)) fs.mkdirSync(SOURCES_DIR, { recursive: true });
  const outTemplate = path.join(SOURCES_DIR, `${id}.%(ext)s`);
  await runYtDlp([
    '--no-playlist',
    '-f', FORMAT,
    '--merge-output-format', 'mp4',
    '--no-warnings',
    '-o', outTemplate,
    url,
  ]);
  const finalPath = path.join(SOURCES_DIR, `${id}.mp4`);
  if (!fs.existsSync(finalPath)) {
    throw new Error('yt-dlp finished but expected output file was not found: ' + finalPath);
  }
  return finalPath;
}

async function probeVideo(filePath) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate',
    '-show_entries', 'format=duration',
    '-of', 'json',
    filePath,
  ]);
  const info = JSON.parse(stdout);
  const stream = (info.streams && info.streams[0]) || {};
  let fps = 30;
  if (stream.r_frame_rate) {
    const [num, den] = stream.r_frame_rate.split('/').map(Number);
    if (den) fps = num / den;
  }
  return {
    width: stream.width || null,
    height: stream.height || null,
    fps,
    duration: info.format ? Number(info.format.duration) : null,
  };
}

module.exports = { fetchMetadata, downloadSource, probeVideo, ensureYtDlp, YTDLP_BIN };
