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
- Includes a camera view switch:
  - **Head-on** is the recommended phone demo and the default on first load
  - **Side** is optional for a wider tripod setup
- Keeps always-on logs for camera, cues, and reps
- Saves local score history by athlete name
- Exports the current session as CSV or JSON
- Includes a demo mode for quick testing without a camera

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL in desktop Chrome or Safari. For iPhone camera testing, use the deployed HTTPS URL.

## iPhone Safari notes

- The app requests the camera with `playsInline`, `muted`, and `autoPlay` so it works in Safari's video pipeline.
- Camera access requires a secure context, which means HTTPS or localhost.
- For the default phone demo, use **Head-on**: place the phone low or on a floor stand in front of the athlete so wrists and feet stay visible.
- Switch to **Side** only if you have room for the classic side-profile setup.
- If camera permissions fail, switch to demo mode.

## Scoring model

The score is intentionally explainable for a science-fair demo.

- **Head-on mode** emphasizes elbow depth, elbow flare, hands under shoulders, head alignment, and framing. It does **not** pretend the side-view body line is accurate.
- **Side mode** keeps the classic hip sag / hip pike body-line cues for a tripod or wider setup.
- **Hands under shoulders** rewards a stacked wrist/shoulder position when the landmarks are visible enough.

Rep counts happen only when the app sees a top position, a bottom position, and a return to the top.

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

## Build

```bash
npm run build
```

Vercel should publish the `dist` folder as a static site.
