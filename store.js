// ============================================================
//  store.js — data layer
//  Presents ONE simple interface to the app, backed by either
//  Firebase (live, shared with family) or localStorage (demo).
//  It always emits the same "state" shape to onChange():
//
//  {
//    mode: 'firebase' | 'demo',
//    settings: { feedingWindowMinutes, weightUnit },
//    puppies: [{
//      id, name, birthday, emoji,
//      weights:  [{ id, dateISO, weight }],           // oldest→newest
//      feedings: [{ id, atMillis, fedBy }],           // newest→oldest
//      photos:   [{ id, dateISO, dataUrl, note }]     // newest→oldest
//    }]
//  }
// ============================================================
import { firebaseConfig } from './firebase-config.js';

const FB_VERSION = '10.12.2';
const CDN = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;

const DEFAULT_SETTINGS = { feedingWindowMinutes: 120, weightUnit: 'lb', switchMinutes: 15 };

const isConfigured =
  firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('PASTE');

export const STORE_MODE = isConfigured ? 'firebase' : 'demo';

export async function createStore(onChange) {
  return STORE_MODE === 'firebase'
    ? firebaseStore(onChange)
    : demoStore(onChange);
}

// small helper: sort copies without mutating
const byWeightDate = (a, b) => a.dateISO.localeCompare(b.dateISO);
const byFeedDesc   = (a, b) => b.atMillis - a.atMillis;
const byPhotoDesc  = (a, b) => (b.dateISO || '').localeCompare(a.dateISO || '');

// ------------------------------------------------------------
//  DEMO STORE (localStorage) — single device, no sharing
// ------------------------------------------------------------
function demoStore(onChange) {
  const KEY = 'puppyTrackerDemo';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
  };
  let data = load() || { settings: { ...DEFAULT_SETTINGS }, puppies: [], familyPhotos: [] };
  data.familyPhotos ||= [];

  const save = () => localStorage.setItem(KEY, JSON.stringify(data));

  const emit = () => {
    const puppies = data.puppies.map(p => ({
      ...p,
      weights: [...(p.weights || [])].sort(byWeightDate),
      feedings: [...(p.feedings || [])].sort(byFeedDesc),
      photos: [...(p.photos || [])].sort(byPhotoDesc),
    }));
    onChange({
      mode: 'demo', settings: { ...data.settings }, puppies,
      familyPhotos: [...data.familyPhotos].sort(byPhotoDesc),
    });
  };

  const find = id => data.puppies.find(p => p.id === id);
  const commit = () => { save(); emit(); };

  // seed a friendly example puppy the very first time
  if (data.puppies.length === 0 && !localStorage.getItem(KEY)) {
    data.puppies.push({
      id: uid(), name: 'Example Pup', birthday: '', emoji: '🐶',
      weights: [], feedings: [], photos: [],
    });
  }
  save();
  queueMicrotask(emit);

  return {
    mode: 'demo',
    setSettings(patch) { data.settings = { ...data.settings, ...patch }; commit(); },
    addPuppy(d) { data.puppies.push({ id: uid(), weights: [], feedings: [], photos: [], ...d }); commit(); },
    updatePuppy(id, patch) { const p = find(id); if (p) Object.assign(p, patch); commit(); },
    deletePuppy(id) { data.puppies = data.puppies.filter(p => p.id !== id); commit(); },
    addWeight(id, d) { const p = find(id); if (p) (p.weights ||= []).push({ id: uid(), ...d }); commit(); },
    deleteWeight(id, wid) { const p = find(id); if (p) p.weights = p.weights.filter(w => w.id !== wid); commit(); },
    addFeeding(id, d) { const p = find(id); if (p) (p.feedings ||= []).push({ id: uid(), ...d }); commit(); },
    deleteFeeding(id, fid) { const p = find(id); if (p) p.feedings = p.feedings.filter(f => f.id !== fid); commit(); },
    addPhoto(id, d) { const p = find(id); if (p) (p.photos ||= []).push({ id: uid(), ...d }); commit(); },
    deletePhoto(id, pid) { const p = find(id); if (p) p.photos = p.photos.filter(ph => ph.id !== pid); commit(); },
    addFamilyPhoto(d) { data.familyPhotos.push({ id: uid(), ...d }); commit(); },
    deleteFamilyPhoto(id) { data.familyPhotos = data.familyPhotos.filter(ph => ph.id !== id); commit(); },
    addPushSub() { /* demo mode has no push server — no-op */ },
  };
}

