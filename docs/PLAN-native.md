# Pocket Film Set — Native Desktop Plan (alternative to the web plan)

**Same product as `PLAN.md`:** scan a real place as a Gaussian splat with Scaniverse, hold the iPhone like a camera, see the virtual camera's view of the scan on the laptop/projector, and turn every take into a storyboard panel and a shot-list row. Only the desktop side changes: a native Windows app instead of a Vite + Three.js page.

**Your machine (checked Nov 14):** Windows 11 x64 laptop ("TUF"), with the Vulkan SDK, CLion, Rust (`.cargo`/`.rustup`) and NVIDIA Omniverse folders already in your home directory. That points to an NVIDIA GPU, which the recommended renderer requires. **Confirm the GPU model before committing** (Task Manager → Performance → GPU).

---

## 0. Recommendation in one paragraph

Build it in **C++20 + Vulkan by forking NVIDIA's open-source `vk_gaussian_splatting` viewer** (Apache 2.0). It already loads **both PLY and SPZ**, runs on Windows, builds with CMake, and has a desktop UI with panels, so day one starts with your Scaniverse scan already rendering at high frame rates. You add four things: a pose input (WebSocket client), a take recorder, a storyboard/shot-list panel, and Gemini/Atlas calls. **Keep the phone side and the small Node server from the web plan unchanged**: the iPhone still runs the Safari camera page, and the native app is just another client of the relay. That keeps the two plans swappable until late, and avoids building an iOS app on Windows (which needs a Mac and Xcode).

**If you don't need it to be C++:** Unity 6 with `UnityGaussianSplatting` 2.0 (C#, PLY + SPZ at runtime) is the fastest native route. **If walk-around tracking matters most:** Unreal 5.7 + the Unreal VCam iPhone app gives you full ARKit position tracking for free, but the stack is heavy and SPZ needs converting to PLY. Details in §1.

---

## 1. Native options evaluated (verified Nov 14, 2026)

| Option | Splat renderer (exists? formats) | Phone tracking | Weekend fit | Verdict |
|---|---|---|---|---|
| **A. C++ / Vulkan, fork `nvpro-samples/vk_gaussian_splatting`** | Yes. Standalone viewer app, Apache 2.0. Loads **3DGS PLY and SPZ**. Windows/Linux, CMake, Vulkan 1.4 SDK, MSVC 2019+, C++20. **NVIDIA GPU required.** Actively updated in 2026. | Rotation from Safari page via relay (same as web plan) | Good: rendering is done, you add features. Risk is learning the `nvpro_core2` framework. | **Recommended** (it is real C++, and you already have the Vulkan SDK) |
| B. C++ / OpenGL, fork `hyperlogic/splatapult` | Yes. MIT, CMake + vcpkg, loads **PLY only** (SPZ → convert first). Simpler code, OpenXR mode. | Same | Good, smaller codebase; slower renderer on big scans | **Fallback renderer** for option A |
| C. C++ / Vulkan from scratch + `nianticlabs/spz` | `spz` C++ lib (MIT) gives `loadSpz`/`saveSpz` and coordinate conversion, but **no renderer**. You'd write sort + rasterize yourself. | Same | Poor: the renderer alone eats the weekend | No |
| D. Unreal 5.7 + **YaGS** plugin (Yandex, Apache 2.0) | Yes. UE 5.5–5.7, Windows DX12/Vulkan, imports **PLY and SOG** (no SPZ). Archived "code drop", no ongoing development. (XVERSE XV3DGS is free but only UE 5.1–5.3.) | **Unreal VCam iOS app** (free, ARKit position + rotation, Take Recorder built in). Works on 5.6/5.7; a June–Aug 2026 forum thread reports it **broken on 5.8**. | Fast to a wow moment, but 50+ GB install, slow C++ rebuilds, fiddly UDP/Live Link networking on venue Wi-Fi. Much of the "camera" is Epic's, so less is yours to show judges. | Strong alternative if 6-DoF walking is the hero feature |
| E. Unity 6 + **`aras-p/UnityGaussianSplatting` 2.0.0** (Nov 3, 2026) | Yes. Renders **PLY and SPZ directly, no import step**, runtime load from path/URL. Unity 2022.3+ / 6.x, DX12/Vulkan (not DX11). Author says no further major development. | Same relay as web plan | Fastest native UI build. C#, not C++. | Best "native but pragmatic" pick |
| F. Godot 4.3+ + **GDGS** 3.1 (MIT) | Yes. PLY, compressed PLY, SPLAT, SOG (no SPZ). | Same | OK, but fewer ready-made UI/HTTP pieces than Unity | No |
| G. Rust + wgpu (e.g. Brush, bevy_gaussian_splatting) | Exist, PLY | Same | You have Rust installed, but adds a language and immature UI | No |

