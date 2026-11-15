# Pocket Film Set

Walk around with your iPhone and it becomes a real camera inside a Gaussian-splat scan of a real place.
Every take lands on a sequencer timeline as a shot. Gemini plans the shots from your script, critiques your framing and reviews the cut.

Plan: [docs/PLAN.md](docs/PLAN.md)

## Setup

```bash
npm install
cp .env.example .env     # then paste your AI Studio key into GEMINI_API_KEY
npm run dev
```

Open **https://localhost:5173** on the laptop and click past the self-signed certificate warning.

## Camera tracking

| Mode | What moves the camera | Needs |
|---|---|---|
| **AR 6DoF, free** (recommended) | You walk, turn and crouch with the iPhone; ARKit world tracking | **FREED Tracker** (free on the App Store) |
| AR 6DoF, paid | Same, via ZIG SIM's ARKit stream | ZIG SIM Pro ($3.99) |
| Gyro 3DoF | Turning the phone; pads to dolly | Just the browser (QR code in *Setup*) |
| Mouse | Drag to look, WASD/QE to dolly | Nothing |

iPhone browsers (Safari and Chrome both use WebKit) have no WebXR, so a web page can't get the phone's position. A tracking app runs ARKit and streams the phone's position + rotation to the laptop.

**FREED Tracker (free)**: it sends the standard FreeD camera-tracking packet over UDP.
- Receiver IP = the laptop's Wi-Fi IP (shown in *Setup*), port **40000**, then Start.
- The free tier sends for 3 minutes per Start; tap Start again when it stops.
- Press **C** (*Calibrate*) once and follow the five prompts (hold, tilt up, back, pan right, one step forward). This fixes rotation on the wrong axis and walking in the wrong direction, and is remembered.

**ZIG SIM Pro ($3.99)**: Protocol **UDP**, Format **JSON**, port **50000**, rate **60**, Sensor **ARKit** in **DEVICE** mode.

For both: press **M** (*Set mark*) on the laptop where the shot starts. *World scale* makes 1 m of walking cover more of the scene. Windows: allow Node through the firewall on **private** networks, or UDP won't arrive.

While the tracking app is open on the phone, record from the laptop: **R**, **PageDown** (a presentation clicker works) or the ● button.

## Making a sequence

1. **AI Studio** tab → paste a scene → *Generate shot plan*. Planned shots appear as striped clips.
2. Click a planned shot (the lens is dialled in for you), press **R**, do the move, press **R** again. The take fills that shot.
3. Drag clips to reorder, drag the clip edges to trim, double-click to play one. **Space** plays the whole sequence.
4. *AI critique* on a shot scores the framing and renames/sizes it; *Review my sequence* gives editor notes and missing coverage.
5. **Export** → shot list CSV, Blender cameras (.py: one keyframed camera per shot with timeline markers), or project JSON.

Keys: **R** record · **Space** play · **M** mark · **C** calibrate · **WASD QE** dolly · drag look · wheel or **[ ]** lens · **G** grid · **F** flip scene · **Del** delete shot.

## Scans
Export `.spz` or `.ply` from Scaniverse and drag it onto the monitor, or put it in `public/scenes/` and open `https://localhost:5173/?scene=/scenes/yourscan.spz`. Press **F** if it's upside down.

## Layout
```
index.html, src/director/   laptop app: main.ts (scene, camera, timeline, UI), shots.ts, ai.ts, export.ts
camera.html, src/phone.ts    iPhone web remote (gyro 3DoF)
server/plugin.ts             dev-server plugin: WebSocket relay, Gemini endpoints
server/freed.ts              FreeD D1 receiver (FREED Tracker, free)
server/zigsim.ts             ARKit pose from ZIG SIM Pro over UDP (JSON or OSC)
server/gemini.ts             Gemini calls + response schemas (key stays on the server)
```
