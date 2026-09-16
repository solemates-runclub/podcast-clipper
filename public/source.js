const params = new URLSearchParams(location.search);
const sourceId = params.get('id');
const headerEl = document.getElementById('source-header');
const listEl = document.getElementById('clips-list');
const generateBtn = document.getElementById('generate-btn');
const generateError = document.getElementById('generate-error');
const countInput = document.getElementById('clip-count');
const durationInput = document.getElementById('clip-duration');
const downloadAllPanel = document.getElementById('download-all-panel');
const downloadAllCount = document.getElementById('download-all-count');
const downloadAllLink = document.getElementById('download-all-link');
let previewSessionActive = false;

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

let currentSource = null;

async function loadSource() {
  const res = await fetch(`/api/sources/${encodeURIComponent(sourceId)}`);
  if (!res.ok) {
    headerEl.innerHTML = '<div class="empty">Source not found.</div>';
    return null;
  }
  const source = await res.json();
  currentSource = source;
  const canRetranscribe = !!source.file_path && source.status !== 'downloading' && source.status !== 'transcribing';
  headerEl.innerHTML = `
    <div class="row between">
      <div>
        <div style="font-weight:700; font-size:16px;">${escapeHtml(source.title || source.id)}</div>
        <div class="dim mt8">${fmtTime(source.duration)} total &middot; status: ${escapeHtml(source.status)}${source.whisper_model ? ' &middot; model: ' + escapeHtml(source.whisper_model) : ''}${source.error_message ? ' &middot; ' + escapeHtml(source.error_message) : ''}</div>
      </div>
      <button class="secondary" id="retranscribe-btn" ${canRetranscribe ? '' : 'disabled'}>Re-transcribe</button>
    </div>
  `;
  generateBtn.disabled = source.status !== 'ready';
  document.getElementById('retranscribe-btn').addEventListener('click', async () => {
    await fetch(`/api/sources/${encodeURIComponent(sourceId)}/retranscribe`, { method: 'POST' });
    await refresh();
  });
  return source;
}

function hookOptionsHtml(clip) {
  let options = [];
  try { options = JSON.parse(clip.hook_options || '[]'); } catch (e) { options = []; }
  if (!options.length) return '';
  return `
    <div class="hook-options">
      ${options.map((opt) => `
        <div class="hook-option ${opt === clip.hook_text ? 'selected' : ''}" data-action="select-hook" data-clip-id="${clip.id}" data-value="${escapeHtml(opt)}">
          ${escapeHtml(opt)}
        </div>
      `).join('')}
    </div>
  `;
}

function topicHtml(clip) {
  if (!clip.topic_text) return '';
  const isQuestion = clip.topic_text.trim().endsWith('?');
  const label = isQuestion ? 'Question this clip answers' : 'What this clip is about';
  return `
    <div class="topic-box">
      <div class="dim" style="font-size:11px; text-transform:uppercase; letter-spacing:0.04em;">${label}</div>
      <div class="topic-text">${escapeHtml(clip.topic_text)}</div>
    </div>
  `;
}

function clipCardHtml(clip) {
  return `
    <div class="card clip-card" data-clip-id="${clip.id}">
      ${topicHtml(clip)}
      <div class="row between">
        <div class="clip-meta">
          <span class="dim">start</span>
          <input class="time-field" type="number" step="0.5" data-role="start-sec" data-clip-id="${clip.id}" value="${clip.start_sec.toFixed(1)}" />
          <span class="dim">end</span>
          <input class="time-field" type="number" step="0.5" data-role="end-sec" data-clip-id="${clip.id}" value="${clip.end_sec.toFixed(1)}" />
          <span class="dim">(${fmtTime(clip.end_sec - clip.start_sec)} long)</span>
        </div>
      </div>

      <video class="preview" controls preload="none" data-role="preview-video" data-clip-id="${clip.id}"></video>
      <div class="row">
        <button class="secondary" data-action="preview" data-clip-id="${clip.id}">Preview clip range</button>
        <a href="/api/clips/${clip.id}/download"><button class="secondary" type="button">Download clip</button></a>
      </div>

      <div class="row between">
        <span class="dim">Transcript</span>
        <button class="secondary" data-action="copy-transcript" data-clip-id="${clip.id}">Copy</button>
      </div>
      <textarea readonly data-role="transcript" style="min-height:80px;">${escapeHtml(clip.transcript_snippet)}</textarea>

      <div class="row between">
        <span class="dim">Hook text</span>
        <button class="secondary" data-action="copy-hook" data-clip-id="${clip.id}">Copy</button>
      </div>
      ${hookOptionsHtml(clip)}
      <textarea data-role="hook-text" data-clip-id="${clip.id}" placeholder="Hook headline...">${escapeHtml(clip.hook_text)}</textarea>
    </div>
  `;
}

