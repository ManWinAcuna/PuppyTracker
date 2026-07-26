// ============================================================
//  Feeding-alert checker — run by GitHub Actions every ~5 min
//  (.github/workflows/feeding-alerts.yml), or by hand:
//      node scripts/notify.mjs         (real run; needs VAPID_PRIVATE_KEY)
//      node scripts/notify.mjs --dry   (print what would send, touch nothing)
//
//  Reads the live Firestore, finds pups that crossed the feeding
//  window (or blew past their switch timer), and sends a Web Push
//  notification to every phone that enabled alerts in the app.
//  Marker fields written back to each pup doc make sure the same
//  event never notifies twice.
// ============================================================
const PROJECT = 'puppy-tracker-f3dc0';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const VAPID_PUBLIC = 'BOWcF0_ymKEklx4ojdn-TenYVihTCbKbe_QoPcTuNHwSKdhEer1GTiCqwv9Eafa2tdOYm1rD1vxxSZr6VgHULTc';
const DRY = process.argv.includes('--dry');
const MIN = 60000;

// unwrap Firestore's typed JSON values
const val = f => f == null ? null
  : 'integerValue' in f ? Number(f.integerValue)
  : 'doubleValue' in f ? f.doubleValue
  : 'stringValue' in f ? f.stringValue
  : 'booleanValue' in f ? f.booleanValue
  : 'mapValue' in f ? Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, v]) => [k, val(v)]))
  : null;

async function getJSON(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${await r.text()}`);
  return r.json();
}

const now = Date.now();

// feeding window from shared settings (falls back to the app default)
const settings = await getJSON(`${BASE}/settings/app`).catch(() => null);
const windowMin = (settings && val(settings.fields.feedingWindowMinutes)) || 120;

const pups = (await getJSON(`${BASE}/puppies?pageSize=300`)).documents || [];
const dueNames = [], switchNames = [], patches = [];

for (const doc of pups) {
  const id = doc.name.split('/').pop();
  const f = doc.fields || {};
  const name = val(f.name) || id;
  const feeding = val(f.feeding);

  // --- active feeding session: check the switch timer ---
  if (feeding && feeding.startedAt) {
    const target = feeding.startedAt + (feeding.minutes || 15) * MIN;
    if (!feeding.pausedAt && now >= target && val(f.notifiedSwitchFor) !== feeding.startedAt) {
      switchNames.push(name);
      patches.push({ id, field: 'notifiedSwitchFor', value: feeding.startedAt });
    }
    continue; // mid-feeding pups aren't "hungry"
  }

  // --- idle pup: check the feeding window against the last feeding ---
  const q = await getJSON(`${BASE}/puppies/${id}:runQuery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'feedings' }],
      orderBy: [{ field: { fieldPath: 'atMillis' }, direction: 'DESCENDING' }],
      limit: 1,
    } }),
  });
  const last = q.find(r => r.document)?.document;
  if (!last) continue; // never fed yet — nothing to measure against
  const at = val(last.fields.atMillis);
  if (now >= at + windowMin * MIN && val(f.notifiedForMillis) !== at) {
    dueNames.push(name);
    patches.push({ id, field: 'notifiedForMillis', value: at });
  }
}

// ---- build the messages ----
const messages = [];
if (switchNames.length)
  messages.push({ title: '🔄 Time to switch puppies!', body: `${switchNames.join(', ')} — the switch timer is up.` });
if (dueNames.length)
  messages.push({ title: '🍽 Puppies need to eat', body: `${dueNames.join(', ')} ${dueNames.length === 1 ? 'is' : 'are'} past the feeding window.` });

if (!messages.length) {
  console.log('All pups fine — nothing to send.');
  process.exit(0);
}
for (const m of messages) console.log(`${DRY ? '[dry-run] ' : ''}NOTIFY: ${m.title} — ${m.body}`);
if (DRY) process.exit(0);

// ---- send via Web Push to every subscribed phone ----
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
if (!VAPID_PRIVATE) {
  console.log('VAPID_PRIVATE_KEY secret is not set — cannot send. Add it in repo Settings → Secrets (see README).');
  process.exit(0); // don't mark as notified; retry once the secret exists
}
const { default: webpush } = await import('web-push');
webpush.setVapidDetails('mailto:horseyear2026manuel@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);

const subDocs = (await getJSON(`${BASE}/pushSubs?pageSize=300`)).documents || [];
if (!subDocs.length) {
  console.log('No phones have enabled alerts yet — nothing to send to.');
  process.exit(0); // don't mark as notified; retry once someone subscribes
}
let sent = 0;
for (const sd of subDocs) {
  const sub = JSON.parse(val(sd.fields.sub));
  const subId = sd.name.split('/').pop();
  for (const m of messages) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(m));
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        // this phone unsubscribed / expired — clean it up
        await fetch(`${BASE}/pushSubs/${subId}`, { method: 'DELETE' }).catch(() => {});
        break;
      }
      console.log(`send failed (${e.statusCode || e.message}) — continuing`);
    }
  }
}
console.log(`Sent ${sent} notification(s) to ${subDocs.length} phone(s).`);

// mark events as notified (only after sends happened)
for (const p of patches) {
  await fetch(`${BASE}/puppies/${p.id}?updateMask.fieldPaths=${p.field}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { [p.field]: { integerValue: String(p.value) } } }),
  });
}
