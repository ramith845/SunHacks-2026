// Laptop page: renders the splat scan, lets the phone drive the camera, records takes.
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import QRCode from "qrcode";
import { connect, LAN_IP, lensToFov, type Msg, type PoseMsg } from "./protocol";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const statusEl = $("status"), lensEl = $("lens"), strip = $("strip");

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0d);
scene.add(new SparkRenderer({ renderer }));

// rig = where the camera operator stands (position). camera = where they point (rotation).
const rig = new THREE.Group();
const camera = new THREE.PerspectiveCamera(lensToFov(35), 1, 0.01, 500);
rig.add(camera);
scene.add(rig);
rig.position.set(0, 0, 2.5);

// Sample splat from the Spark README until you drop in your own scan (or pass ?scene=/scenes/x.spz).
const DEFAULT_SCENE = "https://sparkjs.dev/assets/splats/butterfly.spz";
let splat: SplatMesh | null = null;
let sceneNote = "";
let flipped = true; // phone scans (Scaniverse etc.) are usually y-down; F toggles
function setSplat(opts: ConstructorParameters<typeof SplatMesh>[0]) {
  if (splat) {
    scene.remove(splat);
    splat.dispose();
  }
  splat = new SplatMesh(opts);
  applyFlip();
  scene.add(splat);
  splat.initialized.catch(() => {
    sceneNote = " · couldn't load scan, drag a .spz/.ply onto this window";
  });
}
function applyFlip() {
  splat?.quaternion.set(flipped ? 1 : 0, 0, 0, flipped ? 0 : 1);
}
const sceneParam = new URLSearchParams(location.search).get("scene");
setSplat({ url: sceneParam ?? DEFAULT_SCENE });

// Drag a scan onto the window to load it.
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", async (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files[0];
  if (!f) return;
  sceneNote = "";
  setSplat({ fileBytes: await f.arrayBuffer(), fileName: f.name });
});

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// ---------- camera input: phone (preferred) or mouse/keyboard (fallback) ----------
const targetQ = new THREE.Quaternion(); // where the camera should point
const yawOffset = new THREE.Quaternion(); // set by "Set mark" so phone-forward = scene-forward
const phoneQ = new THREE.Quaternion();
const move = new THREE.Vector3(); // right, up, forward
let lastPhone = 0;
let playing: { take: Take; t0: number } | null = null;
const UP = new THREE.Vector3(0, 1, 0);

function setMark() {
  // Cancel out the phone's current compass heading, keep its tilt.
  const e = new THREE.Euler().setFromQuaternion(phoneQ, "YXZ");
  yawOffset.setFromAxisAngle(UP, -e.y);
}

function onPose(m: PoseMsg) {
  const first = performance.now() - lastPhone > 2000;
  lastPhone = performance.now();
  phoneQ.fromArray(m.q);
  if (first) setMark();
  targetQ.copy(yawOffset).multiply(phoneQ);
  move.fromArray(m.move);
  setFov(m.fov);
}
function setFov(fov: number) {
  if (Math.abs(camera.fov - fov) < 0.01) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
  lensEl.textContent = `${Math.round(12 / Math.tan((fov * Math.PI) / 360))}mm`;
}

const send = connect((m: Msg) => {
  if (m.type === "pose") onPose(m);
  else if (m.type === "mark") setMark();
  else if (m.type === "rec") startRec();
  else if (m.type === "stop") stopRec();
});

// Mouse look + keyboard, so the app is usable (and demo-safe) with no phone at all.
const keys = new Set<string>();
const mouseEuler = new THREE.Euler(0, 0, 0, "YXZ");
const phoneLive = () => performance.now() - lastPhone < 1000;
canvas.addEventListener("pointermove", (e) => {
  if (!(e.buttons & 1) || phoneLive()) return;
  mouseEuler.y -= e.movementX * 0.004;
  mouseEuler.x = THREE.MathUtils.clamp(mouseEuler.x - e.movementY * 0.004, -1.5, 1.5);
  targetQ.setFromEuler(mouseEuler);
});
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === "r") recording ? stopRec() : startRec();
  if (k === "f") { flipped = !flipped; applyFlip(); }
  if (k === "h") document.body.classList.toggle("clean");
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
const axis = (pos: string, neg: string) => (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);

// ---------- takes ----------
type Frame = { t: number; p: number[]; q: number[]; fov: number };
type Take = { id: number; lensMm: number; durationMs: number; frames: Frame[]; thumb: string };
const KEY = "pocket-film-set.takes";
let takes: Take[] = JSON.parse(localStorage.getItem(KEY) ?? "[]");
let recording = false;
let recStart = 0;
let frames: Frame[] = [];
let thumb = "";

