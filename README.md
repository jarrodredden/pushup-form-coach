# Push-up Form Coach

A science-fair push-up coach that runs entirely in the browser: on-device pose estimation (MediaPipe Tasks Vision), rep counting, explainable form scores, spoken coaching, and a two-set before/after experiment.

Live: https://pushup-form-coach.vercel.app (deploys from `main` on Vercel).

## Running a coaching session (Connor / Enzo)

The app walks the volunteer through six steps, shown in the progress bar at the top:
**Name → Frame → Set 1 → Coach → Set 2 → Results**.

1. **Name** — type the volunteer's name. Pick **Coaching session** (2 sets of 5) or **Free practice**, and a **Feedback mode** for the experiment (Control / Visual / Audio / Combined). **Spoken form tips** adds the live-coach voice. Camera and view options are under **Camera setup**.
2. Tap **Start camera and sound**. That single tap also unlocks spoken audio on iPhone Chrome/Safari (the "Ready" clip plays).
3. **Frame** — prop the phone low on the floor about 1.5 m in front (Head-on) and hold the top of a push-up. The ring fills as tracking locks in; the app says "Calibration complete", counts down 5-4-3-2-1, "Let's get started", then **GO** flashes on the video. **Start anyway** appears after a few seconds if tracking is borderline.
4. **Set 1** — do 5 push-ups. The big counter and dots track reps; **Stop session** is always at the bottom.
5. **Coach** — the camera stays live so the volunteer can practice the fix. The panel shows the set 1 score and the top 1–2 things to change (depth, plank line, elbows). Tap **Start set 2** for another countdown.
6. **Set 2 → Results** — the results screen shows set 1 vs set 2, the point change, a depth / plank line / elbow breakdown, and every rep's score. Tap **Upload result** to add a row to the shared Google Sheet, then **Next volunteer** (clears the name) or **Try again** (same name).

**History** (top right) lists sessions saved to this device with **Save to this device** on the results screen.

## Admin: setting the "100 standards"

1. Tap **Admin** (top right) and enter PIN `180180`. Admin stays unlocked on this device until **Sign out admin**.
2. Under **100 standards**, pick an angle: **Front** (used for Head-on grading), **Side** (used for Side grading), Back, or Top. Each tab shows where to put the phone.
3. Either type the target for each metric, or start the camera, hold a textbook rep, and tap **Use current pose as draft**.
4. Set a tolerance for each metric, then **Save … 100 standard**.

How grading uses it: every metric is a 0–100 form score. A rep scoring at or above *target − tolerance* on a metric gets full credit (100); shortfalls scale proportionally toward 0. So target 90 ± 10 means anything 80+ counts as perfect, and 40 scores 50. Views without a saved standard use the built-in scoring. **Diagnostics** shows the live event log.

## Scoring model

- **Elbow depth** — how far the elbows bend (100 ≈ 85° at the bottom).
- **Plank line** — shoulders, hips, and ankles in one line. Side view measures hip sag and hip pike (butt up) directly; Head-on uses a hip-height proxy.
- **Elbow tuck**, **hands under shoulders**, and **head position** fill out the rest.
- The rep score is weighted mostly toward depth and plank line.
- Rep counting is separate from form: any real top → bottom → top cycle counts; form only changes the score.

## Feedback modes (the experiment)

| Mode | Skeleton + on-screen cues | Spoken countdown / rep counts |
| --- | --- | --- |
| Control | no | no |
| Visual | yes | no |
| Audio | no | yes |
| Combined | yes | yes |

**Spoken form tips** is a separate switch (Audio or Combined only) for the live-coach voice lines.

## Results upload (Google Sheet)

Upload posts one row as `text/plain` JSON to a Google Apps Script web app, which appends it to spreadsheet `1xncvpxe7yjDadtHkOncha0sag4L26KIBQTw7TrnZ0es`. The deployed web-app URL is built in; set `VITE_RESULTS_UPLOAD_URL` on Vercel only to override it.

The script is `scripts/google-apps-script/Code.gs`. Deploy it as a Web App with **Execute as: Me** and **Who has access: Anyone**. Each row has timestamp, volunteer name, mode, set 1 / set 2 scores, delta, reps, a notes summary, and a short user agent.

## School Chromebook / offline

If the school filter blocks `pushup-form-coach.vercel.app`, use the **offline package**: one folder that runs the whole app with no internet and no website. The pose AI (MediaPipe WASM + model) and voice clips are inside it, and the app uses the device's system fonts, so nothing is fetched from a CDN.