---

## 2. Stack (option A)

| Layer | Choice | Notes |
|---|---|---|
| Scan | **Scaniverse** on iPhone → export **SPZ** (and PLY as backup) | Same as web plan |
| Renderer + window | Fork of **`vk_gaussian_splatting`** (Vulkan 1.4, `nvpro_core2`) | Keep its loader, sorter and render passes. Strip the UI panels you don't need. Note the SPZ coordinate system on load (the `spz` lib defaults to RUB; set the unpack option if the scene comes in upside-down). |
| UI | **Dear ImGui** (bundled with `nvpro_core2`; confirm in M0) | Storyboard strip as an `ImGui::Image` grid, shot-list as an `ImGui::Table`, lens slider, REC indicator. |
| Networking | **IXWebSocket** (vcpkg) as a client of the existing Node relay | Receives pose JSON, sends nothing heavy. JSON via **nlohmann/json**. |
| HTTP (Gemini, Atlas) | Call the web plan's **Node API** (`/takes`, `/shotlist`, `/critique`) with **cpr** (libcurl wrapper) | Keeps the Gemini key on the server, and avoids the heavy `mongocxx` driver on Windows. (MongoDB's Atlas Data API was retired, so the native app should not talk to Atlas directly over HTTP.) |
| Images | **stb_image_write** for JPEG thumbnails and a storyboard contact-sheet PNG | Thumbnail = copy the rendered image to a host-visible buffer at the take's middle frame. |
| Build | CMake + **vcpkg manifest** (`vcpkg.json`), MSVC 2022, CLion or VS 2022 | Commit `CMakePresets.json` so everyone builds the same way. |
| Phone | **Unchanged** iPhone Safari `/camera` page from the web plan (DeviceOrientation + dolly buttons) | Hosted with real HTTPS (Vercel/Netlify), so no self-signed cert dance. |
| Relay + API | **Unchanged** Node `ws` + REST server from the web plan | Run on the laptop for the demo (`localhost`), and on Vultr for the public URL. |
| Offline phone fallback | **ZIG SIM** iOS app streaming orientation over **UDP (OSC or JSON)** straight to the app | No server, no HTTPS. Add a tiny UDP listener (`asio` or WinSock) behind the same `PoseSource` interface. ZIG SIM PRO ($3.99) has more sensors; check whether its ARKit mode gives device position before relying on it. |
| Export | Same take JSON → same Blender 5.3 script as the web plan | Blender 5.3 imports PLY/SPZ splats natively |

---

## 3. Architecture

```
 ┌──── iPhone ─────────────────┐   wss    ┌──── Node server (unchanged) ─────┐
 │ Safari /camera page         │ ───────▶ │ relay: room code, forwards pose  │
 │ DeviceOrientation, dolly,   │          │ api:  /takes → MongoDB Atlas     │
 │ REC/STOP, lens              │          │       /shotlist, /critique → Gemini│
 └─────────────────────────────┘          └───────┬───────────────▲──────────┘
        (fallback: ZIG SIM ── UDP ──┐             │ ws pose       │ HTTPS (cpr)
                                    ▼             ▼               │
 ┌──────────── Native Windows app (C++20, Vulkan) ───────────────────────────┐
 │ PoseSource  ── WebSocketPoseSource | UdpPoseSource | MousePoseSource      │
 │      │  latest {q,p,fov} (lock-free single slot)                          │
 │      ▼                                                                    │
 │ CameraRig  ── slerp smoothing, "set mark" yaw zero, dolly integration     │
 │      ▼                                                                    │
 │ SplatRenderer (vk_gaussian_splatting fork) ── PLY/SPZ scene, offscreen RT │
 │      ▼                                                    ▲               │
 │ TakeRecorder ── poses[] @30–60 Hz, thumbnail readback ────┘               │
 │      ▼                                                                    │
 │ StoryboardUI (ImGui) ── strip, shot list, playback, "critique" button     │
 │ ApiClient (cpr, worker thread) ── save takes, shot list, critique         │
 └───────────────────────────────────────────────────────────────────────────┘
```

**Wire formats are identical to `PLAN.md`** (pose message and take document), so the Node server, the phone page, Atlas data and the Blender script work with either desktop.