const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(takes)); } catch {}
};
const broadcast = () => send({ type: "status", recording, takes: takes.length });

function snapshot(): string {
  // Small JPEG of the current view for the storyboard panel.
  const c = document.createElement("canvas");
  c.width = 352;
  c.height = Math.round((352 * canvas.height) / canvas.width);
  c.getContext("2d")!.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}
function startRec() {
  if (recording) return;
  playing = null;
  recording = true;
  recStart = performance.now();
  frames = [];
  thumb = "";
  document.body.classList.add("recording");
  broadcast();
}
function stopRec() {
  if (!recording) return;
  recording = false;
  document.body.classList.remove("recording");
  if (frames.length > 5) {
    takes.push({
      id: Date.now(),
      lensMm: Math.round(12 / Math.tan((camera.fov * Math.PI) / 360)),
      durationMs: Math.round(frames[frames.length - 1].t),
      frames,
      thumb: thumb || snapshot(),
    });
    save();
    renderStrip();
  }
  broadcast();
}
function renderStrip() {
  strip.innerHTML = "";
  takes.forEach((t, i) => {
    const el = document.createElement("div");
    el.className = "panel" + (playing?.take === t ? " playing" : "");
    el.innerHTML = `<img src="${t.thumb}"><div class="meta"><b>Shot ${i + 1}</b><span>${t.lensMm}mm · ${(t.durationMs / 1000).toFixed(1)}s</span></div><button class="del" title="Delete">✕</button>`;
    el.onclick = () => { playing = { take: t, t0: performance.now() }; renderStrip(); };
    el.querySelector<HTMLButtonElement>(".del")!.onclick = (e) => {
      e.stopPropagation();
      takes = takes.filter((x) => x !== t);
      save();
      renderStrip();
      broadcast();
    };
    strip.append(el);
  });
  strip.scrollLeft = strip.scrollWidth;
}
renderStrip();

// ---------- main loop ----------
const timer = new THREE.Timer();
const dir = new THREE.Vector3();
const fa = new THREE.Quaternion(), fb = new THREE.Quaternion();
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  const now = performance.now();

  if (playing) {
    // Replay a take: find the two frames around the current time and blend.
    const { take, t0 } = playing;
    const t = now - t0;
    const f = take.frames;
    let i = f.findIndex((x) => x.t >= t);
    if (i < 0) { playing = null; renderStrip(); }
    else {
      i = Math.max(i, 1);
      const a = f[i - 1], b = f[i];
      const k = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t || 1), 0, 1);
      rig.position.fromArray(a.p).lerp(dir.fromArray(b.p), k);
      camera.quaternion.copy(fa.fromArray(a.q)).slerp(fb.fromArray(b.q), k);
      targetQ.copy(camera.quaternion);
      setFov(a.fov + (b.fov - a.fov) * k);
    }
  } else {
    // Smooth toward the latest target so network jitter doesn't show.
    camera.quaternion.slerp(targetQ, 1 - Math.exp(-dt * 18));
    if (!phoneLive()) move.set(axis("d", "a"), axis("e", "q"), axis("w", "s"));
    if (move.lengthSq() > 0) {
      const speed = 1.2 * dt; // metres per second
      rig.position.addScaledVector(dir.set(1, 0, 0).applyQuaternion(camera.quaternion), move.x * speed);
      rig.position.addScaledVector(dir.set(0, 0, -1).applyQuaternion(camera.quaternion), move.z * speed);
      rig.position.y += move.y * speed;
    }
  }

  renderer.render(scene, camera);

  if (recording) {
    const t = now - recStart;
    frames.push({ t, p: rig.position.toArray(), q: camera.quaternion.toArray(), fov: camera.fov });
    if (!thumb && t > 600) thumb = snapshot(); // panel image from early in the take
    statusEl.textContent = `REC ${(t / 1000).toFixed(1)}s`;
  } else if (playing) statusEl.textContent = "Playing take…";
  else statusEl.textContent = (phoneLive() ? "Phone connected" : "Waiting for phone… (mouse + WASD work too)") + sceneNote;
});

// ---------- pairing QR ----------
const host = location.hostname === "localhost" || location.hostname === "127.0.0.1" ? LAN_IP : location.hostname;
const phoneUrl = `https://${host}${location.port ? ":" + location.port : ""}/camera.html`;
$("url").textContent = phoneUrl;
QRCode.toCanvas($<HTMLCanvasElement>("qr"), phoneUrl, { width: 120, margin: 1 });
setInterval(broadcast, 2000);