**Get the zip (at home, where the site works):**
- Tap **Download the offline version** at the bottom of the app's first screen, or go to https://pushup-form-coach.vercel.app/downloads/pushup-form-coach-offline.zip (about 11 MB).
- Also available as the `pushup-form-coach-offline` artifact on each GitHub Actions run of **Build + offline package**, or build it yourself with `npm run build:offline` (writes `release/pushup-form-coach-offline.zip`).

**On the Chromebook:**
1. Move the zip over. The easiest way is Google Drive: upload it at home, then on the Chromebook open **Files → Google Drive** and drag it into **My files → Downloads**. A USB stick also works.
2. In the Files app, double-click the zip (it opens like a drive) and drag the `pushup-form-coach-offline` folder into **My files → Downloads**. Keep the folder together.
3. Open the folder and double-click **`index.html`**. It opens in Chrome with a `file://` address. If it opens in something else, right-click → **Open with → Chrome**, or drag `index.html` onto a Chrome window.
4. Look for the **Offline** tag next to "Form Coach". Tap **Start camera and sound**, then **Allow** the camera.

The zip includes `README-OFFLINE.txt` with the same steps plus troubleshooting.

**What works and what doesn't (tested in Chrome):**
- ✅ **Opening `index.html` directly (`file://`)** — Chrome treats local files as a secure context, so the camera is allowed. Verified with networking disabled: the pose model loads, audio plays, the camera starts, and there are zero network requests.
- ✅ **`http://localhost`** on the same computer (`python3 -m http.server 8000` in the folder) — also a secure context. Useful on a laptop that blocks local files.
- ❌ **Serving the folder to Chromebooks over the classroom network** (`http://192.168.x.x:8000`) — Chrome blocks the camera on plain-http network addresses (`navigator.mediaDevices` isn't even available). Each device must open its own copy.
- ⚠️ **School admin policy wins.** If IT blocks local files in Chrome (`file://` in the URL blocklist) or blocks camera access, the package can't override that. Symptoms: a "blocked by your administrator" page, or no camera prompt. Ask IT to allow it, or run the demo on a teacher/personal laptop.
- ⚠️ **Upload result is best-effort offline.** It needs internet with `script.google.com` reachable; otherwise the app says so and you can **Save to this device** or **Export notes** instead.
- ℹ️ History, the admin unlock, and the 100 standards are stored per browser origin, so the offline copy starts fresh. Re-enter the 100 standards once under Admin (PIN `180180`).

**Optional https mirror:** the same workflow can publish the web app to GitHub Pages (`https://jarrodredden.github.io/pushup-form-coach/`) for schools that allow `github.io`. Turn it on with **Settings → Pages → Source: GitHub Actions** and a repository variable `ENABLE_GITHUB_PAGES` set to `true`.

**How the package is built:** `scripts/build-offline.mjs` runs a Vite build in `offline` mode with relative paths, inlines the app JS/CSS into `index.html` (Chrome won't load module scripts or `crossorigin` stylesheets from `file://`), and ships the MediaPipe WASM and pose model as base64 inside plain `<script>` files. The app turns those into in-memory blobs, which avoids `fetch()`, since `file://` pages can't use it. `npm run build` does this automatically and publishes the zip at `/downloads/` on Vercel.

## Phone tips

- Camera access needs a secure context: the https Vercel link, `localhost`, or the offline package opened as a local file.
- Audio clips are MP3s in `public/voices/` played through a FIFO queue, so every line finishes before the next starts.
- Head-on is the recommended setup. Use Side only with room for a tripod about 2 m away.

## Privacy

Pose estimation runs on-device. Camera frames and raw pose data are never uploaded. History and 100 standards live in this browser's localStorage; only the summary row is sent when you tap **Upload result**.

## Develop

```bash
npm install
npm run dev        # local dev server
npm run typecheck && npm run lint && npm test && npm run build   # web app + offline zip
npm run build:offline                                             # just release/pushup-form-coach-offline.zip
```

The MediaPipe WASM is copied from `node_modules` into `public/mediapipe/` automatically (`predev`/`prebuild`), and the pose model is vendored at `public/models/`, so neither build depends on a CDN.

UI lives in `src/components/`; the step/phase rules and set summaries are in `src/lib/sessionFlow.ts` (unit tested), and the 100-standard scoring is in `src/lib/baselineStorage.ts`.
