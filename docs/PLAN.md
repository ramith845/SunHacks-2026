# Pocket Film Set — Weekend Build Plan

**One-liner:** Scan a real place as a Gaussian splat, then use your phone as a handheld camera inside it. Every take you record becomes a storyboard panel and a line in the shot list.

**Demo shape:** phone in hand on stage, laptop on the projector showing the virtual camera's view of the splat, takes stacking up into a storyboard in real time.

---

## 1. Tech stack (verified Nov 14, 2026)

| Layer | Choice | Why / notes |
|---|---|---|
| Scan | **Scaniverse** (iPhone/Android, free) | Captures and trains splats on-device; exports **PLY** and **SPZ** (SPZ is Scaniverse's open compressed format, ~10x smaller). |
| Viewer | **Three.js + Spark** (`sparkjs.dev`, World Labs) | Spark is a Three.js splat renderer: `SplatMesh({ url })` added to a normal scene. Loads PLY, SPZ, SPLAT, KSPLAT, and works with WebXR. v2.x is current. Fallback: Three.js r186+ has a built-in WebGPU splat renderer. |
| Frontend | **Vite + TypeScript**, plain DOM UI (or React if the UI person prefers) | Fast dev server, easy HTTPS via `@vitejs/plugin-basic-ssl` (phone sensors need HTTPS). |
| Phone pose | **Tier A:** `DeviceOrientationEvent` → WebSocket (3DoF rotation; works on iPhone Safari after a permission tap). **Tier B:** WebXR `immersive-ar` on **Android Chrome** for full 6DoF position + rotation. | iPhone Safari does not reliably ship WebXR AR, so do not depend on it. If 6DoF on iPhone is a must, a ~100-line Swift ARKit app that streams `frame.camera.transform` over WebSocket is the stretch path. |
| Relay server | **Node + `ws`** (one file) | Pairs phone ↔ laptop by room code, forwards pose at 30–60 Hz, receives "take" events. |
| Storage | **MongoDB Atlas** (free M0) | One `takes` collection: camera path, lens, thumbnail, notes. |
| AI | **Gemini API** (current Flash model, multimodal) | Script → shot list; frame thumbnail → framing critique. |
| Export | Takes → **JSON camera path**, plus a Blender Python script that builds an animated camera | **Blender 5.3** (released Nov 10, 2026) imports PLY/SPZ splats natively, so the take can be re-rendered in Blender with the scan in place. Alternative add-on: KIRI Engine "3DGS Render". |
| Cloud GPU (optional) | **Vultr** GPU instance running `gsplat`/Nerfstudio `splatfacto` | Higher-quality splat from a video, if the on-phone scan looks rough. |
| Hosting | Vercel/Netlify for the web app, a small VM (Vultr) for the WebSocket relay, **GoDaddy** domain | One public URL with a QR code on the demo slide. |

---

## 2. Architecture

```
 ┌──────────── Phone (browser) ────────────┐          ┌──────── Laptop (browser, projected) ───────┐
 │ /camera page                            │          │ /director page                             │
 │  • reads orientation (Tier A)           │  pose    │  • Three.js scene + Spark SplatMesh        │
 │    or WebXR pose (Tier B)               │ ───────▶ │  • virtual camera driven by phone pose     │
 │  • big REC / STOP button, lens slider   │  events  │  • "monitor" view + overhead map           │
 │  • shows live thumbnail (optional)      │ ◀─────── │  • records takes: pose[] @30Hz + lens      │
 └─────────────────────────────────────────┘          │  • storyboard strip + shot list panel      │
                    ▲            WebSocket relay       └────────────┬───────────────────────────────┘
                    └────────────── (Node + ws) ◀──────────────────┘
                                                                    │ REST
                                            ┌───────────────────────┴──────────────┐
                                            │ API (same Node server)               │
                                            │  • POST/GET /takes → MongoDB Atlas    │
                                            │  • POST /shotlist, /critique → Gemini │
                                            │  • GET /takes/:id/blender.py          │
                                            └──────────────────────────────────────┘
```

**Pose message** (keep it tiny, one shape for both tiers):
```json
{ "t": 1731600000123, "q": [x, y, z, w], "p": [x, y, z] | null, "fov": 50 }
```

**Take document:**
```json
{ "_id": "...", "scene": "lobby.spz", "lensMm": 35, "durationMs": 6200,
  "poses": [{ "t": 0, "q": [...], "p": [...] }], "thumb": "data:image/jpeg;base64,...",
  "shotType": "MS", "note": "slow push toward the door", "critique": "..." }
```

**Key tricks**
- **Recentering:** a "Set mark" button on the phone zeroes yaw so the phone's forward matches the scene's chosen start position.
- **Tier A position:** rotation from the phone, translation from on-screen joystick or "dolly" buttons. Still feels like a real camera because handheld rotation is the part people notice.
- **Smoothing:** slerp toward the latest quaternion each frame; it hides network jitter.
- **Thumbnails:** `renderer.domElement.toDataURL('image/jpeg', 0.7)` on the take's middle frame (set `preserveDrawingBuffer: true`).

---

## 3. Weekend milestones (time-boxed)

Assume roughly 36 hours of working time. Each milestone ends with something demoable.

| # | When | Milestone | Done when |
|---|---|---|---|
| M0 | Fri, first 2 h | **Scan + skeleton.** Scan 2 locations in Scaniverse, export SPZ. Vite app renders the splat with orbit controls. | Splat visible in the laptop browser. |
| M1 | +4 h | **Phone drives camera (Tier A).** Relay server live, phone orientation moves the virtual camera. | Tilt the phone, the laptop view tilts. |
| M2 | +4 h | **Takes.** REC/STOP records pose arrays, playback, thumbnail, storyboard strip. | 3 takes recorded and replayed. |
| M3 | Sat morning, +4 h | **Persistence + shot list.** Takes saved to Atlas. Shot list table (shot #, type, lens, duration, note). | Refresh page, takes are still there. |
| M4 | Sat afternoon, +4 h | **Gemini.** Paste a script, get a suggested shot list; one-click framing critique on a thumbnail. | Script in, shot list out, on stage-ready UI. |
| M5 | Sat evening, +4 h | **Stretch: 6DoF + Blender.** Android WebXR pose (Tier B) and/or Blender export script. | Walk forward, camera walks forward; or a take renders in Blender. |
| M6 | Sun morning | **Freeze + polish.** Deploy, domain, QR code, offline fallback, demo rehearsal x3, Devpost write-up and video. | Full demo runs twice in a row without touching code. |

**Feature freeze: Sunday morning.** After that, only bug fixes and rehearsal.

---

## 4. Parallel work threads (independent modules)

Each module has a fixed interface, so they can be built in separate threads/branches and joined at M2.

| Thread | Owns | Interface it exposes | Can start with |
|---|---|---|---|
| **A. Viewer** | `apps/web/src/viewer/` — Three.js scene, Spark splat loading, camera rig, scene picker, recentering | `setCameraPose(q, p, fov)`, `captureThumb()` | A downloaded sample `.spz` |
| **B. Phone camera + relay** | `apps/web/src/phone/`, `server/relay.ts` — orientation/WebXR capture, REC button, room pairing | Emits pose messages (format above) and `{type:"rec"\|"stop"}` | Logging poses to console |
| **C. Takes + storyboard UI** | `apps/web/src/takes/` — recorder, playback, storyboard strip, shot-list table | `recordTake(poses)`, `TakeStore` (local first, then API) | Fake pose arrays |
| **D. Backend + AI** | `server/api.ts` — Atlas CRUD, Gemini shot list and critique endpoints | REST: `/takes`, `/shotlist`, `/critique` | curl + Postman |
| **E. Blender export (stretch)** | `tools/blender/take_to_camera.py` | Reads take JSON → keyframed camera, imports splat | A hand-written take JSON |
| **F. Scans + deploy (stretch)** | Scan quality, Vultr training run, hosting, domain | Hosted `.spz` URLs, public URL | Scaniverse on the phone |

Suggested repo layout:
```
apps/web/        Vite app (viewer, phone, takes)
server/          relay.ts + api.ts (one Node process)
tools/blender/   export script
scenes/          small .spz files (git LFS or hosted, not committed if large)
docs/            this plan, demo script
```

---

## 5. Demo script (≈3 minutes)

1. **Hook (20 s).** "Directors storyboard with stick figures. What if you could scout and shoot a location you're not standing in?" Show the splat of a real ASU spot on the projector.
2. **Pick up the camera (40 s).** Scan QR on the phone, tap "Set mark". Turn and tilt: the projected view follows. Change lens 24 → 85 mm.
3. **Shoot three takes (60 s).** Wide establishing, slow push-in, low-angle hero shot. Each take drops a panel into the storyboard strip.
4. **AI assist (30 s).** Paste a two-line script, Gemini proposes a shot list; click a panel, get a framing critique ("subject centered; try rule of thirds").
5. **Out to the pipeline (20 s).** Show the shot list table and the take opened in Blender with the same camera move (pre-rendered clip if time is short).
6. **Close (10 s).** "Pre-vis for anyone with a phone." URL + QR on screen for audience voting.

---

## 6. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Venue Wi-Fi blocks WebSockets or is slow | Laptop hotspot with the phone on it; relay running on `localhost` on the laptop. |
| iPhone orientation permission / HTTPS fails | Use `vite --host` with basic SSL, accept the cert on the phone once before the demo. Backup: Android phone. |
| WebXR 6DoF not ready | Ship Tier A (rotation + joystick dolly). It is the planned baseline, not a downgrade. |
| Splat too big / slow on stage laptop | Use SPZ, crop the scan in Scaniverse, cap splat count; keep a lighter backup scene. |
| Scan looks bad | Rescan in good light with slow overlapping passes; or the Vultr training run; or a public sample splat. |
| Gemini / Atlas outage or rate limit | Cache last good responses; takes fall back to `localStorage`. |
| Live demo dies entirely | Pre-recorded 60 s screen capture of the full flow, ready on the desktop. |
| Blender export eats time | It is stretch only. Pre-render one clip ahead of time. |

---

## 7. What Ramith needs

**Hardware:** iPhone (LiDAR model improves scans but is not required) for Scaniverse; ideally an Android phone with ARCore + Chrome for the 6DoF tier; laptop with a decent GPU, HDMI/USB-C adapter; phone mount or small gimbal (looks great on stage); power bank.

**Apps:** Scaniverse, Chrome, Node 20+, VS Code/Cursor, Blender 5.3 (stretch), Git.

**Accounts / keys:** GitHub, MongoDB Atlas (free M0), Google AI Studio (Gemini API key), Vultr (claim hackathon credits), GoDaddy (MLH free domain), Vercel or Netlify, Devpost.

**Before coding:** scan 2–3 locations around the venue and export SPZ + PLY.

---

## 8. Prize targeting

| Prize | Angle |
|---|---|
| **Best Overall** | Polished, novel, live on-stage demo with real hardware. Prioritize the demo flow over features. |
| **Audience Vote** | Visual "wow" on the projector and a QR so people can try being the camera themselves. |
| **JFFVentures Future of Work** | Pre-visualization without a crew, location trip, or 3D skills: remote location scouting and storyboarding for small creative teams and students. |
| **Gemini API** | Script → shot list, and multimodal framing critique on take thumbnails. Both visible in the demo. |
| **Vultr** | Train a higher-quality splat on a Vultr GPU instance, and host the relay/API there. |
| **MongoDB Atlas** | Takes, camera paths, and shot lists stored as documents; show the collection briefly. |
| **GoDaddy domain** | Register a short domain (e.g. a `pocketfilmset` name) and point it at the app. |

Also worth a look: **Best Gaming** (the "be the camera" interaction is game-like) and **Most Impractical** only if pitched with humor. Don't chase more than 3–4 sponsor prizes; each needs to be visible in the demo.

---

## Sources checked
- Spark renderer: https://sparkjs.dev/docs/overview/ and https://github.com/sparkjsdev/spark
- Three.js native WebGPU splat renderer (r186): https://radiancefields.com/three.js-merges-a-native-gaussian-splat-renderer-for-webgpu-in-r186
- Scaniverse SPZ format: https://scaniverse.com/news/spz-gaussian-splat-open-source-file-format
- Blender 5.3 native splats: https://app.cinevva.com/news/2026-09-16-blender-5-3-gaussian-splats
- KIRI 3DGS Render add-on: https://superhivemarket.com/products/3dgs-render-by-kiri-engine
