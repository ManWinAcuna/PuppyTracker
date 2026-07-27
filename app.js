// ============================================================
//  app.js — UI + behaviour
// ============================================================
import { createStore, STORE_MODE } from './store.js';
import { APP_PASSCODE } from './firebase-config.js';

// ---------- tiny helpers ----------
const $ = sel => document.querySelector(sel);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

const UNIT_LABEL = { lb: 'lb', kg: 'kg', oz: 'oz', g: 'g' };

function timeAgo(ms) {
  const d = Date.now() - ms;
  if (d < MIN) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY) { const hh = Math.floor(d / HOUR), mm = Math.floor((d % HOUR) / MIN); return mm ? `${hh}h ${mm}m ago` : `${hh}h ago`; }
  return `${Math.floor(d / DAY)}d ago`;
}
function timeUntil(ms) {
  const d = ms - Date.now();
  if (d <= 0) return 'now';
  if (d < HOUR) return `${Math.max(1, Math.round(d / MIN))} min`;
  const hh = Math.floor(d / HOUR), mm = Math.round((d % HOUR) / MIN);
  return mm ? `${hh}h ${mm}m` : `${hh}h`;
}
function ageText(birthday) {
  if (!birthday) return '';
  const days = Math.floor((Date.now() - new Date(birthday + 'T00:00:00').getTime()) / DAY);
  if (days < 0) return '';
  if (days < 14) return `${days} days old`;
  return `${Math.floor(days / 7)} weeks old`;
}
const dateAt = iso => new Date(iso + 'T00:00:00'); // parse plain dates consistently (local midnight)

// ============================================================
//  Expected daily weight gain — newborn/nursing stage
//  Vet rule of thumb: healthy newborns gain 5–10% of their birth
//  weight per day and double it by day 10–14. Baseline = birth
//  weight if set, otherwise the first weigh-in.
// ============================================================
function growthInfo(p, settings) {
  const unit = UNIT_LABEL[settings.weightUnit] || '';
  const first = p.weights[0];
  // Baseline: birth weight anchored at the birthday when BOTH are known;
  // otherwise the first weigh-in anchored at its own date. Never mix a
  // later weight with the birth date — that would inflate expectations
  // for pups that weren't weighed at birth.
  let baseW = null, baseDate = null, usingFirstWeighIn = false;
  if (p.birthWeight && p.birthday) { baseW = p.birthWeight; baseDate = p.birthday; }
  else if (first) { baseW = first.weight; baseDate = first.dateISO; usingFirstWeighIn = true; }
  if (!baseW || !baseDate) return null;

  const ageDays = Math.max(0, Math.floor((Date.now() - dateAt(p.birthday || baseDate).getTime()) / DAY)); // true age, for display
  const sinceBase = Math.max(0, Math.floor((Date.now() - dateAt(baseDate).getTime()) / DAY));             // days since baseline, for math
  const lowRate = baseW * 0.05, highRate = baseW * 0.10;   // per day
  const expLow = baseW + lowRate * sinceBase;               // expected weight today
  const expHigh = baseW + highRate * sinceBase;

  const last = p.weights[p.weights.length - 1];
  const prev = p.weights[p.weights.length - 2];
  let lastDaily = null, avgDaily = null;
  if (last && prev) {
    const days = Math.max(1, Math.round((dateAt(last.dateISO) - dateAt(prev.dateISO)) / DAY));
    lastDaily = (last.weight - prev.weight) / days;
  }
  if (last && last.dateISO > baseDate) {
    const days = Math.max(1, Math.round((dateAt(last.dateISO) - dateAt(baseDate)) / DAY));
    avgDaily = (last.weight - baseW) / days;
  }

  const signal = lastDaily ?? avgDaily; // most recent picture of how they're doing
  let status = null;
  if (signal != null) {
    if (signal <= 0) status = { cls: 'bad', label: '▼ Losing weight', note: 'Newborn puppies should never lose weight — contact your vet today.' };
    else if (signal < lowRate) status = { cls: 'warn', label: '⚠ Gaining slowly', note: 'Below the expected range. Give this pup extra nursing time (or supplement) and weigh again tomorrow.' };
    else status = { cls: 'good', label: '✓ On track', note: '' };
  }
  return { unit, baseW, baseDate, usingFirstWeighIn, ageDays, lowRate, highRate, expLow, expHigh, lastDaily, avgDaily, status };
}

const r2 = v => Math.round(v * 100) / 100;
function fmtRange(a, b, unit) {
  let sub = '';
  if (unit === 'lb') sub = ` (≈${r2(a * 16)}–${r2(b * 16)} oz)`;
  else if (unit === 'kg') sub = ` (≈${Math.round(a * 1000)}–${Math.round(b * 1000)} g)`;
  return `${r2(a)}–${r2(b)} ${unit}${sub}`;
}
function fmtGain(v, unit) {
  let sub = '';
  if (unit === 'lb') sub = ` (≈${r2(v * 16)} oz)`;
  else if (unit === 'kg') sub = ` (≈${Math.round(v * 1000)} g)`;
  return `${v > 0 ? '+' : ''}${r2(v)} ${unit}${sub}`;
}

