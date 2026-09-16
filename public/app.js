const listEl = document.getElementById('sources-list');
const form = document.getElementById('add-form');
const urlInput = document.getElementById('url-input');
const errorEl = document.getElementById('add-error');

function statusBadge(status) {
  return `<span class="badge ${status}">${status}</span>`;
}

function fmtDuration(sec) {
  if (!sec) return '--:--';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

async function loadSources() {
  const res = await fetch('/api/sources');
  const sources = await res.json();

  if (sources.length === 0) {
    listEl.innerHTML = '<div class="empty">No sources yet. Paste a YouTube or Google Drive URL above to get started.</div>';
    return;
  }

  listEl.innerHTML = sources
    .map((s) => {
      const clickable = s.status === 'ready';
      const titleHtml = clickable
        ? `<a class="source-link" href="/source.html?id=${encodeURIComponent(s.id)}">${escapeHtml(s.title || s.id)}</a>`
        : `<span>${escapeHtml(s.title || s.id)}</span>`;
      return `
        <div class="card row between">
          <div>
            ${titleHtml}
            <div class="dim mt8">${fmtDuration(s.duration)} ${s.error_message ? '&middot; ' + escapeHtml(s.error_message) : ''}</div>
          </div>
          ${statusBadge(s.status)}
        </div>
      `;
    })
    .join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.style.display = 'none';
  const url = urlInput.value.trim();
  if (!url) return;
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    const res = await fetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'failed to add source');
    urlInput.value = '';
    await loadSources();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
});

loadSources();
setInterval(loadSources, 4000);