let clipsCache = [];

async function loadClips(source) {
  const res = await fetch(`/api/clips?sourceId=${encodeURIComponent(sourceId)}`);
  clipsCache = await res.json();

  if (clipsCache.length === 0) {
    downloadAllPanel.style.display = 'none';
    listEl.innerHTML = source.status === 'ready'
      ? '<div class="empty">No clips generated yet. Set a count and duration above, then click Generate.</div>'
      : `<div class="empty">Waiting for download/transcription to finish (status: ${escapeHtml(source.status)})...</div>`;
    return;
  }

  downloadAllPanel.style.display = 'flex';
  downloadAllCount.textContent = `${clipsCache.length} clip${clipsCache.length === 1 ? '' : 's'}`;
  downloadAllLink.href = `/api/sources/${encodeURIComponent(sourceId)}/download-all`;

  listEl.innerHTML = clipsCache.map(clipCardHtml).join('');
}

async function patchClip(id, fields) {
  const res = await fetch(`/api/clips/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return res.json();
}

function getClip(id) {
  return clipsCache.find((c) => c.id === id);
}

async function copyToClipboard(text, buttonEl) {
  const original = buttonEl ? buttonEl.textContent : null;
  try {
    await navigator.clipboard.writeText(text || '');
    if (buttonEl) buttonEl.textContent = 'Copied!';
  } catch (e) {
    if (buttonEl) buttonEl.textContent = 'Copy failed';
  }
  if (buttonEl) {
    setTimeout(() => { buttonEl.textContent = original; }, 1200);
  }
}

listEl.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const clipId = el.dataset.clipId;
  const action = el.dataset.action;

  if (action === 'select-hook') {
    const value = el.dataset.value;
    await patchClip(clipId, { hook_text: value });
    await refresh();
  } else if (action === 'copy-transcript') {
    const clip = getClip(clipId);
    await copyToClipboard(clip && clip.transcript_snippet, el);
  } else if (action === 'copy-hook') {
    const clip = getClip(clipId);
    await copyToClipboard(clip && clip.hook_text, el);
  } else if (action === 'preview') {
    const clip = getClip(clipId);
    const card = el.closest('.clip-card');
    const video = card.querySelector('[data-role="preview-video"]');
    previewSessionActive = true;
    const startPlayback = () => {
      video.currentTime = clip.start_sec;
      video.play();
    };
    if (!video.dataset.loaded) {
      video.src = `/media/sources/${encodeURIComponent(sourceId)}.mp4`;
      video.dataset.loaded = '1';
      video.addEventListener('loadedmetadata', startPlayback, { once: true });
    } else {
      startPlayback();
    }
    const endSession = () => {
      previewSessionActive = false;
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('pause', endSession);
      video.removeEventListener('ended', endSession);
    };
    const onTimeUpdate = () => {
      if (video.currentTime >= clip.end_sec) {
        video.pause();
      }
    };
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('pause', endSession);
    video.addEventListener('ended', endSession);
  }
});

listEl.addEventListener('change', async (e) => {
  const el = e.target;
  const clipId = el.dataset.clipId;
  if (!clipId) return;
  const role = el.dataset.role;

  if (role === 'start-sec') {
    await patchClip(clipId, { start_sec: Number(el.value) });
    await refresh();
  } else if (role === 'end-sec') {
    await patchClip(clipId, { end_sec: Number(el.value) });
    await refresh();
  }
});

listEl.addEventListener('blur', async (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.role === 'hook-text') {
    await patchClip(el.dataset.clipId, { hook_text: el.value });
  }
}, true);

generateBtn.addEventListener('click', async () => {
  generateError.style.display = 'none';
  const count = Number(countInput.value);
  const duration = Number(durationInput.value);
  generateBtn.disabled = true;
  try {
    const res = await fetch(`/api/sources/${encodeURIComponent(sourceId)}/generate-clips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count, duration }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'failed to generate clips');
    await refresh();
  } catch (err) {
    generateError.textContent = err.message;
    generateError.style.display = 'block';
  } finally {
    generateBtn.disabled = !currentSource || currentSource.status !== 'ready';
  }
});

async function refresh() {
  const source = await loadSource();
  if (!source) return;
  await loadClips(source);
}

refresh();
setInterval(() => {
  const active = document.activeElement;
  const isTyping = active && listEl.contains(active) && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');
  if (!isTyping && !previewSessionActive) refresh();
}, 5000);