function growthHtml(gi) {
  if (!gi) return `<div class="growth"><div class="note">Log a first weight (or set a birth weight in ✏️ Edit) to see the expected daily gain for this pup.</div></div>`;
  const rows = [
    ['Expected gain', `+${fmtRange(gi.lowRate, gi.highRate, gi.unit)} / day`],
    ['Expected today (day ' + gi.ageDays + ')', fmtRange(gi.expLow, gi.expHigh, gi.unit)],
  ];
  if (gi.avgDaily != null) rows.push(['Average gain so far', fmtGain(gi.avgDaily, gi.unit) + ' / day']);
  if (gi.lastDaily != null) rows.push(['Since last weigh-in', fmtGain(gi.lastDaily, gi.unit) + ' / day']);
  return `
    <div class="growth ${gi.status ? gi.status.cls : ''}">
      ${gi.status ? `<div class="growth-status">${gi.status.label}<span class="growth-day">day ${gi.ageDays}</span></div>` : ''}
      ${rows.map(([k, v]) => `<div class="growth-row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}
      ${gi.status && gi.status.note ? `<div class="note">${gi.status.note}</div>` : ''}
      <div class="note">Rule of thumb for the first weeks: newborns gain 5–10% of birth weight daily and double it by day 10–14.${gi.usingFirstWeighIn ? ' Using the first weigh-in as baseline — set the exact birth weight in ✏️ Edit for better accuracy.' : ''}</div>
    </div>`;
}

// ---------- app state ----------
let store = null;
let lastState = { mode: STORE_MODE, settings: { feedingWindowMinutes: 120, weightUnit: 'lb', switchMinutes: 15 }, puppies: [], familyPhotos: [] };
let currentPuppyId = null;
let albumOpen = false;
let chart = null;

// ============================================================
//  Boot
// ============================================================
function boot() {
  if (APP_PASSCODE && sessionStorage.getItem('pt_unlocked') !== '1') {
    showLock();
  } else {
    startApp();
  }
}

function showLock() {
  const lock = $('#lock'); lock.classList.remove('hidden');
  $('#lock-form').addEventListener('submit', e => {
    e.preventDefault();
    if ($('#lock-input').value === APP_PASSCODE) {
      sessionStorage.setItem('pt_unlocked', '1');
      lock.classList.add('hidden');
      startApp();
    } else {
      $('#lock-error').textContent = 'Wrong passcode, try again';
    }
  });
}

async function startApp() {
  $('#app').classList.remove('hidden');

  // service worker enables system notifications (and PWA niceties)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  if (STORE_MODE === 'demo') {
    const b = $('#mode-banner');
    b.className = 'banner demo';
    b.textContent = '⚠️ Demo mode — data is saved only on this device. Add your Firebase keys (see README) to share with family.';
    b.classList.remove('hidden');
  }

  wireStaticButtons();
  store = await createStore(render);
}

function wireStaticButtons() {
  $('#btn-add-puppy').addEventListener('click', openAddPuppy);
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-back').addEventListener('click', () => { currentPuppyId = null; showHome(); });
  $('#btn-family-photo').addEventListener('click', openAddFamilyPhoto);
  $('#btn-family-photo-album').addEventListener('click', openAddFamilyPhoto);
  $('#album-open').addEventListener('click', openAlbum);
  $('#btn-album-back').addEventListener('click', () => { albumOpen = false; showHome(); });
}

// ============================================================
//  Lightbox — tap any photo to expand; save/share from there
// ============================================================
function openLightbox(src, { onDelete } = {}) {
  const lb = h(`
    <div class="lightbox">
      <img src="${src}" alt="">
      <div class="lb-actions">
        <button class="btn" id="lb-save">⬇ Save</button>
        ${onDelete ? '<button class="btn danger" id="lb-del">🗑 Delete</button>' : ''}
        <button class="btn ghost" id="lb-close">✕ Close</button>
      </div>
      <div class="lb-hint">Tip: you can also press-and-hold the photo to save it</div>
    </div>`);
  const close = () => lb.remove();
  lb.addEventListener('click', e => { if (e.target === lb) close(); });
  lb.querySelector('#lb-close').addEventListener('click', close);
  lb.querySelector('#lb-save').addEventListener('click', async () => {
    try {
      const blob = await (await fetch(src)).blob();
      const file = new File([blob], `puppy-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
      // On phones this opens the share sheet → "Save Image" puts it in the camera roll
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch { /* user closed the share sheet — fine */ }
  });
  lb.querySelector('#lb-del')?.addEventListener('click', async () => { await onDelete(); close(); });
  $('#modal-root').appendChild(lb);
}

// ============================================================
//  Family album — shared photos of the whole crew
// ============================================================
function renderFamily(state) {
  const strip = $('#family-strip');
  const photos = state.familyPhotos || [];
  strip.classList.toggle('hidden', !photos.length);
  strip.innerHTML = '';
  for (const ph of photos) {
    const img = h(`<img class="fam-thumb" src="${ph.dataUrl}" alt="" loading="lazy">`);
    img.addEventListener('click', () =>
      openLightbox(ph.dataUrl, { onDelete: () => store.deleteFamilyPhoto(ph.id) }));
    strip.appendChild(img);
  }
}

function openAddFamilyPhoto() {
  const { root, close } = modal(`
    <h3>Add a family photo 📸</h3>
    <div class="field"><label>Take or choose a photo</label>
      <input id="m-file" type="file" accept="image/*" capture="environment" /></div>
    <div id="m-preview"></div>
    <div class="actions">
      <button class="btn ghost" id="m-cancel">Cancel</button>
      <button class="btn" id="m-save">Save to album</button>
    </div>`);
  let dataUrl = null;
  const preview = root.querySelector('#m-preview');
  root.querySelector('#m-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    preview.innerHTML = '<div class="hint">Processing…</div>';
    dataUrl = await shrinkImage(file, 1200, 0.72);
    preview.innerHTML = `<img src="${dataUrl}" style="width:100%;border-radius:12px;margin:6px 0">`;
  });
  root.querySelector('#m-cancel').addEventListener('click', close);
  root.querySelector('#m-save').addEventListener('click', async () => {
    if (!dataUrl) return alert('Pick a photo first');
    await store.addFamilyPhoto({ dataUrl, dateISO: todayISO() });
    close();
  });
}

// ============================================================
//  Render
// ============================================================
function render(state) {
  lastState = state;
  $('#window-label').textContent = 'every ' + windowText(state.settings.feedingWindowMinutes);
  renderHome(state);
  if (currentPuppyId) renderDetail(state);
  if (albumOpen) renderAlbum(state);
}