**Threads:** render thread (main), network thread (IXWebSocket runs its own), API worker thread with a job queue. Pose crosses threads through one atomic "latest pose" slot; never block the render loop on the network.

**Key tricks (native versions)**
- **Recentering:** same "Set mark" as the web plan; store the yaw offset in `CameraRig`.
- **Lens:** convert mm to vertical FOV with a 36×24 mm sensor (`fov = 2·atan(12/mm)`), so the shot list shows real lens numbers.
- **Thumbnails:** render the take's middle pose to an offscreen 512×288 target, `vkCmdCopyImageToBuffer`, write JPEG, upload base64.
- **Projector output:** borderless fullscreen "monitor" window on the second display, ImGui director panel on the laptop screen. This is a real advantage over the browser.

---

## 4. Weekend milestones (relative hours)

It is Saturday afternoon (Nov 14) as this is written, so the clock is shorter than the original plan assumed. Times are hours of work from the moment you start.

| # | Hours | Milestone | Done when |
|---|---|---|---|
| N0 | 0–2 | **Build the fork.** Clone `vk_gaussian_splatting` with submodules, build Release with VS 2022 + Vulkan SDK, open your Scaniverse SPZ. | Your scan renders in the native window. **Go/no-go gate:** if the build fails or the GPU isn't NVIDIA by hour 2, switch to splatapult (B) or go back to the web plan. |
| N1 | 2–5 | **Pose in.** `PoseSource` interface, mouse source, WebSocket source connected to the Node relay; `CameraRig` drives the render camera. | Tilt the iPhone, the native view tilts. |
| N2 | 5–9 | **Takes.** REC/STOP from the phone, pose recording, playback, thumbnail readback, storyboard strip in ImGui. | 3 takes recorded and replayed, panels visible. |
| N3 | 9–12 | **Shot list + persistence.** ImGui table; `ApiClient` saves/loads takes via the Node API (local JSON file fallback). | Restart the app, takes come back. |
| N4 | 12–15 | **Gemini.** Script text box → `/shotlist`; "Critique" on a panel → `/critique`. Projector fullscreen window. | Script in, shot list out, on the projector. |
| N5 | 15+ | **Stretch.** Blender export button, contact-sheet PNG, ZIG SIM UDP fallback. | A take opens in Blender. |
| Freeze | Sunday morning | **Release build, rehearse 3×,** record the backup video, Devpost write-up. | Demo runs twice in a row from a cold start. |

---

## 5. Parallel modules

Each has a fixed interface, so separate threads/branches can build them and join at N2.

| Module | Owns | Interface | Can start with |
|---|---|---|---|
| **A. Renderer fork** | `native/third_party/vk_gaussian_splatting` changes, scene loading, offscreen capture | `setCamera(q, p, fovY)`, `captureThumb() → jpeg bytes`, `loadScene(path)` | Your SPZ file |
| **B. Pose input** | `native/src/pose/` — `PoseSource`, WebSocket, UDP (ZIG SIM), mouse sources; `CameraRig` | `PoseSource::latest() → {t, q, p, fov}` | A console app printing poses |
| **C. Takes + storyboard UI** | `native/src/takes/`, `native/src/ui/` — recorder, playback, ImGui strip and table | `TakeRecorder::start/stop/sample()`, `TakeStore` | Fake pose arrays, placeholder thumbnails |
| **D. Server (shared with web plan)** | `server/` relay + API + Gemini + Atlas | REST `/takes`, `/shotlist`, `/critique`; ws relay | curl/Postman |
| **E. Phone page (shared with web plan)** | `apps/web/src/phone/` | Pose messages + `rec`/`stop` | Logging to console |
| **F. Blender export (stretch, shared)** | `tools/blender/take_to_camera.py` | Take JSON → keyframed camera | Hand-written take JSON |

Repo layout addition:
```
native/
  CMakeLists.txt  CMakePresets.json  vcpkg.json
  third_party/vk_gaussian_splatting/   (git submodule of your fork)
  src/pose/  src/rig/  src/takes/  src/ui/  src/api/  src/main.cpp
server/  apps/web/  tools/blender/   (from the web plan, unchanged)
```

---

## 6. Risks and fallbacks

