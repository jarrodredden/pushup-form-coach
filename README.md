# Push-up Form Coach

A science-fair push-up coach that runs entirely in the browser: on-device pose estimation (MediaPipe Tasks Vision), rep counting, explainable form scores, spoken coaching, and a two-set before/after experiment.

Live: https://pushup-form-coach.vercel.app (deploys from `main` on Vercel).

## Running a coaching session (Connor / Enzo)

The app walks the volunteer through six steps, shown in the progress bar at the top:
**Name → Consent → Frame → Set 1 → Coach → Set 2 → Results**.

1. **Name** — type the volunteer's name. Then **Consent**: tap **Read & sign consent** (see [Consent forms](#consent-forms) below). **Start camera and sound** stays locked until the form is signed for that name. Pick **Coaching session** (2 sets of 5) or **Free practice**. Volunteers always get the study protocol, Head-on (front) camera, and can't see the feedback or camera-angle selectors (see [Feedback modes](#feedback-modes-the-experiment)). With Admin unlocked, the **Feedback** and **View** selectors appear for testing.
2. Tap **Start camera and sound**. That single tap also unlocks spoken audio on iPhone Chrome/Safari (the "Ready" clip plays).
3. **Frame** — prop the phone low on the floor about 1.5 m in front (Head-on) and hold the top of a push-up. The ring fills as tracking locks in; the app says "Calibration complete", counts down 5-4-3-2-1, "Let's get started", then **GO** flashes on the video. **Start anyway** appears after a few seconds if tracking is borderline.
4. **Set 1** — do 5 push-ups. The big counter and dots track reps; **Stop session** is always at the bottom.
5. **Coach** — the camera stays live so the volunteer can practice the fix. The panel shows the set 1 score and the top 1–2 things to change (depth, plank line, elbows). A mandatory **2-minute rest** starts as soon as set 1 ends so set 2 isn't skewed by fatigue: **Start set 2** stays locked and shows the countdown (**Rest 2:00 … 0:01**) until the full 120 seconds pass, then works as usual and starts another countdown. Next to the countdown, an animated stick figure loops an ideal push-up (front view, 2 s per rep): straight body, hands slightly wider than the shoulders, elbows tucked about 45°, chest near the floor, full lockout ("Watch the ideal form: body straight, elbows tucked, chest low"). It's drawn in SVG from the app's own push-up model (`src/components/PushupDemo.tsx`), so it works offline; with the OS "reduce motion" setting it shows a still bottom pose. Tips and the practice bars stay available during the rest. When Admin is PIN-unlocked, a **Skip rest (admin only — testing)** button also appears; volunteers never see it.
6. **Set 2 → Results** — the results screen shows set 1 vs set 2, the point change, a depth / plank line / elbow breakdown, and every rep's score. Tap **Upload result** to add a row to the shared Google Sheet, then **Finish** (or **Try again** with the same name). If the upload can't happen (offline package, or the upload failed), **Finish without uploading** appears under **Save & share**.
7. **Share** — **Finish** opens a thank-you screen: "Thanks for helping with our science fair project! Share this with others so they can try it too." It shows https://pushup-form-coach.vercel.app as text, a big **Copy link** button (Clipboard API, then a select-and-copy fallback; if both are blocked the link is left selected for Ctrl+C), **Share** (the phone's share sheet via the Web Share API; hidden where the browser doesn't have it), and a QR code generated on the device (`qrcode-generator`, no external service), so it works offline too. The offline package still shares the public Vercel link. **Next volunteer** clears the name and consent and goes back to the start; **Back to results** returns to the scores.

**History** (top right) lists sessions saved to this device with **Save to this device** on the results screen.

## Consent forms

Every session starts with the ISEF *Human Informed Consent Form*, filled in for this project. It covers the purpose, the tasks (5 push-ups, brief coaching, 5 more), time (about 5–10 minutes), risks, benefits, confidentiality, and the Adult Sponsor contact.

1. After the name is entered, tap **Read & sign consent**. The sheet shows the full form.
2. Choose **Parent / guardian** (the default) or **Participant is 18+**. Type the printed name; the date fills in automatically (mm/dd/yy).
3. Sign in the white box with a finger, stylus, or mouse (**Clear** to redo). A minor can also add an optional assent signature.
4. Tap **Sign consent form**. The app builds a one-page PDF on the device (jsPDF) with the filled fields, signature image(s), and date. The consent card then turns green and **Start camera and sound** unlocks.
5. The PDF uploads to the **same Google Drive folder as the results spreadsheet**, named `consent_<Display-Name>_<YYYY-MM-DD_HH-MM-SS>.pdf` (local time, unsafe characters replaced). Each upload also adds a row to a **Consents** tab in the spreadsheet with a link to the file.
6. **Download PDF** always saves a local copy. If Drive can't be reached (offline, filter, or an old script), the card says so, the PDF waits on the device, and it retries automatically when the browser comes back online (or tap **Retry Drive upload**). **Admin → Consent** shows how many are waiting, with **Download all**.

The consent is tied to the participant's name: changing the name or tapping **Next volunteer** requires a new signature. **Try again** (same name) keeps it.

**Admin → Consent** edits the blanks printed on the form: Student researcher(s) (default "Connor Redden, Enzo Sweeney"), project title, Adult Sponsor (default Jarrod Redden), and sponsor phone/email. These are saved per device; a blank field falls back to its default.

## Admin: setting the "100 standards"

1. Tap **Admin** (top right) and enter PIN `180180`. Admin stays unlocked on this device until **Sign out admin**.
2. Under **100 standards**, pick an angle: **Front** (used for Head-on grading), **Side** (used for Side grading), Back, or Top. Each tab shows where to put the phone.
3. Either type the target for each metric, or start the camera, hold a textbook rep, and tap **Use current pose as draft**.
4. Set a tolerance for each metric, then **Save … 100 standard**. **Elbow tuck** is set as an ideal range of upper-arm-to-torso angles (default 30°–50°) instead of a single target: anything at or inside the max (including more tucked) scores 100. Standards saved before the range existed load with the default range.

How grading uses it: every metric is a 0–100 form score. A rep scoring at or above *target − tolerance* on a metric gets full credit (100); shortfalls scale proportionally toward 0. So target 90 ± 10 means anything 80+ counts as perfect, and 40 scores 50. Views without a saved standard use the built-in scoring. **Diagnostics** shows the live event log.

## Scoring model

- **Elbow depth** — how far the elbows bend (100 ≈ 85° at the bottom).
- **Plank line** — shoulders, hips, and ankles in one line (`src/lib/plankLine.ts`).
  - *Side view:* the shoulder–hip–ankle angle (knees if the ankles aren't visible), corrected for the stream's aspect ratio. Up to 12° of bend scores 100, falling to 0 at 40°; the side of the shoulder→foot line the hip is on says sag vs pike.
  - *Head-on:* the body runs toward the camera, so that angle can't be measured. Instead the app compares the shoulder-to-hip gap on screen (in shoulder widths) with what a straight plank would show at the current depth, calibrated from the volunteer's own top-of-rep plank. Before that calibration it uses a typical-plank reference with extra slack. Knees are the fallback when hips are unreliable.
  - If neither hips nor knees are visible, plank line is **n/a**: it's left out of the rep score (the other weights are rescaled) instead of counting as 0. **Admin → Diagnostics** and the results screen (admin only) show the raw plank measurement for each rep.
- **Elbow tuck** — the upper-arm-to-torso angle (Head-on: estimated from how far the elbow sits outside the shoulder–wrist line; Side: from MediaPipe's 3D landmarks), median-smoothed over 7 frames and over the rep's bottom so landmark jitter doesn't cost points. At or under the ideal max (default 50°) is 100; flare past it ramps down gently: +10° → 85, +20° → 60, +30° → 30, +40° → 10, +50° → 0.
- **Hands under shoulders** and **head position** fill out the rest.
- The rep score is weighted mostly toward depth and plank line (Head-on: depth 55%, plank 24%, elbows 9%, hands 7%, head 5%; Side: depth 56%, plank 28%, hands 10%, elbows 6%). A completely flared elbow can cost at most 9 points (Head-on), so elbows alone can't drag a good rep into the 50s.
- **Each rep is scored at the bottom only.** Frames count once the elbows bend to 120° or less, and the score averages the frames within 12° of that rep's deepest point. The descent, the push back up, and the lockout don't dilute the score, so a slow, controlled rep scores the same as a quick one with the same bottom position.
- Rep counting is separate from form: any real top → bottom → top cycle counts; form only changes the score.

**Coaching tips** (live cues and the Coach-step list) are ranked by expected overall-score gain: the metric's weight × its gap to 100, minus the expected loss on metrics the change tends to hurt. Going deeper tends to make a weak plank sag and weak elbows flare, so depth isn't pushed first when the plank or elbows are much weaker. Hip tips are directional: **Don't pike** (hips high) or **Don't sag** (hips low), never a vague "hips lower". Depth is phrased as "a little deeper while keeping hips level". The logic lives in `src/lib/coaching.ts`.

## Feedback modes (the experiment)

| Mode | Skeleton + on-screen cues | Spoken countdown / rep counts |
| --- | --- | --- |
| Control | no | no |
| Visual | yes | no |
| Audio | no | yes |
| Combined | yes | yes |

**Volunteer protocol (default, Admin locked):** set 1 is **Control** (rep beeps/counts and the countdown only, no coaching), the break and set 2 are **Combined** (skeleton, on-screen cues, and spoken form tips), camera **Head-on (front)**. Free practice is always Combined. With Admin unlocked, the setup screen shows **Feedback** (Volunteer / Control / Visual / Audio / Combined) and **View** selectors, and a **Spoken form tips** switch for non-protocol modes.

**In-set feedback is corrective only.** After each rep the coach names the single weakest part of that rep (for example "Tuck your elbows", "Lower your chest", "Keep your hips up", "Squeeze your core", "Full lockout at the top"), rotating phrasing so the same line never plays twice in a row. A clean rep gets silence, or rarely a neutral "Keep that form" (at most once per set). Praise is saved for the end: "Set one done. Nice work!" before the rest, and a session wrap-up with the set 1 → set 2 change ("Great work! You improved by 8 points from set 1 to set 2."). Spoken lines still queue, so they never overlap or cut off. Lines are in `src/lib/feedbackLines.json`; `node scripts/generate-voices.mjs` makes any missing MP3s.

### Blue skeleton = good form (set 2)

In set 2 with visuals (Combined or Visual), each part of the live skeleton turns **light blue** while its form component is good, and stays the usual lime green while it isn't (a small "Blue = good form" legend sits under the rep dots). Set 1, the break, Control and Audio keep the plain overlay so the baseline set stays clean. In free practice only an unlocked Admin sees the colours, for previewing.

| Skeleton part | Form component |
| --- | --- |
| Upper arms, forearms, elbow dots | Elbow tuck |
| Torso (shoulder–hip lines), hips, knees, ankles | Plank line / hips |
| Shoulder line, shoulder dots, wrists and hands | Hands under shoulders |
| Head points | Head position (Head-on only) |
| Pulsing blue rings on the elbows | Target depth reached (held 0.7 s) |

"Good" means the live score is at or above the same line the coach uses for corrections (depth 80, plank 75, elbow tuck 75, hands 70, head 65), computed from the same per-frame measurements as the score, including the 7-frame elbow median. To stop flicker, a blue part only drops back once its score falls 5 points under the line, and any change needs 3 frames in a row. A part the camera can't judge (plank n/a, elbow angle unreadable, head not visible, head in Side view) stays lime. The logic is in `src/lib/formColors.ts`; drawing goes through the same cover transform as the video (`src/lib/stageLayout.ts`) and uses two paths per colour per frame, so it stays cheap on phones.

### Real-time "Up" / "Down" tempo cues (set 2)

During the coached set the voice says **"Down"** the moment the volunteer locks out at the top (the start of each rep, including the first one after **Go!**) and **"Up"** the moment the elbows reach the target depth (depth score 80, about 100° of elbow bend, the same depth that avoids the "Lower your chest" correction). That tells them when they've gone deep enough. The cues come from the live pose, not a metronome, so they follow the volunteer's own pace.

- **One Down and one Up per rep.** Each cue arms the other, and the two thresholds are about 60° of elbow bend apart, so landmark jitter around either one can't fire it twice. Two cues are never closer than 280 ms. A shallow rep that never reaches depth gets no Up, but its next lockout still gets a Down. There's no Down at the last lockout of the set, and the first Down waits until "Go!" has been spoken (at most 2.5 s).
- **Instant playback.** Cues don't use speech synthesis or `<audio>` elements. The two clips (`src/assets/tempo/up.wav`, `down.wav`, same voice as the other clips, silence trimmed) are inlined into the app bundle, decoded into Web Audio buffers on the **Start camera and sound** tap, and started with an `AudioBufferSourceNode` on the same pose frame that crosses the threshold. This also works on iPhone (the tap unlocks audio, and the audio session is set to playback so the ringer switch doesn't mute it) and in the offline package (no files to fetch).
- **Coaching lines never block a cue.** Cues skip the FIFO queue. A line that's already playing is ducked to 30% volume under the cue (iPhone ignores web media volume, so there they simply mix), and the next queued line waits until the cue finishes. Corrections still play, in the gaps.
- **Only with audio.** On in Combined and Audio modes, so in the volunteer protocol that's set 2 (and free practice). Never in set 1 / Control or Visual. Admin can switch them off with **Up / Down tempo cues** in the Feedback card; volunteers can't.
- **Logged.** Each rep records whether cues were on, the results screen says "Up / Down tempo cues: on for set 2", the notes export has the same line, and the Sheet row has a `tempo_cues` column (`set2`, `off`, …) plus `tempo=set2` in the notes summary.
- **Latency.** **Admin → Diagnostics** logs every cue with its timing: pose result → `start()` (well under 1 ms), plus the browser's reported audio output latency, plus that frame's pose inference time. A per-set summary is logged too.

To regenerate the clips: `node scripts/generate-tempo-cues.mjs` (needs `ffmpeg` and internet).

## Results upload (Google Sheet)

Each result is posted as one `text/plain` JSON row to a Google Apps Script web app, which appends it to spreadsheet `1xncvpxe7yjDadtHkOncha0sag4L26KIBQTw7TrnZ0es`. The deployed web-app URL is built in; set `VITE_RESULTS_UPLOAD_URL` on Vercel only to override it.

**Automatic.** As soon as set 2 finishes, the row is saved without a tap. The results screen shows "Saving to results sheet…" and then "Saved ✓".
- **Kept until confirmed.** The row first goes into a queue in `localStorage` (`pushup-results-pending`) and is removed only when the sheet confirms it. A closed or reloaded page uploads its leftover rows on the next load.
- **Retries.** A failed upload retries on its own after 3 s, 6 s, 12 s, and so on, up to once a minute, and again as soon as the browser comes back online. A **Retry upload** button appears only after a failed attempt.
- **Offline.** Offline, including the offline package, the screen says "Will upload when online". Save to this device and Export notes / CSV still work as backups.
- **Finish isn't blocked.** Finish → share page is available right away; the upload keeps going in the background.
- **No duplicates.** Every session has a `session_id`, and the queue holds one row per session. The script skips a `session_id` it already has, so retries, reloads, and manual taps can't add a second row.
- **Manual upload.** Sessions that end another way (stopped early, free practice) still use the manual **Upload result** button.
- **Admin view.** Admin → Diagnostics shows how many rows are waiting and has an **Upload now** button.

The script is `scripts/google-apps-script/Code.gs`. Deploy it as a Web App with **Execute as: Me** and **Who has access: Anyone**. Each row has timestamp, volunteer name, mode, set 1 / set 2 scores, delta, reps, a notes summary, a short user agent, and the protocol: **set1_feedback** / **set2_feedback** (e.g. `control` / `combined`), **camera_view** (`front` / `side`), and **tempo_cues** (`set2` when the Up / Down cues were on for set 2, otherwise `off`), plus **session_id** (used to skip duplicate uploads). The script writes values by header name and adds any missing header columns to the right, so existing sheets keep their rows. The notes summary also starts with `[set1=control set2=combined tempo=set2 camera=front]`, so the protocol is recorded even before the script is redeployed.

**Redeploy for the `session_id` column and duplicate check (Jarrod):** paste the current `Code.gs` into **Extensions → Apps Script**, **Save**, then **Deploy → Manage deployments → pencil → Version: New version → Deploy** (same `/exec` URL). Until then, rows still upload automatically and the app itself never sends a session twice after a confirmed save; only the server-side check (for a save whose reply got lost) and the `session_id` column wait for the redeploy.

The same script also saves the signed consent PDFs (`type: "consent_pdf"` posts) into the spreadsheet's parent Drive folder and logs them on a **Consents** tab.

**One-time redeploy for consent PDFs (Jarrod):**
1. Open the spreadsheet → **Extensions → Apps Script**. Replace the code with the current `scripts/google-apps-script/Code.gs` and **Save**. Optionally, under **Project Settings**, tick **Show "appsscript.json" manifest file in editor** and paste the `oauthScopes` (Sheets + full Drive) from `scripts/google-apps-script/appsscript.json`.
2. Pick the **`authorizeDrive`** function in the toolbar and click **Run**. Approve the Google Drive permission ("See, edit, create, and delete all of your Google Drive files"). It creates a tiny test file in the folder and trashes it, which forces the full Drive scope that saving PDFs needs. The log shows which folder PDFs will go to. Re-run this any time `Code.gs` changes, or if the app reports "You do not have permission to call DriveApp.Folder.createFile".
3. **Deploy → Manage deployments**, click the pencil on the existing web app, set **Version: New version**, and **Deploy**. Editing the existing deployment keeps the same `/exec` URL, so the app needs no change. (A brand-new deployment would get a new URL; you'd then set `VITE_RESULTS_UPLOAD_URL`.)

Until this is done, signing still works and PDFs download locally, but the app reports "the upload script needs the consent update". The old script treats any post as a result row, so an attempt may leave a blank row in **Results**. To avoid repeats, the app only re-sends these PDFs when you tap **Retry** (not automatically).

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
- Audio clips are MP3s in `public/voices/` played through a FIFO queue, so every line finishes before the next starts. The Up / Down tempo cues bypass that queue (see above).
- Head-on is the recommended setup. Use Side only with room for a tripod about 2 m away.
- The preview always fills its box, whatever size or orientation the camera stream comes in (phones often send portrait 720×1280 even when 1280×720 is requested). The video element and the skeleton overlay are both laid out from one "cover" transform (`src/lib/stageLayout.ts`), recomputed on every frame and on stream, stage, viewport, and orientation changes, so the skeleton always sits on the person.
  - The preview box itself has a fixed size per screen (full width; a shorter height during the rest) that never depends on the video.
  - iOS can report a stale stream size (landscape while it paints portrait frames) and can keep the previous screen's video fit. The app therefore also checks the size of an actual rendered frame, and on iPhone/iPad it re-attaches the stream when the preview box changes size (set ↔ rest) or the phone rotates.
  - A watchdog checks 10 times a second. If the video covers less than 95% of the box, or the reported size disagrees with the rendered frame, for 300 ms it re-lays out the preview; if that doesn't help within 1.5 s it re-attaches the stream (at most twice per camera start).
  - Admin → Diagnostics → **Camera preview numbers** shows the stage size, stream sizes from each source, the drawn video rect, and how much of the box it covers, on the camera screen. It also turns on by itself if the watchdog had to step in. The same numbers are written to the Diagnostics log on every screen change, so a screenshot of either is enough to debug a bad preview.

## Privacy

Pose estimation runs on-device. Camera frames and raw pose data are never uploaded. History and 100 standards live in this browser's localStorage; only the summary row is sent when you tap **Upload result**. Signed consent PDFs go only to the project Drive folder. The current participant's PDF, plus any still waiting to upload, are kept in this browser's localStorage until **Next volunteer** or a successful upload.

## Develop

```bash
npm install
npm run dev        # local dev server
npm run typecheck && npm run lint && npm test && npm run build   # web app + offline zip
npm run build:offline                                             # just release/pushup-form-coach-offline.zip
```

The MediaPipe WASM is copied from `node_modules` into `public/mediapipe/` automatically (`predev`/`prebuild`), and the pose model is vendored at `public/models/`, so neither build depends on a CDN.

UI lives in `src/components/`; the step/phase rules and set summaries are in `src/lib/sessionFlow.ts` (unit tested), and the 100-standard scoring is in `src/lib/baselineStorage.ts`.