function windowText(mins) {
  if (mins % 60 === 0) return `${mins / 60}h`;
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ============================================================
//  Home cards — countdown rings + feeding session timers
// ============================================================
const RING_C = 195; // circumference of our r=31 ring (2π×31)

function fmtRing(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}h${pad(mm)}m` : `${mm}:${pad(ss)}`;
}

// The ring fills up as time passes; the live countdown sits inside it.
function statusRing(kind, target, totalMs, pid) {
  return `
    <div class="ring ${kind}" ${target ? `data-cd="${target}" data-total="${totalMs}" data-kind="${kind}" data-pid="${pid}"` : ''}>
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle class="ring-track" cx="36" cy="36" r="31"/>
        <circle class="ring-fill" cx="36" cy="36" r="31" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/>
      </svg>
      <div class="ring-text">
        <span class="cd-num" data-num>${target ? '' : '—'}</span>
        <span class="cd-lab" data-lab>${target ? '' : 'no feeds yet'}</span>
      </div>
    </div>`;
}

// Updates every ring on screen once a second. The first tick with rings
// present "primes" the alert sets so pups that were ALREADY overdue when
// you opened the app don't blast you with alerts — only new crossings do.
let alertsPrimed = false;
function tick() {
  const now = Date.now();
  const rings = document.querySelectorAll('.ring[data-cd]');
  if (!alertsPrimed && rings.length) {
    rings.forEach(el => {
      if (+el.dataset.cd <= now) firedAlerts.add(`${el.dataset.pid}:${el.dataset.cd}`);
    });
    alertsPrimed = true;
  }
  rings.forEach(el => {
    const target = +el.dataset.cd, total = +el.dataset.total, kind = el.dataset.kind;
    const remain = target - now;
    const over = remain <= 0;
    const frac = Math.min(1, Math.max(0, 1 - remain / total));
    el.querySelector('.ring-fill').style.strokeDashoffset = (RING_C * (1 - frac)).toFixed(1);
    el.querySelector('[data-num]').textContent = (over ? '+' : '') + fmtRing(Math.abs(remain));
    el.querySelector('[data-lab]').textContent =
      kind === 'switch' ? (over ? 'switch now!' : 'to switch') : (over ? 'overdue' : 'next feed');
    el.classList.toggle('over', over);
    if (over) fireAlert(kind, el.dataset.pid, target);
  });
}

function renderHome(state) {
  const wrap = $('#puppy-cards');
  wrap.innerHTML = '';
  if (!state.puppies.length) {
    wrap.appendChild(h(`<div class="empty">No puppies yet. Tap “Add a puppy” to start! 🐶</div>`));
    renderFamily(state);
    renderLitter(state);
    return;
  }
  // Priority order: pups mid-feeding stay pinned on top (soonest switch
  // first), then everyone else by who's due to eat next — never-fed pups
  // count as due immediately.
  const windowMs = state.settings.feedingWindowMinutes * MIN;
  const sorted = [...state.puppies].sort((a, b) => {
    const fa = !!a.feeding, fb = !!b.feeding;
    if (fa !== fb) return fa ? -1 : 1;
    if (fa && fb) return (a.feeding.startedAt + a.feeding.minutes * MIN) - (b.feeding.startedAt + b.feeding.minutes * MIN);
    const due = p => p.feedings[0] ? p.feedings[0].atMillis + windowMs : -Infinity;
    return due(a) - due(b);
  });
  for (const p of sorted) wrap.appendChild(p.feeding ? feedingCard(p, state) : idleCard(p, state));
  renderFamily(state);
  renderLitter(state);
  tick(); // fill in ring values right away (no blank flash)
}

// ============================================================
//  Litter overview — all pups side by side, smallest first
// ============================================================
function miniAvatar(p) {
  const src = p.avatar || p.photos[0]?.dataUrl;
  return src ? `<img class="mini" src="${src}" alt="">` : `<span class="mini">${esc(p.emoji || '🐶')}</span>`;
}

function renderLitter(state) {
  const head = $('#litter-head'), box = $('#litter-table');
  const pups = state.puppies;
  if (pups.length < 2) { head.classList.add('hidden'); box.classList.add('hidden'); return; }
  head.classList.remove('hidden'); box.classList.remove('hidden');
  const unit = UNIT_LABEL[state.settings.weightUnit] || '';

  const rows = pups.map(p => {
    const gi = growthInfo(p, state.settings);
    return { p, gi, w: currentWeight(p) };
  });
  rows.sort((a, b) => (a.w ?? Infinity) - (b.w ?? Infinity)); // smallest first, unweighed last
  const weighed = rows.filter(r => r.w != null);
  const minW = weighed.length ? weighed[0].w : null;

  // header pill: show litter age when everyone shares a birthday
  const bdays = [...new Set(pups.map(p => p.birthday).filter(Boolean))];
  $('#litter-day').textContent = (bdays.length === 1 && pups.every(p => p.birthday))
    ? 'day ' + Math.max(0, Math.floor((Date.now() - dateAt(bdays[0]).getTime()) / DAY))
    : pups.length + ' pups';

  box.innerHTML = `
    <div class="lrow lhead"><span>Pup</span><span>Weight</span><span>Gain/day</span><span>Status</span></div>
    ${rows.map(({ p, gi, w }) => {
      const gain = gi ? (gi.lastDaily ?? gi.avgDaily) : null;
      const st = gi && gi.status;
      const runt = w != null && w === minW && weighed.length > 1 ? ' <em class="runt">smallest</em>' : '';
      return `<div class="lrow" data-id="${p.id}">
        <span class="lname">${miniAvatar(p)}<span class="lname-t">${esc(p.name)}</span>${genderGlyph(p)}${runt}</span>
        <span class="lval">${w != null ? r2(w) + ' ' + unit : '—'}</span>
        <span class="lval">${gain != null ? (gain > 0 ? '+' : '') + r2(gain) : '—'}</span>
        <span class="lstat ${st ? st.cls : ''}">${st ? st.label.split(' ')[0] : '—'}</span>
      </div>`;
    }).join('')}
    <div class="lfoot">${pups.length} pups${weighed.length ? ` · ${weighed.length} weighed · ${r2(weighed.reduce((s, r) => s + r.w, 0))} ${unit} total` : ''}</div>`;

  box.onclick = e => {
    const row = e.target.closest('.lrow[data-id]');
    if (row) openDetail(row.dataset.id);
  };
}

// Profile picture priority: custom avatar → newest growth photo → emoji
const genderGlyph = p =>
  p.gender === 'f' ? '<span class="gender">♀</span>' :
  p.gender === 'm' ? '<span class="gender">♂</span>' : '';

// segmented Boy/Girl picker used by the Add + Edit sheets; returns a getter
function wireGenderPicker(root, initial) {
  let val = initial || '';
  const paint = () => root.querySelectorAll('[data-g]').forEach(b =>
    b.style.outline = b.dataset.g === val ? '2px solid var(--accent)' : 'none');
  root.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => {
    val = (val === b.dataset.g) ? '' : b.dataset.g; // tap again to unset
    paint();
  }));
  paint();
  return () => val;
}
const genderField = () => `
  <div class="field"><label>Gender</label>
    <div class="row">
      <button type="button" class="btn ghost" data-g="m" style="flex:1">♂ Boy</button>
      <button type="button" class="btn ghost" data-g="f" style="flex:1">♀ Girl</button>
    </div>
  </div>`;

function avatarHtml(p) {
  const src = p.avatar || p.photos[0]?.dataUrl;
  return src ? `<img class="avatar" src="${src}" alt="">` : `<div class="avatar">${esc(p.emoji || '🐶')}</div>`;
}

// current weight = latest weigh-in, falling back to the starting/birth weight
const currentWeight = p =>
  p.weights.length ? p.weights[p.weights.length - 1].weight : (p.birthWeight ?? null);

// shown as a chip next to the name
function weightChip(p, state) {
  const w = currentWeight(p);
  if (w == null) return '';
  return `<span class="wchip">${w} ${UNIT_LABEL[state.settings.weightUnit] || ''}</span>`;
}

function idleCard(p, state) {
  const last = p.feedings[0];
  const totalMs = state.settings.feedingWindowMinutes * MIN;
  const target = last ? last.atMillis + totalMs : null;
  const card = h(`
    <div class="card ${last ? '' : 'never-fed'}" data-id="${p.id}">
      <div class="card-main">
        ${avatarHtml(p)}
        <div class="info">
          <div class="name">${esc(p.name)}${genderGlyph(p)}${weightChip(p, state)}</div>
          <div class="sub">${last ? 'Fed ' + timeAgo(last.atMillis) : 'No feeding logged yet'}</div>
        </div>
        ${statusRing('next', target, totalMs, p.id)}
      </div>
      <div class="card-actions">
        <button class="card-btn primary" data-act="start">🍼 Start feeding</button>
        <button class="card-btn ghosty" data-act="quick">✓ Fed now</button>
      </div>
    </div>`);
  wireCard(card, p);
  return card;
}

function feedingCard(p, state) {
  const f = p.feeding;
  const totalMs = f.minutes * MIN;
  const target = f.startedAt + totalMs;
  const paused = !!f.pausedAt;

  let ringHtml, sub, actions;
  if (paused) {
    // frozen ring — no data-cd, so the ticker leaves it alone
    const remain = Math.max(0, target - f.pausedAt);
    const frac = Math.min(1, Math.max(0, 1 - remain / totalMs));
    ringHtml = `
      <div class="ring switch paused">
        <svg viewBox="0 0 72 72" aria-hidden="true">
          <circle class="ring-track" cx="36" cy="36" r="31"/>
          <circle class="ring-fill" cx="36" cy="36" r="31" stroke-dasharray="${RING_C}" stroke-dashoffset="${(RING_C * (1 - frac)).toFixed(1)}"/>
        </svg>
        <div class="ring-text"><span class="cd-num">${fmtRing(remain)}</span><span class="cd-lab">paused</span></div>
      </div>`;
    sub = `⏸ Paused · ${fmtRing(remain)} left on the timer`;
    actions = `
      <button class="card-btn primary" data-act="resume">▶ Resume</button>
      <button class="card-btn done" data-act="done">✓ Done</button>
      <button class="card-btn ghosty stop" data-act="cancel">✕</button>`;
  } else {
    ringHtml = statusRing('switch', target, totalMs, p.id);
    sub = `🍼 Feeding · started ${timeAgo(f.startedAt)} · ${f.minutes} min`;
    actions = `
      <button class="card-btn done" data-act="done">✓ Done — log feeding</button>
      <button class="card-btn ghosty stop" data-act="pause" title="Pause the timer">⏸</button>
      <button class="card-btn ghosty stop" data-act="cancel">✕</button>`;
  }

  const card = h(`
    <div class="card feeding ${paused ? 'paused' : ''}" data-id="${p.id}">
      <div class="card-main">
        ${avatarHtml(p)}
        <div class="info">
          <div class="name">${esc(p.name)}${genderGlyph(p)}${weightChip(p, state)}</div>
          <div class="sub">${sub}</div>
        </div>
        ${ringHtml}
      </div>
      <div class="card-actions">${actions}</div>
    </div>`);
  wireCard(card, p);
  return card;
}

function wireCard(card, p) {
  card.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return openDetail(p.id);
    e.stopPropagation();
    const act = btn.dataset.act;
    // Done and ✕ need a second tap to fire — guards against misclicks
    // while juggling puppies. First tap arms the button for 3 seconds.
    if (act === 'done' || act === 'cancel') {
      if (!btn.classList.contains('armed')) {
        btn.classList.add('armed');
        btn.dataset.orig = btn.innerHTML;
        btn.innerHTML = act === 'done' ? 'Tap again ✓' : 'Tap again ✕';
        btn._disarm = setTimeout(() => {
          btn.classList.remove('armed');
          btn.innerHTML = btn.dataset.orig;
        }, 3000);
        return;
      }
      clearTimeout(btn._disarm);
    }

    if (act === 'start') openStartFeeding(p);
    else if (act === 'quick') await store.addFeeding(p.id, { atMillis: Date.now(), fedBy: '' });
    else if (act === 'done') await finishFeeding(p);
    else if (act === 'pause') {
      await store.updatePuppy(p.id, { feeding: { ...p.feeding, pausedAt: Date.now() } });
    } else if (act === 'resume') {
      // shift the start forward by however long we were paused, so the
      // timer picks up exactly where it left off
      const pausedFor = Date.now() - p.feeding.pausedAt;
      await store.updatePuppy(p.id, { feeding: { startedAt: p.feeding.startedAt + pausedFor, minutes: p.feeding.minutes } });
    } else if (act === 'cancel') {
      await store.updatePuppy(p.id, { feeding: null });
    }
  });
}

async function finishFeeding(p) {
  await store.addFeeding(p.id, { atMillis: Date.now(), fedBy: '' });
  await store.updatePuppy(p.id, { feeding: null });
}

function openStartFeeding(p) {
  ensureAudio(); // user tap = permission to make sound later
  const def = lastState.settings.switchMinutes || 15;
  const { root, close } = modal(`
    <h3>Start feeding — ${esc(p.name)} 🍼</h3>
    <div class="field"><label>Switch after (minutes)</label>
      <input id="m-mins" type="number" min="1" step="1" inputmode="numeric" value="${def}" /></div>
    <div class="hint">An orange ring starts filling on ${esc(p.name)}'s card. When it's full, the card flashes red (and beeps if the app is open) — time to switch puppies! Tap <b>✓ Done</b> when finished to log the feeding.</div>
    <div class="actions">
      <button class="btn ghost" id="m-cancel">Cancel</button>
      <button class="btn" id="m-start">▶ Start timer</button>
    </div>`);
  root.querySelector('#m-cancel').addEventListener('click', close);
  root.querySelector('#m-start').addEventListener('click', async () => {
    ensureAudio();
    const m = Math.max(1, parseInt(root.querySelector('#m-mins').value) || def);
    await store.updatePuppy(p.id, { feeding: { startedAt: Date.now(), minutes: m } });
    close();
  });
}

// ---- alerts: beep + vibrate + system notification, once per event ----
let audioCtx = null;
function ensureAudio() {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); } catch { /* no audio, no problem */ }
}
function beep() {
  if (!audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    [0, 0.35, 0.7].forEach(off => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.18, t + off);
      g.gain.exponentialRampToValueAtTime(0.001, t + off + 0.28);
      o.start(t + off); o.stop(t + off + 0.3);
    });
  } catch { /* ignore */ }
}
const firedAlerts = new Set();
function fireAlert(kind, pid, target) {
  const key = `${pid}:${target}`;
  if (firedAlerts.has(key)) return;
  firedAlerts.add(key);
  beep();
  navigator.vibrate?.([300, 120, 300]);
  const name = lastState.puppies.find(p => p.id === pid)?.name || 'A pup';
  notifyLocal(
    kind === 'switch' ? '🔄 Time to switch!' : '🍽 Puppy needs to eat',
    kind === 'switch' ? `${name}'s switch timer is up.` : `${name} is past the feeding window.`
  );
}
function notifyLocal(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  navigator.serviceWorker?.ready
    .then(r => r.showNotification(title, { body, icon: 'icon.svg', badge: 'icon.svg' }))
    .catch(() => { try { new Notification(title, { body }); } catch { /* no support */ } });
}

