// ============================================================
//  watch.js — read-only "watch" page
//  Shows the litter overview + family album with live updates.
//  No buttons, no writes — safe to share with anyone you'd let
//  peek at the pups.
// ============================================================
import { createStore } from './store.js';

const $ = s => document.querySelector(s);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 86400000;
const dateAt = iso => new Date(iso + 'T00:00:00');
const r2 = v => Math.round(v * 100) / 100;
const UNIT = { lb: 'lb', kg: 'kg', oz: 'oz', g: 'g' };

const currentWeight = p =>
  p.weights.length ? p.weights[p.weights.length - 1].weight : (p.birthWeight ?? null);
const genderGlyph = p =>
  p.gender === 'f' ? '<span class="gender">♀</span>' : p.gender === 'm' ? '<span class="gender">♂</span>' : '';
const miniAvatar = p => {
  const src = p.avatar || p.photos[0]?.dataUrl;
  return src ? `<img class="mini" src="${src}" alt="">` : `<span class="mini">${esc(p.emoji || '🐶')}</span>`;
};

// same newborn rule as the app: 5–10% of the baseline weight per day
function gainStatus(p) {
  const first = p.weights[0];
  let baseW = null, baseDate = null;
  if (p.birthWeight && p.birthday) { baseW = p.birthWeight; baseDate = p.birthday; }
  else if (first) { baseW = first.weight; baseDate = first.dateISO; }
  if (!baseW || !baseDate) return { gain: null, cls: '', glyph: '—' };
  const last = p.weights[p.weights.length - 1], prev = p.weights[p.weights.length - 2];
  let lastDaily = null, avgDaily = null;
  if (last && prev) {
    const days = Math.max(1, Math.round((dateAt(last.dateISO) - dateAt(prev.dateISO)) / DAY));
    lastDaily = (last.weight - prev.weight) / days;
  }
  if (last && last.dateISO > baseDate) {
    const days = Math.max(1, Math.round((dateAt(last.dateISO) - dateAt(baseDate)) / DAY));
    avgDaily = (last.weight - baseW) / days;
  }
  const signal = lastDaily ?? avgDaily;
  if (signal == null) return { gain: null, cls: '', glyph: '—' };
  if (signal <= 0) return { gain: signal, cls: 'bad', glyph: '▼' };
  if (signal < baseW * 0.05) return { gain: signal, cls: 'warn', glyph: '⚠' };
  return { gain: signal, cls: 'good', glyph: '✓' };
}

function render(state) {
  const unit = UNIT[state.settings.weightUnit] || '';
  const pups = state.puppies;

  // day pill
  const bdays = [...new Set(pups.map(p => p.birthday).filter(Boolean))];
  $('#w-day').textContent = (bdays.length === 1 && pups.length && pups.every(p => p.birthday))
    ? 'day ' + Math.max(0, Math.floor((Date.now() - dateAt(bdays[0]).getTime()) / DAY))
    : pups.length + ' pups';

  // litter table — smallest first, read-only
  const rows = pups.map(p => ({ p, st: gainStatus(p), w: currentWeight(p) }))
    .sort((a, b) => (a.w ?? Infinity) - (b.w ?? Infinity));
  const weighed = rows.filter(r => r.w != null);
  const minW = weighed.length ? weighed[0].w : null;
  const box = $('#w-litter');
  if (!pups.length) { box.innerHTML = '<div class="empty">No puppies yet 🐶</div>'; }
  else {
    box.innerHTML = `
      <div class="lrow lhead"><span>Pup</span><span>Weight</span><span>Gain/day</span><span>Status</span></div>
      ${rows.map(({ p, st, w }) => `
        <div class="lrow" style="cursor:default">
          <span class="lname">${miniAvatar(p)}<span class="lname-t">${esc(p.name)}</span>${genderGlyph(p)}${w != null && w === minW && weighed.length > 1 ? ' <em class="runt">smallest</em>' : ''}</span>
          <span class="lval">${w != null ? r2(w) + ' ' + unit : '—'}</span>
          <span class="lval">${st.gain != null ? (st.gain > 0 ? '+' : '') + r2(st.gain) : '—'}</span>
          <span class="lstat ${st.cls}">${st.glyph}</span>
        </div>`).join('')}
      <div class="lfoot">${pups.length} pups${weighed.length ? ` · ${weighed.length} weighed · ${r2(weighed.reduce((s, r) => s + r.w, 0))} ${unit} total` : ''}</div>`;
  }

  // family album — grid, tap to expand (view + save only)
  const photos = state.familyPhotos || [];
  $('#w-count').textContent = `${photos.length} photo${photos.length === 1 ? '' : 's'}`;
  const grid = $('#w-album');
  grid.innerHTML = '';
  if (!photos.length) {
    grid.appendChild(h(`<div class="empty" style="grid-column:1/-1">No family photos yet</div>`));
  }
  for (const ph of photos) {
    const fig = h(`<figure><img src="${ph.dataUrl}" alt="" loading="lazy"><figcaption>${esc(ph.dateISO || '')}</figcaption></figure>`);
    fig.querySelector('img').addEventListener('click', () => openLightbox(ph.dataUrl));
    grid.appendChild(fig);
  }
}

// lightbox: expand + save, nothing destructive
function openLightbox(src) {
  const lb = h(`
    <div class="lightbox">
      <img src="${src}" alt="">
      <div class="lb-actions">
        <button class="btn" id="lb-save">⬇ Save</button>
        <button class="btn ghost" id="lb-close">✕ Close</button>
      </div>
    </div>`);
  const close = () => lb.remove();
  lb.addEventListener('click', e => { if (e.target === lb) close(); });
  lb.querySelector('#lb-close').addEventListener('click', close);
  lb.querySelector('#lb-save').addEventListener('click', async () => {
    try {
      const blob = await (await fetch(src)).blob();
      const file = new File([blob], `puppy-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch { /* share sheet closed */ }
  });
  $('#modal-root').appendChild(lb);
}

// read-only: we create the store for its live listeners and never
// call any of its write methods
createStore(render);

// keep long-lived open tabs fresh (same self-heal as the main app)
let hiddenAt = null;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) location.reload();
  hiddenAt = null;
});