| Risk | Fallback |
|---|---|
| `vk_gaussian_splatting` / `nvpro_core2` is hard to extend in a weekend | Hour-2 gate. Splatapult (OpenGL, PLY) is a smaller codebase; convert SPZ → PLY with the `spz` tool or Scaniverse's PLY export. |
| GPU isn't NVIDIA, or the demo machine changes | Splatapult (any OpenGL GPU) or the web plan. |
| Venue Wi-Fi blocks the relay | Relay on `localhost`, phone on the laptop hotspot; or ZIG SIM over UDP on the hotspot. |
| Windows Firewall blocks inbound UDP | Allow the app on first run (prompt appears), and test on the venue network early. |
| SPZ scene loads rotated/flipped | Set the coordinate system on load, or a "flip" toggle in the UI. |
| Gemini/Atlas slow or down | API calls are on a worker thread; local JSON cache for takes, cached last shot list. |
| Long C++ build breaks before the demo | Tag a known-good Release build and copy the `.exe` + DLLs to the desktop Sunday morning. |
| Live demo dies | Pre-recorded 60 s capture of the full flow. |

---

## 7. Native vs web, honestly

| | Web plan (Vite + Three.js + Spark) | Native plan (C++ / Vulkan fork) |
|---|---|---|
| **Time to first splat on screen** | Minutes (`npm create vite`, add Spark) | 1–2 h (clone, Vulkan SDK, CMake build), if it builds cleanly |
| **Time to full feature set** | Shorter. DOM UI, `fetch`, `toDataURL` thumbnails are one-liners | Longer. ImGui is quick, but thumbnails (GPU readback), HTTP and threading are all manual |
| **Iteration speed** | Hot reload | Rebuild + relaunch per change |
| **Performance** | Fine for phone-sized scans; may drop frames on a big scan at projector resolution | Better. Handles larger scans and 4K output, steadier frame times on stage |
| **Demo risk** | Browser + HTTPS + sensor permission + network | No browser on the desktop, but the build/driver/GPU dependency is real. Phone side is the same either way. |
| **Audience can try it** | Yes: QR → anyone's phone can drive or view | Phone part still works by QR; viewing needs the laptop |
| **Portability** | Any laptop, any GPU, hosted URL | Windows + NVIDIA only (option A) |
| **"Technical depth" to judges** | Good product story | Stronger systems story ("we extended a Vulkan splat renderer in C++") |
| **Prize fit** | Best Overall, Audience Vote (shareable URL), Gemini, Atlas, Vultr, GoDaddy (hosted site) | Best Overall, Gemini, Atlas, Vultr (server still hosted there). GoDaddy only for a landing/download page. Audience Vote slightly weaker without a public viewer. Best Gaming fits either. |

**Bottom line:** native buys performance, a projector-friendly multi-window setup and a deeper C++ story, at the cost of build time and a Windows/NVIDIA dependency. With the hackathon already into Saturday, the web plan is the lower-risk path to a polished demo. Native is the right call if the C++/graphics work is what you want to show, or if the web viewer struggles with your scan. Because the phone page, server and data formats are shared, you can **start the native fork in parallel and keep the web viewer as the fallback**, deciding at the hour-2 gate.

---

## Sources checked (Nov 14, 2026)
- vk_gaussian_splatting getting started (Windows/Linux, PLY + SPZ, Vulkan 1.4, NVIDIA GPU): https://nvpro-samples.github.io/vk_gaussian_splatting/getting-started/
- vkSplatting adds SPZ support (Apache 2.0): https://radiancefields.com/nvidia-s-vksplatting-adds-spz-support
- Splatapult (MIT, PLY, CMake/vcpkg, OpenXR): https://github.com/hyperlogic/splatapult
- Niantic `spz` C++ library (MIT, loadSpz/saveSpz, coordinate systems): https://github.com/nianticlabs/spz
- Unity Gaussian Splatting 2.0.0 loads PLY and SPZ directly: https://radiancefields.com/unity-gaussian-splatting-2-0-0-loads-ply-and-spz-directly
- YaGS for UE 5.5–5.7 (PLY/SOG): https://radiancefields.com/yags-yandex-open-sources-a-3dgs-plugin-for-unreal-engine-5.5–5.7
- XV3DGS UE plugin (UE 5.1–5.3, PLY): https://github.com/zenkibomb/XV3DGS-UEPlugin
- Unreal VCam iOS app (ARKit tracking, Take Recorder): https://apps.apple.com/us/app/id1547309663
- VCam broken on UE 5.8 report: https://forums.unrealengine.com/t/ue5-8-vcam-livelink-not-working/2732098
- GDGS for Godot (PLY/SPLAT/SOG): https://www.godotengine.org/asset-library/asset/5076
- ZIG SIM PRO (UDP/TCP, OSC/JSON): https://apps.apple.com/app/id1481556614