// ---- background push: subscribe this device (works with the app closed) ----
const VAPID_PUBLIC = 'BOWcF0_ymKEklx4ojdn-TenYVihTCbKbe_QoPcTuNHwSKdhEer1GTiCqwv9Eafa2tdOYm1rD1vxxSZr6VgHULTc';
function urlB64ToUint8(s) {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...b].map(c => c.charCodeAt(0)));
}
async function enablePhoneAlerts() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return alert('On iPhone: first add this app to your Home Screen (Share → Add to Home Screen), then open it from there and tap this button again.');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return alert('Notifications are blocked for this app — allow them in your phone Settings and try again.');
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID_PUBLIC) });
    await store.addPushSub({ sub: JSON.stringify(sub), ua: (navigator.userAgent || '').slice(0, 80) });
    alert('Done! This phone now gets feeding alerts — even with the app closed. 🐶');
  } catch {
    alert('Alerts will show while the app is open, but background push could not be set up on this device.');
  }
}

// ---------- detail ----------
function openDetail(id) { currentPuppyId = id; albumOpen = false; showDetail(); renderDetail(lastState); }
function showHome() { $('#view-detail').classList.add('hidden'); $('#view-album').classList.add('hidden'); $('#view-home').classList.remove('hidden'); window.scrollTo(0, 0); }
function showDetail() { $('#view-home').classList.add('hidden'); $('#view-album').classList.add('hidden'); $('#view-detail').classList.remove('hidden'); window.scrollTo(0, 0); }
function openAlbum() {
  albumOpen = true; currentPuppyId = null;
  $('#view-home').classList.add('hidden'); $('#view-detail').classList.add('hidden');
  $('#view-album').classList.remove('hidden');
  window.scrollTo(0, 0);
  renderAlbum(lastState);
}

