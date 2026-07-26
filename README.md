# 🐾 Puppy Tracker

A simple web app to track your puppies:

- 🍽 **Feeding countdowns** — every puppy has a circular timer that fills up as feeding time approaches, with a live countdown inside. When it's full the card pulses red: time to feed. Window is adjustable (e.g. every 2 hours).
- 🍼 **Feeding session timer** — tap **Start feeding** when a puppy starts eating; an orange ring counts down your switch time (adjustable, default 15 min) and flashes + beeps when it's time to rotate to the next puppy. **✓ Done** logs the feeding.
- ⚖️ **Daily weight** — log weigh-ins and watch a growth chart with an **expected-gain tracker**: newborns should gain 5–10% of their birth weight per day, and the app tells you per puppy whether they're ✓ on track, ⚠ gaining slowly, or ▼ losing weight (vet time). Set each pup's birth weight + birthday to power it.
- 📷 **Growth photos** — snap a photo over time to see them grow. Tap the ★ on any photo to make it a puppy's profile picture, or set a dedicated one in ✏️ Edit.
- 🔔 **Real notifications** — your phone gets a push ("🍽 Green, Blue need to eat!") when pups cross the feeding window or a switch timer runs out, **even with the app closed**. A GitHub Action in this repo checks the litter every ~5 minutes and sends Web Push to every phone that enabled alerts. Each person: open the app **from the Home Screen icon** → ⚙️ → **Get feeding alerts on this phone** → Allow. One-time repo setup: add the VAPID private key as an Actions secret named `VAPID_PRIVATE_KEY` (repo Settings → Secrets and variables → Actions). While the app is open, alerts also beep + vibrate instantly. Note: GitHub pauses scheduled workflows after ~60 days without repo activity — any commit revives them.
- ⏰ **Calendar reminders** — optionally add repeating iPhone alarms on a fixed schedule (.ics download in Settings).
- 🐶🐶🐶 **Litter overview** — one table with every pup's latest weight, gain/day, and health status side by side, sorted smallest-first so the runt is always on top.
- 👨‍👩‍👧 **Shared with family** — everyone sees the same live data (once Firebase is set up).

It's plain HTML/CSS/JavaScript — **no build step** — so it runs great on free GitHub Pages and is easy to edit.

---

## Two modes

| Mode | When | Data |
|------|------|------|
| **Demo** | Before you add Firebase keys | Saved only on *this* device, not shared |
| **Live** | After you paste Firebase keys | Shared with your whole family in real time |

The app starts in **Demo mode** so you can try it immediately.

---

## 1. Try it locally (optional)

Because the app uses JavaScript modules, you can't just double-click `index.html` — you need a tiny local web server. Pick one:

```bash
# Option A — Node (if installed)
npx serve

# Option B — Python (usually pre-installed)
python -m http.server 8000
```

Then open the address it prints (e.g. `http://localhost:8000`). You'll see Demo mode.

---

## 2. Set up Firebase (to share with family) — ~10 minutes, free

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. Click **Add project**, give it a name (e.g. `puppy-tracker`), and finish. You can skip Google Analytics.
3. In the left menu open **Build → Firestore Database → Create database**.
   - Choose **Start in production mode** → pick a location → **Enable**.
4. Open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules), and click **Publish**.
5. Back on the project **Overview**, click the **`</>`** (Web) icon to "Add app to get started".
   - Give it a nickname, click **Register app**. **Do NOT** enable Hosting.
   - Firebase shows you a `firebaseConfig = { ... }` block. Copy those values.
6. Open [`firebase-config.js`](firebase-config.js) in this project and paste each value in, replacing the `PASTE_...` placeholders.
7. Reload the app — the yellow "Demo mode" banner disappears. You're live! 🎉

> **Optional passcode:** set `APP_PASSCODE` in `firebase-config.js` (e.g. `"1234"`) to add a simple family lock screen.

---

## 3. Put it online with GitHub Pages — free

**Easiest (no commands):**

1. Create a free account at <https://github.com>, then click **New repository**. Name it `puppy-tracker`, set it **Public**, and create it.
2. On the new repo page click **uploading an existing file**, then drag in **all** the files from this folder. Commit.
3. Go to **Settings → Pages**. Under *Build and deployment*, set **Source: Deploy from a branch**, **Branch: main / (root)**, then **Save**.
4. Wait ~1 minute, refresh, and GitHub shows your live link: `https://YOUR-NAME.github.io/puppy-tracker/`
5. Send that link to your family. Everyone opens it and sees the same puppies. 🐶

**With git (if you prefer):**

```bash
git init
git add .
git commit -m "Puppy Tracker"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/puppy-tracker.git
git push -u origin main
# then enable Pages in Settings → Pages as above
```

---

## 4. Use it on your iPhone

- Open the link in Safari → **Share → Add to Home Screen**. It now behaves like an app.
- For alarms: open **⚙️ Settings → 🔔 Set feeding reminders**, choose a start time and interval, tap **Download**, then tap the downloaded file and choose **Add All**. Native iPhone alarms will remind you to feed the puppies. Each family member can do this on their own phone.

---

## Notes

- **Photos** are automatically shrunk before saving, so they stay small and load fast (kept in the database — no extra billing setup needed).
- **Feeding window** is fully adjustable in Settings (hours + minutes).
- The Firebase config keys are *meant* to be public — your data is governed by the Firestore rules, not the keys. Keep the app link within the family.