// ------------------------------------------------------------
//  FIREBASE STORE (Firestore) — live + shared with family
// ------------------------------------------------------------
async function firebaseStore(onChange) {
  const appMod = await import(`${CDN}/firebase-app.js`);
  const fs = await import(`${CDN}/firebase-firestore.js`);
  const app = appMod.initializeApp(firebaseConfig);
  // Offline persistence: every device keeps a full local copy (IndexedDB).
  // The app opens instantly with last-synced data even with no internet,
  // and anything logged offline queues on the phone and syncs when the
  // connection returns. Multi-tab manager lets the app and the watch page
  // share the same local copy.
  let db;
  try {
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch {
    db = fs.getFirestore(app); // very old browser — fall back to online-only
  }

  const {
    collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
    onSnapshot, query, orderBy, serverTimestamp,
  } = fs;

  // in-memory mirror that we merge live listeners into
  let settings = { ...DEFAULT_SETTINGS };
  let familyPhotos = [];
  const base = new Map();      // puppyId -> {id, name, birthday, emoji}
  const kids = new Map();      // puppyId -> {weights, feedings, photos}
  const childUnsubs = new Map(); // puppyId -> [unsub, ...]

  const emit = () => {
    const puppies = [...base.values()].map(p => {
      const k = kids.get(p.id) || {};
      return {
        ...p,
        weights: [...(k.weights || [])].sort(byWeightDate),
        feedings: [...(k.feedings || [])].sort(byFeedDesc),
        photos: [...(k.photos || [])].sort(byPhotoDesc),
      };
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    onChange({ mode: 'firebase', settings: { ...settings }, puppies, familyPhotos: [...familyPhotos] });
  };

  const rows = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // settings/app
  onSnapshot(doc(db, 'settings', 'app'), s => {
    settings = { ...DEFAULT_SETTINGS, ...(s.exists() ? s.data() : {}) };
    emit();
  });

  // shared family photo album
  onSnapshot(query(collection(db, 'familyPhotos'), orderBy('createdAt', 'desc')), s => {
    familyPhotos = rows(s);
    emit();
  });

  // puppies collection → keep base + wire up child listeners
  onSnapshot(collection(db, 'puppies'), snap => {
    const seen = new Set();
    snap.docs.forEach(d => {
      seen.add(d.id);
      base.set(d.id, { id: d.id, ...d.data() });
      if (!childUnsubs.has(d.id)) wireChildren(d.id);
    });
    // remove puppies that disappeared
    for (const id of [...base.keys()]) {
      if (!seen.has(id)) {
        base.delete(id); kids.delete(id);
        (childUnsubs.get(id) || []).forEach(u => u());
        childUnsubs.delete(id);
      }
    }
    emit();
  });

  function wireChildren(id) {
    kids.set(id, { weights: [], feedings: [], photos: [] });
    const p = (name) => collection(db, 'puppies', id, name);
    const u1 = onSnapshot(query(p('weights'), orderBy('dateISO')), s => { kids.get(id).weights = rows(s); emit(); });
    const u2 = onSnapshot(query(p('feedings'), orderBy('atMillis', 'desc')), s => { kids.get(id).feedings = rows(s); emit(); });
    const u3 = onSnapshot(query(p('photos'), orderBy('createdAt', 'desc')), s => { kids.get(id).photos = rows(s); emit(); });
    childUnsubs.set(id, [u1, u2, u3]);
  }

  const child = (id, name) => collection(db, 'puppies', id, name);

  return {
    mode: 'firebase',
    setSettings(patch) { return setDoc(doc(db, 'settings', 'app'), patch, { merge: true }); },
    addPuppy(d) { return addDoc(collection(db, 'puppies'), { ...d, createdAt: serverTimestamp() }); },
    updatePuppy(id, patch) { return updateDoc(doc(db, 'puppies', id), patch); },
    async deletePuppy(id) {
      const k = kids.get(id) || {};
      const dels = [];
      for (const name of ['weights', 'feedings', 'photos'])
        for (const row of (k[name] || [])) dels.push(deleteDoc(doc(db, 'puppies', id, name, row.id)));
      await Promise.all(dels);
      return deleteDoc(doc(db, 'puppies', id));
    },
    addWeight(id, d) { return addDoc(child(id, 'weights'), { ...d, createdAt: serverTimestamp() }); },
    deleteWeight(id, wid) { return deleteDoc(doc(db, 'puppies', id, 'weights', wid)); },
    addFeeding(id, d) { return addDoc(child(id, 'feedings'), { ...d, createdAt: serverTimestamp() }); },
    deleteFeeding(id, fid) { return deleteDoc(doc(db, 'puppies', id, 'feedings', fid)); },
    addPhoto(id, d) { return addDoc(child(id, 'photos'), { ...d, createdAt: serverTimestamp() }); },
    deletePhoto(id, pid) { return deleteDoc(doc(db, 'puppies', id, 'photos', pid)); },
    addFamilyPhoto(d) { return addDoc(collection(db, 'familyPhotos'), { ...d, createdAt: serverTimestamp() }); },
    deleteFamilyPhoto(id) { return deleteDoc(doc(db, 'familyPhotos', id)); },
    addPushSub(d) {
      // doc id derived from the endpoint so re-subscribing the same phone
      // overwrites instead of duplicating
      const id = btoa(JSON.parse(d.sub).endpoint)
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(-180);
      return setDoc(doc(db, 'pushSubs', id), { ...d, createdAt: serverTimestamp() });
    },
  };
}