function renderAlbum(state) {
  const photos = state.familyPhotos || [];
  $('#album-count').textContent = `${photos.length} photo${photos.length === 1 ? '' : 's'}`;
  const grid = $('#album-grid');
  grid.innerHTML = '';
  if (!photos.length) {
    grid.appendChild(h(`<div class="empty" style="grid-column:1/-1">No family photos yet — take the first one! 📷</div>`));
    return;
  }
  for (const ph of photos) {
    const fig = h(`<figure><img src="${ph.dataUrl}" alt="" loading="lazy"><figcaption>${esc(ph.dateISO || '')}</figcaption></figure>`);
    fig.querySelector('img').addEventListener('click', () =>
      openLightbox(ph.dataUrl, { onDelete: () => store.deleteFamilyPhoto(ph.id) }));
    grid.appendChild(fig);
  }
}

function renderDetail(state) {
  const p = state.puppies.find(x => x.id === currentPuppyId);
  if (!p) { currentPuppyId = null; showHome(); return; }
  const unit = UNIT_LABEL[state.settings.weightUnit] || '';
  const latest = p.weights[p.weights.length - 1];
  const avatar = avatarHtml(p);

  const box = $('#detail-content');
  box.innerHTML = '';

  // header
  box.appendChild(h(`
    <div class="detail-head">
      ${avatar}
      <div>
        <h2>${esc(p.name)}${genderGlyph(p)}</h2>
        <div class="sub">${esc([ageText(p.birthday), currentWeight(p) != null ? `${currentWeight(p)} ${unit}` : 'no weight yet', p.feeding ? '🍼 feeding right now' : ''].filter(Boolean).join(' · '))}</div>
        <button class="link-btn" id="edit-pup">✏️ Edit / remove</button>
      </div>
    </div>`));
  box.querySelector('#edit-pup').addEventListener('click', () => openEditPuppy(p));

  // weight panel (with the expected-gain growth check)
  const gi = growthInfo(p, state.settings);
  const wp = h(`
    <div class="panel">
      <h3><span>Weight</span> <span class="big">${currentWeight(p) != null ? currentWeight(p) + ' ' + unit : '—'}</span></h3>
      ${growthHtml(gi)}
      <canvas id="wchart" height="160"></canvas>
      <button class="btn block ghost" id="add-weight" style="margin-top:12px">＋ Log today's weight</button>
      <ul class="log-list" id="weight-list"></ul>
    </div>`);
  box.appendChild(wp);
  wp.querySelector('#add-weight').addEventListener('click', () => openAddWeight(p));
  const wlist = wp.querySelector('#weight-list');
  [...p.weights].reverse().slice(0, 8).forEach(w => {
    const li = h(`<li><span>${w.weight} ${unit}</span><span class="when">${esc(w.dateISO)}</span></li>`);
    const del = h(`<button class="del" title="delete">✕</button>`);
    del.addEventListener('click', () => store.deleteWeight(p.id, w.id));
    li.appendChild(del);
    wlist.appendChild(li);
  });
  if (!p.weights.length) wlist.appendChild(h(`<li class="empty">No weigh-ins yet</li>`));
  drawChart(p, unit, gi);

  // photos panel
  const pp = h(`
    <div class="panel">
      <h3><span>Growth photos</span></h3>
      <button class="btn block ghost" id="add-photo">📷 Add a photo</button>
      <div class="photo-grid" id="photo-grid"></div>
    </div>`);
  box.appendChild(pp);
  pp.querySelector('#add-photo').addEventListener('click', () => openAddPhoto(p));
  const grid = pp.querySelector('#photo-grid');
  if (!p.photos.length) grid.appendChild(h(`<div class="empty" style="grid-column:1/-1">No photos yet</div>`));
  p.photos.forEach(ph => {
    const fig = h(`<figure><img src="${ph.dataUrl}" alt=""><figcaption>${esc(ph.dateISO || '')}</figcaption></figure>`);
    fig.querySelector('img').addEventListener('click', () => openLightbox(ph.dataUrl));
    const del = h(`<button class="del" title="delete">✕</button>`);
    del.addEventListener('click', () => { if (confirm('Delete this photo?')) store.deletePhoto(p.id, ph.id); });
    const fav = h(`<button class="fav" title="Make profile picture">★</button>`);
    fav.addEventListener('click', async () => {
      const small = await shrinkImage(ph.dataUrl, 320, 0.8); // store a compact copy as the avatar
      await store.updatePuppy(p.id, { avatar: small });
    });
    fig.appendChild(del);
    fig.appendChild(fav);
    grid.appendChild(fig);
  });

  // feeding history
  const fp = h(`
    <div class="panel">
      <h3><span>Feeding history</span></h3>
      <button class="btn block" id="feed-now">🍽 Log a feeding now</button>
      <ul class="log-list" id="feed-list"></ul>
    </div>`);
  box.appendChild(fp);
  fp.querySelector('#feed-now').addEventListener('click', () => store.addFeeding(p.id, { atMillis: Date.now(), fedBy: '' }));
  const flist = fp.querySelector('#feed-list');
  if (!p.feedings.length) flist.appendChild(h(`<li class="empty">No feedings logged</li>`));
  p.feedings.slice(0, 12).forEach(f => {
    const d = new Date(f.atMillis);
    const li = h(`<li><span>${pad(d.getHours())}:${pad(d.getMinutes())}</span><span class="when">${d.toLocaleDateString()} · ${timeAgo(f.atMillis)}</span></li>`);
    const del = h(`<button class="del" title="delete">✕</button>`);
    del.addEventListener('click', () => store.deleteFeeding(p.id, f.id));
    li.appendChild(del);
    flist.appendChild(li);
  });
}

