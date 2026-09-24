# Push-up Form Coach

A science-fair push-up coach that runs entirely in the browser.

## What it does

- Uses the webcam with on-device pose estimation through MediaPipe Tasks Vision
- Counts push-up reps with a simple top-to-bottom-to-top state machine
- Scores form with explainable metrics:
  - elbow depth
  - hip sag
  - hip pike
  - hand stack / hands under shoulders when the view is reliable
- Supports four feedback modes:
  - control
  - visual
  - audio
  - combined
- Includes a guided **Coaching session** workflow that runs two 5-rep attempts with a visual/text coaching break in between
- Supports a local **Admin baseline** recorder for front, back, side, and top reference angles
- Uses a local **Admin PIN** (`180180`) to unlock baseline/admin controls on this device
- Includes a camera view switch:
  - **Head-on** is the recommended phone demo and the default on first load
  - **Side** is optional for a wider tripod setup
- Includes a calibration gate and countdown so push-up counting starts only after the person is framed and key points are visible; Ready usually lands around 75-85% on a real phone
- Keeps always-on logs for camera, cues, and reps
- Saves local score history by athlete name
- Exports the current session as CSV or JSON
- Includes an admin-style baseline capture tool for science-fair demos

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL in desktop Chrome or Safari. For iPhone camera testing, use the deployed HTTPS URL.

## iPhone Safari notes

- The app requests the camera with `playsInline`, `muted`, and `autoPlay` so it works in Safari's video pipeline.
- Camera access requires a secure context, which means HTTPS or localhost.
- On iPhone Safari, tap **Start camera** or **Enable sound** once to unlock audio cues. Mobile Safari blocks Web Audio and speech until a user gesture.
- For the default phone demo, use **Head-on**: place the phone low or on a floor stand in front of the athlete so wrists and feet stay visible.
- Switch to **Side** only if you have room for the classic side-profile setup.
- If camera permissions fail, switch to demo mode.

## Scoring model

The score is intentionally explainable for a science-fair demo.

- **Head-on mode** emphasizes elbow depth, elbow flare, hands under shoulders, head alignment, and framing. It does **not** pretend the side-view body line is accurate.
- **Side mode** keeps the classic hip sag / hip pike body-line cues for a tripod or wider setup.
- **Hands under shoulders** rewards a stacked wrist/shoulder position when the landmarks are visible enough.
- Control and Audio modes keep the skeleton hidden; Visual and Combined show the skeleton and live cues.
- **Rep counting is separate from form scoring**: any completed down-and-back-up cycle counts as a rep, while bad form lowers the score and adds coaching flags.

Rep counts happen only when the app sees a top position, a clear downward move, and a return to the top.

## Privacy

- Pose estimation runs on-device in the browser.
- The app does not upload camera frames or raw pose data.
- Session history is stored locally in the browser only.
- CSV and JSON exports are created on your device.

## Science-fair notes

This project is meant to demonstrate how on-device computer vision can provide immediate, explainable feedback for exercise technique.

Suggested demo flow:

1. Open the app on a phone.
2. Select the back camera if possible.
3. Start a set and keep the body in frame.
4. Show the live rep counter and metric bars.
5. Stop the set and compare the before/after scores.
6. Export the session for charts or a poster board.

### Coaching session workflow

- Choose **Coaching session** before starting the camera.
- Attempt 1 is exactly 5 push-ups.
- The app pauses for live visual coaching and a short text summary.
- Tap **Start attempt 2** for the second 5-rep set.
- The coaching card shows the attempt scores and the delta.

### Admin baseline

- Toggle **Admin mode** in the baseline card.
- Pick an angle: front, back, side, or top.
- Hold a good rep in frame and tap **Save current baseline**.
- The baseline is stored locally for this browser and used to bias grading until replaced.

### Google Sheet uploads

The app can upload one result row to the shared sheet after a coaching session or a saved free-practice result.

- Shared spreadsheet: `1xncvpxe7yjDadtHkOncha0sag4L26KIBQTw7TrnZ0es`
- Add `VITE_RESULTS_UPLOAD_URL` in Vercel to point at a Google Apps Script web app URL
- Local `.env.example` includes the variable name with a placeholder

The Apps Script code lives at `scripts/google-apps-script/Code.gs`.
Deploy it as a Web App:

- Execute as: Me
- Who has access: Anyone

The script appends a row with timestamp, volunteer name, mode, attempt scores, delta, reps, notes summary, and a short user-agent.

## Build

```bash
npm run build
```

Vercel should publish the `dist` folder as a static site.
