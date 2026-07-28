// ============================================================
//  backup.mjs — full local backup of the Puppy Tracker database
//
//  Run:  node scripts/backup.mjs            (or double-click backup.bat)
//        node scripts/backup.mjs D:\my\dir  (optional custom location)
//
//  Creates a dated folder (default: Desktop\puppy-tracker-backups\)
//  containing:
//    data.json   — the complete database (restorable snapshot)
//    photos\     — every picture as a real .jpg, organized per pup
//                  plus the family album
// ============================================================
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const PROJECT = 'puppy-tracker-f3dc0';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// unwrap Firestore's typed JSON values
const val = f => f == null ? null
  : 'integerValue' in f ? Number(f.integerValue)
  : 'doubleValue' in f ? f.doubleValue
  : 'stringValue' in f ? f.stringValue
  : 'booleanValue' in f ? f.booleanValue
  : 'timestampValue' in f ? f.timestampValue
  : 'mapValue' in f ? Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, v]) => [k, val(v)]))
  : 'arrayValue' in f ? (f.arrayValue.values || []).map(val)
  : null;
const unwrapDoc = d => ({ id: d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, val(v)])) });

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${await r.text()}`);
  return r.json();
}

// list a collection completely (follows pagination)
async function listAll(path) {
  const out = [];
  let pageToken = '';
  do {
    const res = await getJSON(`${BASE}/${path}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`);
    for (const d of res.documents || []) out.push(unwrapDoc(d));
    pageToken = res.nextPageToken || '';
  } while (pageToken);
  return out;
}

const safe = s => String(s || 'unnamed').replace(/[^a-zA-Z0-9 _.-]/g, '_').trim() || 'unnamed';
const pad = n => String(n).padStart(2, '0');

// ---- destination folder ----
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
const root = process.argv[2] || join(os.homedir(), 'Desktop', 'puppy-tracker-backups');
const dir = join(root, stamp);
mkdirSync(join(dir, 'photos', 'family'), { recursive: true });

let photoCount = 0, photoBytes = 0;
function savePhoto(folder, name, dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return;
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const buf = Buffer.from(b64, 'base64');
  mkdirSync(join(dir, 'photos', folder), { recursive: true });
  writeFileSync(join(dir, 'photos', folder, name), buf);
  photoCount++; photoBytes += buf.length;
}

console.log(`Backing up ${PROJECT} → ${dir}\n`);

// ---- settings ----
let settings = {};
try { settings = unwrapDoc(await getJSON(`${BASE}/settings/app`)); } catch { /* none yet */ }

// ---- puppies + everything under them ----
const puppies = [];
let feedingCount = 0, weightCount = 0;
for (const p of await listAll('puppies')) {
  const [weights, feedings, photos] = await Promise.all([
    listAll(`puppies/${p.id}/weights`),
    listAll(`puppies/${p.id}/feedings`),
    listAll(`puppies/${p.id}/photos`),
  ]);
  feedingCount += feedings.length;
  weightCount += weights.length;
  const folder = safe(p.name);
  if (p.avatar) savePhoto(folder, 'profile.jpg', p.avatar);
  photos.forEach((ph, i) => savePhoto(folder, `${safe(ph.dateISO || 'photo')}_${i + 1}.jpg`, ph.dataUrl));
  puppies.push({ ...p, weights, feedings, photos });
  console.log(`  ${p.name}: ${weights.length} weigh-ins, ${feedings.length} feedings, ${photos.length} photos`);
}

// ---- family album ----
const familyPhotos = await listAll('familyPhotos');
familyPhotos.forEach((ph, i) => savePhoto('family', `${safe(ph.dateISO || 'photo')}_${i + 1}.jpg`, ph.dataUrl));
console.log(`  Family album: ${familyPhotos.length} photos`);

// ---- the restorable snapshot ----
const snapshot = { backedUpAt: now.toISOString(), project: PROJECT, settings, puppies, familyPhotos };
const json = JSON.stringify(snapshot, null, 2);
writeFileSync(join(dir, 'data.json'), json);

// ---- retention: keep the newest 30 backups, delete older ones ----
const KEEP = 30;
const snapshots = readdirSync(root, { withFileTypes: true })
  .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/.test(e.name))
  .map(e => e.name).sort();
for (const old of snapshots.slice(0, Math.max(0, snapshots.length - KEEP))) {
  rmSync(join(root, old), { recursive: true, force: true });
  console.log(`  (cleaned up old backup ${old})`);
}

console.log(`\nDone! ✅
  ${puppies.length} pups · ${weightCount} weigh-ins · ${feedingCount} feedings
  ${photoCount} pictures saved as .jpg (${(photoBytes / 1048576).toFixed(1)} MB)
  data.json: ${(json.length / 1048576).toFixed(1)} MB
  Location: ${dir}`);