function drawChart(p, unit, gi) {
  const canvas = $('#wchart');
  if (!canvas || !window.Chart) return;
  if (chart) { chart.destroy(); chart = null; }
  if (!p.weights.length) { canvas.style.display = 'none'; return; }
  canvas.style.display = '';
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#ff8c2b';
  const green = css.getPropertyValue('--green').trim() || '#34d17b';
  const muted = css.getPropertyValue('--muted').trim() || '#9b8f7f';

  const datasets = [];
  // dashed expected-range corridor (5%–10% of birth weight per day)
  if (gi && gi.baseW && gi.baseDate) {
    const dayAt = w => Math.max(0, Math.round((dateAt(w.dateISO) - dateAt(gi.baseDate)) / DAY));
    const corridor = { borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5, tension: 0 };
    datasets.push({ ...corridor, data: p.weights.map(w => r2(gi.baseW + gi.lowRate * dayAt(w))), borderColor: green + '88', fill: false });
    datasets.push({ ...corridor, data: p.weights.map(w => r2(gi.baseW + gi.highRate * dayAt(w))), borderColor: green + '88', fill: '-1', backgroundColor: green + '18' });
  }
  datasets.push({
    data: p.weights.map(w => Number(w.weight)),
    borderColor: accent, backgroundColor: accent + '22',
    fill: false, tension: 0.3, pointRadius: 3, borderWidth: 2,
  });

  const grid = 'rgba(255,255,255,0.06)';
  chart = new Chart(canvas, {
    type: 'line',
    data: { labels: p.weights.map(w => w.dateISO.slice(5)), datasets },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.y} ${unit}` } } },
      scales: {
        y: { beginAtZero: false, ticks: { color: muted, callback: v => v + ' ' + unit }, grid: { color: grid } },
        x: { ticks: { color: muted }, grid: { display: false } },
      },
      maintainAspectRatio: true, animation: false,
    },
  });
}

// ============================================================
//  Modals
// ============================================================
function modal(inner) {
  const back = h(`<div class="modal-backdrop"><div class="modal">${inner}</div></div>`);
  const close = () => back.remove();
  back.addEventListener('click', e => { if (e.target === back) close(); });
  $('#modal-root').appendChild(back);
  return { root: back, close };
}

const EMOJIS = ['🐶', '🐕', '🦮', '🐩', '🐾', '🦴'];

function openAddPuppy() {
  const unit = UNIT_LABEL[lastState.settings.weightUnit] || '';
  const { root, close } = modal(`
    <h3>Add a puppy 🐶</h3>
    <div class="field"><label>Name</label><input id="m-name" placeholder="e.g. Bella" /></div>
    ${genderField()}
    <div class="field"><label>Birthday (optional)</label><input id="m-bday" type="date" /></div>
    <div class="field"><label>Birth weight (${unit}, optional — powers the expected-gain tracker)</label>
      <input id="m-bw" type="number" step="0.01" inputmode="decimal" placeholder="e.g. 1.5" /></div>
    <div class="field"><label>Icon (used until you add a photo)</label>
      <div class="row" id="m-emoji">${EMOJIS.map((e, i) => `<button type="button" class="btn ghost" data-e="${e}" style="flex:1;${i === 0 ? 'outline:2px solid var(--accent)' : ''}">${e}</button>`).join('')}</div>
    </div>
    <div class="actions">
      <button class="btn ghost" id="m-cancel">Cancel</button>
      <button class="btn" id="m-save">Add puppy</button>
    </div>`);
  let emoji = '🐶';
  const getGender = wireGenderPicker(root, '');
  root.querySelectorAll('[data-e]').forEach(b => b.addEventListener('click', () => {
    emoji = b.dataset.e;
    root.querySelectorAll('[data-e]').forEach(x => x.style.outline = 'none');
    b.style.outline = '2px solid var(--accent)';
  }));
  root.querySelector('#m-cancel').addEventListener('click', close);
  root.querySelector('#m-save').addEventListener('click', async () => {
    const name = root.querySelector('#m-name').value.trim();
    if (!name) return root.querySelector('#m-name').focus();
    const bw = parseFloat(root.querySelector('#m-bw').value);
    await store.addPuppy({ name, gender: getGender(), birthday: root.querySelector('#m-bday').value, emoji, birthWeight: isNaN(bw) ? null : bw });
    close();
  });
  root.querySelector('#m-name').focus();
}

function openEditPuppy(p) {
  const currentAvatar = p.avatar || p.photos[0]?.dataUrl || null;
  const { root, close } = modal(`
    <h3>Edit ${esc(p.name)}</h3>
    <div class="field"><label>Profile picture</label>
      <div class="avatar-row">
        <div id="m-avatar-preview">${currentAvatar ? `<img class="avatar" src="${currentAvatar}" alt="">` : `<div class="avatar">${esc(p.emoji || '🐶')}</div>`}</div>
        <div class="avatar-btns">
          <label class="btn ghost file-btn">📷 Choose new picture<input id="m-avatar-file" type="file" accept="image/*" hidden /></label>
          ${p.avatar ? `<button type="button" class="btn ghost" id="m-avatar-reset">↩ Reset to latest photo</button>` : ''}
        </div>
      </div>
    </div>
    <div class="field"><label>Name</label><input id="m-name" value="${esc(p.name)}" /></div>
    ${genderField()}
    <div class="field"><label>Birthday</label><input id="m-bday" type="date" value="${esc(p.birthday || '')}" /></div>
    <div class="field"><label>Birth weight (${UNIT_LABEL[lastState.settings.weightUnit] || ''} — powers the expected-gain tracker)</label>
      <input id="m-bw" type="number" step="0.01" inputmode="decimal" value="${p.birthWeight ?? ''}" placeholder="e.g. 1.5" /></div>
    <div class="field"><label>Icon (shown when there's no picture)</label>
      <div class="row" id="m-emoji">${EMOJIS.map(e => `<button type="button" class="btn ghost" data-e="${e}" style="flex:1;${e === (p.emoji || '🐶') ? 'outline:2px solid var(--accent)' : ''}">${e}</button>`).join('')}</div>
    </div>
    <div class="actions">
      <button class="btn ghost" id="m-cancel">Cancel</button>
      <button class="btn" id="m-save">Save</button>
    </div>
    <button class="btn danger block" id="m-del" style="margin-top:12px">🗑 Remove this puppy</button>`);
  let emoji = p.emoji || '🐶';
  const getGender = wireGenderPicker(root, p.gender);
  let avatarPatch = {}; // becomes { avatar: dataUrl } or { avatar: null } if changed
  root.querySelectorAll('[data-e]').forEach(b => b.addEventListener('click', () => {
    emoji = b.dataset.e;
    root.querySelectorAll('[data-e]').forEach(x => x.style.outline = 'none');
    b.style.outline = '2px solid var(--accent)';
  }));
  root.querySelector('#m-avatar-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await shrinkImage(file, 320, 0.8);
    avatarPatch = { avatar: dataUrl };
    root.querySelector('#m-avatar-preview').innerHTML = `<img class="avatar" src="${dataUrl}" alt="">`;
  });
  root.querySelector('#m-avatar-reset')?.addEventListener('click', () => {
    avatarPatch = { avatar: null };
    const fallback = p.photos[0]?.dataUrl;
    root.querySelector('#m-avatar-preview').innerHTML =
      fallback ? `<img class="avatar" src="${fallback}" alt="">` : `<div class="avatar">${esc(emoji)}</div>`;
  });
  root.querySelector('#m-cancel').addEventListener('click', close);
  root.querySelector('#m-save').addEventListener('click', async () => {
    const name = root.querySelector('#m-name').value.trim();
    if (!name) return;
    const bw = parseFloat(root.querySelector('#m-bw').value);
    await store.updatePuppy(p.id, { name, gender: getGender(), birthday: root.querySelector('#m-bday').value, emoji, birthWeight: isNaN(bw) ? null : bw, ...avatarPatch });
    close();
  });
  root.querySelector('#m-del').addEventListener('click', async () => {
    if (!confirm(`Remove ${p.name} and all their data? This cannot be undone.`)) return;
    await store.deletePuppy(p.id);
    close(); currentPuppyId = null; showHome();
  });
}

function openAddWeight(p) {
  const unit = UNIT_LABEL[lastState.settings.weightUnit] || '';
  const { root, close } = modal(`
    <h3>Log weight — ${esc(p.name)}</h3>
    <div class="field"><label>Weight (${unit})</label>
      <input id="m-w" type="number" step="0.01" inputmode="decimal" placeholder="e.g. 4.2" /></div>
    <div class="field"><label>Date</label><input id="m-d" type="date" value="${todayISO()}" /></div>
    <div class="actions">
      <button class="btn ghost" id="m-cancel">Cancel</button>
      <button class="btn" id="m-save">Save</button>
    </div>`);
  root.querySelector('#m-cancel').addEventListener('click', close);
  root.querySelector('#m-save').addEventListener('click', async () => {
    const w = parseFloat(root.querySelector('#m-w').value);
    if (isNaN(w)) return root.querySelector('#m-w').focus();
    await store.addWeight(p.id, { weight: w, dateISO: root.querySelector('#m-d').value || todayISO() });
    close();
  });
  root.querySelector('#m-w').focus();
}

function openAddPhoto(p) {
  const { root, close } = modal(`
    <h3>Add a photo — ${esc(p.name)}</h3>
    <div class="field"><label>Choose or take a photo</label>
      <input id="m-file" type="file" accept="image/*" capture="environment" /></div>
    <div class="field"><label>Date</label><input id="m-d" type="date" value="${todayISO()}" /></div>
    <div id="m-preview"></div>
    <div class="actions">
      <button class="btn ghost" id="m-cancel">Cancel</button>
      <button class="btn" id="m-save">Save photo</button>
    </div>
    <div class="hint">Photos are automatically shrunk before saving, so they stay small and load fast.</div>`);
  let dataUrl = null;
  const preview = root.querySelector('#m-preview');
  root.querySelector('#m-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    preview.innerHTML = '<div class="hint">Processing…</div>';
    dataUrl = await shrinkImage(file, 1000, 0.72);
    preview.innerHTML = `<img src="${dataUrl}" style="width:100%;border-radius:12px;margin:6px 0">`;
  });
  root.querySelector('#m-cancel').addEventListener('click', close);
  root.querySelector('#m-save').addEventListener('click', async () => {
    if (!dataUrl) return alert('Pick a photo first');
    await store.addPhoto(p.id, { dataUrl, dateISO: root.querySelector('#m-d').value || todayISO(), note: '' });
    close();
  });
}

function openSettings() {
  const s = lastState.settings;
  const mins = s.feedingWindowMinutes;
  const { root, close } = modal(`
    <h3>Settings ⚙️</h3>
    <div class="field">
      <label>Feeding window — alert when a puppy hasn't eaten in this long</label>
      <div class="row">
        <input id="m-window" type="number" min="1" step="1" value="${Math.floor(mins / 60) || ''}" placeholder="hours" />
        <input id="m-window-m" type="number" min="0" max="59" step="1" value="${mins % 60}" placeholder="mins" />
      </div>
      <div class="hint">Hours + minutes. Example: 2 hours, 0 minutes.</div>
    </div>
    <div class="field">
      <label>Feeding switch timer — how long each puppy feeds before you switch</label>
      <input id="m-switch" type="number" min="1" step="1" inputmode="numeric" value="${s.switchMinutes || 15}" />
      <div class="hint">Minutes. This is the default for the 🍼 Start feeding timer — you can still adjust it each time you start one.</div>
    </div>
    <div class="field">
      <label>Weight unit</label>
      <select id="m-unit">
        ${['lb', 'kg', 'oz', 'g'].map(u => `<option value="${u}" ${s.weightUnit === u ? 'selected' : ''}>${u}</option>`).join('')}
      </select>
    </div>
    <button class="btn block" id="m-notif" style="margin:6px 0 14px">🔔 Get feeding alerts on this phone</button>
    <div class="actions">
      <button class="btn ghost" id="m-cancel">Close</button>
      <button class="btn" id="m-save">Save</button>
    </div>`);
  root.querySelector('#m-notif').addEventListener('click', enablePhoneAlerts);
  root.querySelector('#m-cancel').addEventListener('click', close);
  root.querySelector('#m-save').addEventListener('click', async () => {
    const hh = parseInt(root.querySelector('#m-window').value) || 0;
    const mm = parseInt(root.querySelector('#m-window-m').value) || 0;
    const total = Math.max(1, hh * 60 + mm);
    const sw = Math.max(1, parseInt(root.querySelector('#m-switch').value) || 15);
    await store.setSettings({ feedingWindowMinutes: total, switchMinutes: sw, weightUnit: root.querySelector('#m-unit').value });
    close();
  });
}

// ============================================================
//  Image shrinking (keeps stored photos small)
// ============================================================
function shrinkImage(source, maxSize, quality) {
  // `source` can be a File (from an <input>) or an existing data-URL string
  return new Promise((resolve, reject) => {
    const fromSrc = (src) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxSize / Math.max(width, height));
        width = Math.round(width * scale); height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = src;
    };
    if (typeof source === 'string') return fromSrc(source);
    const reader = new FileReader();
    reader.onload = () => fromSrc(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(source);
  });
}

// ============================================================
//  Live clocks — rings tick every second; "x min ago" text
//  refreshes once a minute
// ============================================================
setInterval(tick, 1000);
setInterval(() => { if (!currentPuppyId) renderHome(lastState); }, 60000);

// ============================================================
//  Stale-app self-healing: iOS freezes web apps that sit in the
//  background. If we wake up after 5+ minutes away, reload — that
//  fetches the newest app version AND reconnects live data, so
//  nobody ever stares at a frozen copy again.
// ============================================================
let hiddenAt = null;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) location.reload();
  hiddenAt = null;
});

boot();
