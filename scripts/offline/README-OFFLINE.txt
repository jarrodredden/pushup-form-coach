PUSH-UP FORM COACH - OFFLINE VERSION
=====================================

This folder is the whole app. It needs NO internet and NO website:
the pose-tracking AI, the voice clips, and everything else are inside
this folder. Use Google Chrome.


ON A SCHOOL CHROMEBOOK
----------------------
1. Get the zip onto the Chromebook
   - Easiest: put pushup-form-coach-offline.zip in Google Drive at home.
     On the Chromebook, open the Files app > Google Drive and drag the
     zip into "My files" > "Downloads".
   - Or copy it from a USB stick into "My files" > "Downloads".

2. Unzip it
   - In the Files app, double-click the zip. It opens like a drive.
   - Drag the "pushup-form-coach-offline" folder into
     "My files" > "Downloads".
   - Keep the folder together - index.html needs the "pose-data" and
     "voices" folders next to it.

3. Open the app
   - Open the copied folder and double-click index.html.
   - It opens in Chrome. The address bar starts with file://
   - If it opens in something else: right-click index.html >
     Open with > Chrome. Or drag index.html onto a Chrome window.

4. Tap "Start camera and sound", then tap "Allow" when Chrome asks to
   use the camera.

That's it. You'll see an "Offline" tag next to "Form Coach" at the top.


IF IT DOESN'T WORK
------------------
- "Blocked by your administrator" page when opening index.html:
  the school has blocked local files in Chrome. Ask IT to allow it,
  or use a laptop (below).
- No camera prompt, or "Camera access was blocked": the school may
  block the camera. Click the camera/lock icon on the left of the
  address bar and choose Allow. If it's greyed out, IT controls it.
- "The pose model failed to load": the folder is incomplete. Unzip
  the whole zip again and open index.html from the new copy.
- The app looks empty or never loads: make sure you opened it in
  Chrome (or Microsoft Edge), not a file preview.

Important: do NOT try to share this folder to Chromebooks from another
computer using an address like http://192.168.x.x:8000. Chrome only
allows the camera on https:// sites, localhost, or files opened
directly (file://). Every device should open its own copy of
index.html.


ON A LAPTOP (Windows, Mac, Linux)
---------------------------------
- Unzip, then double-click index.html so it opens in Chrome or Edge.
- If your laptop blocks local files, open a terminal in this folder,
  run:   python3 -m http.server 8000     (Windows: py -m http.server 8000)
  and open http://localhost:8000 in Chrome on that same laptop.


GOOD TO KNOW
------------
- Upload result sends one row to the class Google Sheet. It only works
  when the Chromebook has internet and Google isn't blocked. If it
  can't upload, tap "Save to this device" or "Export notes" - the
  session still counts.
- History, the admin unlock, and the "100 standards" are saved in
  Chrome on this device. They are separate from the website version,
  so an admin needs to set the 100 standards again here
  (Admin > PIN 180180 > 100 standards).
- Each coaching session: type a name, Start camera and sound, set 1
  (5 push-ups), coaching break, set 2 (5 push-ups), then results.
