// Laptop "director" app: splat scan + virtual camera (ARKit 6DoF / phone gyro / mouse), shot recording,
// sequencer timeline, Gemini (AI Studio) assistant and exports.
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import QRCode from "qrcode";
import { uploadScan, connect, LAN_IP, ZIG_PORT, FREED_PORT, lensToFov, fovToLens, type Msg, type FreeDMsg, type Vec3, type Quat } from "../protocol";
import { load, save, uid, shotLen, defaultType, classifyMove, sampleFrame, SHOT_TYPES, MOVES, type Shot, type Frame } from "./shots";
import { exportCsv, exportJson, exportBlender, timecode } from "./export";
import { aiStatus, aiPlan, aiCritique, aiReview } from "./ai";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const project = load();
let selectedId: string | null = null;
const persist = () => save(project);
const selected = () => project.shots.find((s) => s.id === selectedId) ?? null;

function toast(msg: string, ms = 3200) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout((toast as any).h);
  (toast as any).h = setTimeout(() => (t.hidden = true), ms);
}

// =====================================================================================
// Scene
// =====================================================================================
const monitor = $("monitor");
const canvas = $<HTMLCanvasElement>("view");
const overlay = $<HTMLCanvasElement>("overlay");
const octx = overlay.getContext("2d")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050506);
scene.add(new SparkRenderer({ renderer }));
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 500);
camera.position.set(0, 0, 2.5);
scene.add(camera);

// Sample splat from the Spark README until you drop in your own scan (or pass ?scene=/scenes/x.spz).
const DEFAULT_SCENE = "https://sparkjs.dev/assets/splats/butterfly.spz";
let splat: SplatMesh | null = null;
let sceneKey = "sample"; // which scan is loaded; flip is remembered per scan
let flipped = true; // phone scans are usually y-down; F toggles
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
};
function setSplat(opts: ConstructorParameters<typeof SplatMesh>[0], label: string) {
  if (splat) {
    scene.remove(splat);
    splat.dispose();
  }
  sceneKey = label;
  flipped = store.get(`pfs.flip.${sceneKey}`) !== "0";
  splat = new SplatMesh(opts);
  applyFlip();
  scene.add(splat);
  const mine = splat;
  splat.initialized
    .then(() => mine === splat && toast(`Scene: ${label}`))
    .catch(() => mine === splat && toast("Couldn't load that scan. Send one from the phone or drag a .spz / .ply onto the monitor.", 6000));
  renderScenes();
}
function applyFlip() {
  splat?.quaternion.set(flipped ? 1 : 0, 0, 0, flipped ? 0 : 1);
}
function toggleFlip() {
  flipped = !flipped;
  applyFlip();
  store.set(`pfs.flip.${sceneKey}`, flipped ? "1" : "0");
}
// Load a scan from the library and remember it for the next refresh.
function loadScene(url: string, name: string) {
  store.set("pfs.scene", JSON.stringify({ url, name }));
  setSplat({ url }, name);
  targetP.set(0, 0, 0); // scans are centred near where the scan started
  anchor.copy(targetP);
  if (arLive()) setMark(true);
}
type SceneInfo = { name: string; url: string; bytes: number };
let sceneList: SceneInfo[] = [];
async function refreshScenes() {
  sceneList = await fetch("/api/scenes").then((r) => r.json()).catch(() => []);
  renderScenes();
}
function renderScenes() {
  const el = document.getElementById("scene-list");
  if (!el) return;
  el.innerHTML = sceneList.length
    ? sceneList.map((s, i) => `<button class="scene${s.name === sceneKey ? " on" : ""}" data-i="${i}"><span>${esc(s.name)}</span><small>${(s.bytes / 1e6).toFixed(1)} MB</small></button>`).join("")
    : `<p class="muted">No scans yet. Send one from the phone (QR code above) or drag a file onto the monitor.</p>`;
  el.querySelectorAll<HTMLButtonElement>("[data-i]").forEach((b) => (b.onclick = () => { const s = sceneList[+b.dataset.i!]; loadScene(s.url, s.name); }));
}

monitor.addEventListener("dragover", (e) => (e.preventDefault(), ($("drop-hint").hidden = false)));
monitor.addEventListener("dragleave", () => ($("drop-hint").hidden = true));
monitor.addEventListener("drop", async (e) => {
  e.preventDefault();
  $("drop-hint").hidden = true;
  const f = e.dataTransfer?.files[0];
  if (!f) return;
  // Save it into the scan library so it survives a refresh, then load it.
  toast(`Saving ${f.name}…`, 60000);
  try {
    const r = await uploadScan(f, undefined, false);
    await refreshScenes();
    loadScene(r.url, r.name);
  } catch (err: any) {
    toast(err.message, 6000);
  }
});

// =====================================================================================
// Lens + frame lines. The lens describes the *framed* picture, not the whole monitor.
// =====================================================================================
let lensMm = 35;
let aspect = 1.778;
let showGrid = true;
type Rect = { x: number; y: number; w: number; h: number };
let frame: Rect = { x: 0, y: 0, w: 1, h: 1 };

function computeFrame() {
  const w = monitor.clientWidth, h = monitor.clientHeight;
  frame = w / h > aspect ? { w: h * aspect, h, x: (w - h * aspect) / 2, y: 0 } : { w, h: w / aspect, x: 0, y: (h - w / aspect) / 2 };
}
function applyLens() {
  const fov = lensToFov(lensMm);
  // Widen the render FOV so the frame-line area shows exactly this lens.
  const k = monitor.clientHeight / frame.h;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * k));
  camera.updateProjectionMatrix();
  $("t-lens-v").textContent = $("hud-lens").textContent = `${Math.round(lensMm)}mm`;
  $<HTMLInputElement>("t-lens").value = String(Math.round(lensMm));
}
function setLens(mm: number) {
  lensMm = THREE.MathUtils.clamp(mm, 12, 200);
  applyLens();
}
function resize() {
  const w = monitor.clientWidth, h = monitor.clientHeight;
  renderer.setSize(w, h, false);
  overlay.width = w * devicePixelRatio;
  overlay.height = h * devicePixelRatio;
  camera.aspect = w / h;
  computeFrame();
  applyLens();
}
new ResizeObserver(resize).observe(monitor);

function drawOverlay() {
  const d = devicePixelRatio, W = overlay.width, H = overlay.height;
  octx.setTransform(d, 0, 0, d, 0, 0);
  octx.clearRect(0, 0, W, H);
  const { x, y, w, h } = frame;
  octx.fillStyle = "rgba(0,0,0,0.78)";
  octx.fillRect(0, 0, W / d, y);
  octx.fillRect(0, y + h, W / d, H / d - y - h);
  octx.fillRect(0, y, x, h);
  octx.fillRect(x + w, y, W / d - x - w, h);
  octx.strokeStyle = "rgba(255,255,255,0.55)";
  octx.lineWidth = 1;
  octx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (showGrid) {
    octx.strokeStyle = "rgba(255,255,255,0.22)";
    octx.beginPath();
    for (const k of [1 / 3, 2 / 3]) {
      octx.moveTo(x + w * k, y); octx.lineTo(x + w * k, y + h);
      octx.moveTo(x, y + h * k); octx.lineTo(x + w, y + h * k);
    }
    octx.stroke();
    // title-safe 90%
    octx.setLineDash([4, 4]);
    octx.strokeRect(x + w * 0.05, y + h * 0.05, w * 0.9, h * 0.9);
    octx.setLineDash([]);
  }
  // centre cross
  octx.strokeStyle = "rgba(255,255,255,0.5)";
  octx.beginPath();
  octx.moveTo(x + w / 2 - 8, y + h / 2); octx.lineTo(x + w / 2 + 8, y + h / 2);
  octx.moveTo(x + w / 2, y + h / 2 - 8); octx.lineTo(x + w / 2, y + h / 2 + 8);
  octx.stroke();
}

// =====================================================================================
// Camera input. Priority: ARKit 6DoF (ZIG SIM) > phone gyro web page > mouse/keyboard.
// =====================================================================================
const UP = new THREE.Vector3(0, 1, 0);
const yawOf = (q: THREE.Quaternion) => new THREE.Euler().setFromQuaternion(q, "YXZ").y;
const targetQ = camera.quaternion.clone();
const targetP = camera.position.clone();

// AR state
let arLast = 0, scale = 1, rollDeg = 0;
const arP = new THREE.Vector3(), arQ = new THREE.Quaternion();
const arOrigin = new THREE.Vector3(), anchor = new THREE.Vector3();
const arAlign = new THREE.Quaternion();
const rollQ = new THREE.Quaternion();
// gyro state
let gyroLast = 0;
const gyroQ = new THREE.Quaternion(), gyroAlign = new THREE.Quaternion();
const gyroMove = new THREE.Vector3();

const now = () => performance.now();
const arLive = () => now() - arLast < 600;
const gyroLive = () => now() - gyroLast < 1000;
const source = () => (arLive() ? `AR 6DoF · ${arSrc}` : gyroLive() ? "GYRO 3DoF" : "MOUSE");
const sourceHud = () => (posFrozen() ? `${arSrc} · ROTATION ONLY (no position)` : source());

function setMark(silent = false, yaw?: number) {
  // Whatever the camera shows right now becomes the start of the real-world move.
  const camYaw = yaw ?? yawOf(camera.quaternion);
  if (arLive()) {
    arOrigin.copy(arP);
    anchor.copy(camera.position);
    const devQ = arQ.clone().multiply(rollQ);
    arAlign.setFromAxisAngle(UP, camYaw - yawOf(devQ));
  }
  if (gyroLive()) gyroAlign.setFromAxisAngle(UP, camYaw - yawOf(gyroQ));
  if (!silent) toast("Mark set: this is where your move starts");
}

// ---- rotation calibration: learns how the phone's axes map to the camera's (two gestures) ----
const calQ: Record<string, THREE.Quaternion> = {};
try {
  for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem("pfs.cal") ?? "{}"))) calQ[k] = new THREE.Quaternion().fromArray(v as number[]);
} catch {}
const calOf = (src: string) => calQ[src] ?? new THREE.Quaternion();
// Yaw offset between the tracker's position axes and its (calibrated) rotation axes, learned from one step forward.
const posFix: Record<string, THREE.Quaternion> = {};
try {
  for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem("pfs.calpos") ?? "{}"))) posFix[k] = new THREE.Quaternion().fromArray(v as number[]);
} catch {}
const rawP = new THREE.Vector3(); // latest uncorrected position of the AR source
const saveCalibration = () => {
  const dump = (o: Record<string, THREE.Quaternion>) => JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.toArray()])));
  try {
    localStorage.setItem("pfs.cal", dump(calQ));
    localStorage.setItem("pfs.calpos", dump(posFix));
  } catch {}
};
const rawQ = new THREE.Quaternion(); // latest uncalibrated orientation of the active source
let rawSrc = "";

// ---- diagnostics: is position actually arriving and changing? ----
const diag = { packets: 0, pps: 0, lastTick: 0, lastMove: 0, turned: 0, lastQ: new THREE.Quaternion(), lastP: new THREE.Vector3(), warned: false, freed: null as FreeDMsg | null };
const posFrozen = () => arLive() && now() - diag.lastMove > 4000 && diag.turned > 40;
function trackDiag(p: Vec3, q: Quat) {
  diag.packets++;
  const t = now();
  if (t - diag.lastTick > 1000) (diag.pps = Math.round((diag.packets * 1000) / (t - diag.lastTick))), (diag.packets = 0), (diag.lastTick = t);
  const P = new THREE.Vector3().fromArray(p), Q = new THREE.Quaternion().fromArray(q);
  if (P.distanceTo(diag.lastP) > 0.002) (diag.lastMove = t), diag.lastP.copy(P), (diag.turned = 0), (diag.warned = false);
  const a = THREE.MathUtils.radToDeg(Q.angleTo(diag.lastQ));
  if (a > 1) (diag.turned += a), diag.lastQ.copy(Q);
  if (posFrozen() && !diag.warned) {
    diag.warned = true;
    toast("Rotation is arriving but position isn't changing. In FREED Tracker: allow Camera access, turn on X/Y/Z output, release Hold Position. See Setup.", 12000);
  }
}

let arSrc = "";
function onAr(p: Vec3, qRaw: Quat, src: string) {
  trackDiag(p, qRaw);
  rawQ.fromArray(qRaw);
  rawSrc = src;
  const q = rawQ.clone().multiply(calOf(src)).toArray() as Quat;
  const first = now() - arLast > 2000;
  arLast = now();
  arSrc = src;
  rawP.fromArray(p);
  arP.copy(rawP);
  if (posFix[src]) arP.applyQuaternion(posFix[src]);
  arQ.fromArray(q);
  if (first) (setMark(true), toast(`${src} tracking connected: walk to move the camera`));
  targetP.copy(arP).sub(arOrigin).applyQuaternion(arAlign).multiplyScalar(scale).add(anchor);
  targetQ.copy(arAlign).multiply(arQ).multiply(rollQ);
}

type CalStep = { text: string; test: (ang: number) => boolean };
const CAL_STEPS: CalStep[] = [
  { text: "Point the phone straight at the screen and hold still", test: () => true },
  { text: "Tilt the phone UP about 45° (top edge toward the ceiling) and hold", test: (a) => a > 30 },
  { text: "Point it back at the screen and hold", test: (a) => a < 12 },
  { text: "Turn the phone RIGHT about 45° (like panning) and hold", test: (a) => a > 30 },
  { text: "Point at the screen again, take one big step TOWARD it, and hold", test: () => !!cal && rawP.distanceTo(cal.p0) > 0.35 },
];
let cal: { step: number; ref: THREE.Quaternion; q0: THREE.Quaternion; tiltAxis?: THREE.Vector3; stableSince: number; last: THREE.Quaternion; p0: THREE.Vector3; lastP: THREE.Vector3; stepStart: number } | null = null;
function startCalibration() {
  if (!arLive() && !gyroLive()) return toast("Start your tracking app (or the phone page) first, then calibrate");
  calYaw = yawOf(camera.quaternion);
  calPos.copy(camera.position);
  neutral = null;
  cal = { step: 0, ref: rawQ.clone(), q0: rawQ.clone(), stableSince: now(), last: rawQ.clone(), p0: rawP.clone(), lastP: rawP.clone(), stepStart: now() };
  $("cal").hidden = false;
}
const localAxis = (from: THREE.Quaternion, to: THREE.Quaternion) => {
  const d = from.clone().invert().multiply(to);
  if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w);
  return new THREE.Vector3(d.x, d.y, d.z).normalize();
};
const angDeg = (a: THREE.Quaternion, b: THREE.Quaternion) => THREE.MathUtils.radToDeg(a.angleTo(b));
let calYaw = 0;
const calPos = new THREE.Vector3();
let neutral: THREE.Quaternion | null = null; // after calibrating: auto-mark when the phone points back at the screen
function tickCalibration() {
  if (!cal) {
    if (neutral && angDeg(rawQ, neutral) < 8) {
      neutral = null;
      setMark(true, calYaw); // face the same way the camera did before calibrating
      toast("Calibrated and marked. Walk to move the camera.");
    }
    return;
  }
  const q = rawQ.clone();
  // "Holding still" = moved less than 2 degrees over the last 0.6 s.
  if (angDeg(q, cal.last) > 2) (cal.stableSince = now()), cal.last.copy(q);
  if (rawP.distanceTo(cal.lastP) > 0.03) (cal.stableSince = now()), cal.lastP.copy(rawP);
  const still = now() - cal.stableSince > 600;
  const step = CAL_STEPS[cal.step];
  const ang = angDeg(cal.ref, q);
  const total = arLive() ? 5 : 4;
  $("cal-text").textContent = `${cal.step + 1}/${total} · ${step.text}`;
  $("cal-ang").textContent = cal.step === 0 ? (still ? "✓" : "…") : cal.step === 4 ? `${rawP.distanceTo(cal.p0).toFixed(2)} m` : `${ang.toFixed(0)}°`;
  $("cal-cancel").textContent = cal.step === 4 ? "Skip" : "Cancel";
  $("cal-hint").hidden = !(cal.step === 4 && now() - cal.stepStart > 7000 && rawP.distanceTo(cal.p0) < 0.05);
  if (!still || !step.test(ang)) return;
  if (cal.step === 0) cal.q0.copy(q), cal.ref.copy(q);
  if (cal.step === 1) cal.tiltAxis = localAxis(cal.q0, q);
  if (cal.step === 2) cal.ref.copy(q), cal.q0.copy(q);
  if (cal.step === 3) {
    // Tilt up = +rotation about camera X. Pan right = -rotation about camera Y.
    const X = cal.tiltAxis!;
    const Y = localAxis(cal.q0, q).negate();
    Y.addScaledVector(X, -Y.dot(X)).normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    const R = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    calQ[rawSrc] = R;
    saveCalibration();
    if (!arLive()) return finishCalibration(); // gyro page has no position to calibrate
    cal.p0.copy(rawP);
  }
  if (cal.step === 4) {
    // The step you just took should move the camera the way the (calibrated) phone is facing.
    const d = rawP.clone().sub(cal.p0);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(rawQ.clone().multiply(calOf(rawSrc)));
    const vertical = Math.abs(d.y) > Math.hypot(d.x, d.z);
    if (!vertical) {
      posFix[rawSrc] = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(fwd.x, fwd.z) - Math.atan2(d.x, d.z));
      saveCalibration();
    }
    arP.copy(rawP);
    if (posFix[rawSrc]) arP.applyQuaternion(posFix[rawSrc]);
    arQ.copy(rawQ).multiply(calOf(rawSrc));
    return finishCalibration(true, vertical ? "That step looked vertical: change 'FreeD axes' in Setup, then calibrate again" : undefined);
  }
  cal.step++;
  cal.stableSince = cal.stepStart = now();
}
function finishCalibration(markNow = false, warn?: string) {
  if (!cal) return;
  $("cal").hidden = true;
  if (markNow) {
    camera.position.copy(calPos); // calibration moves shouldn't leave the camera somewhere odd
    targetP.copy(calPos);
    setMark(true, calYaw);
    toast(warn ?? "Calibrated and marked. Walk to move the camera.", warn ? 8000 : 5000);
  } else {
    neutral = cal.q0.clone();
    toast("Rotation calibrated. Point the phone back at the screen.", 6000);
  }
  cal = null;
}
function resetCalibration() {
  for (const k of Object.keys(calQ)) delete calQ[k];
  for (const k of Object.keys(posFix)) delete posFix[k];
  try { localStorage.removeItem("pfs.cal"); localStorage.removeItem("pfs.calpos"); } catch {}
  toast("Rotation calibration cleared");
}

// FreeD apps disagree on axes, so Setup lets you pick the convention and flip signs.
type FreeDCal = { axes: "xyz-zup" | "xyz-yup" | "unreal"; flipPan: boolean; flipTilt: boolean; unit: number };
const freedCal: FreeDCal = (() => {
  try {
    return { axes: "xyz-zup", flipPan: false, flipTilt: false, unit: 1, ...JSON.parse(localStorage.getItem("pfs.freed") ?? "{}") };
  } catch {
    return { axes: "xyz-zup", flipPan: false, flipTilt: false, unit: 1 };
  }
})();
const d2r = THREE.MathUtils.degToRad;
const fq = new THREE.Quaternion(), fe = new THREE.Euler();
function freedToPose(m: FreeDMsg): [Vec3, Quat] {
  // three.js: x right, y up, -z forward. Pan right is negative yaw here.
  const u = freedCal.unit; // 1 = standard FreeD (1/64 mm); 10 or 1000 if the app packs cm or m instead
  const x = m.x * u, y = m.y * u, z = m.z * u;
  const p: Vec3 =
    freedCal.axes === "xyz-yup" ? [x, y, z] // ARKit-style already
    : freedCal.axes === "unreal" ? [y, z, -x] // X forward, Y right, Z up
    : [x, z, -y]; // X right, Y forward, Z up (FreeD default)
  const pan = (freedCal.flipPan ? 1 : -1) * m.pan;
  const tilt = (freedCal.flipTilt ? -1 : 1) * m.tilt;
  fe.set(d2r(tilt), d2r(pan), d2r(m.roll), "YXZ");
  fq.setFromEuler(fe);
  return [p, [fq.x, fq.y, fq.z, fq.w]];
}

function onMsg(m: Msg) {
  if (m.type === "arpose") onAr(m.p, m.q, "ZIG SIM");
  else if (m.type === "freed") (diag.freed = m), onAr(...freedToPose(m), "FreeD");
  else if (m.type === "pose") {
    const first = now() - gyroLast > 2000;
    gyroLast = now();
    if (!arLive()) (rawQ.fromArray(m.q), (rawSrc = "GYRO"));
    gyroQ.fromArray(m.q).multiply(calOf("GYRO"));
    if (first) setMark(true);
    if (!arLive()) targetQ.copy(gyroAlign).multiply(gyroQ);
    gyroMove.fromArray(m.move);
    if (!arLive()) setLens(fovToLens(m.fov));
  } else if (m.type === "scene") refreshScenes().then(() => loadScene(m.url, m.name));
  else if (m.type === "mark") setMark();
  else if (m.type === "rec") startRec();
  else if (m.type === "stop") stopRec();
}
const send = connect(onMsg);

// Mouse look + keyboard dolly (always available; on top of AR it nudges the anchor).
const keys = new Set<string>();
canvas.addEventListener("pointermove", (e) => {
  if (!(e.buttons & 1) || arLive() || gyroLive() || playing) return;
  const eu = new THREE.Euler().setFromQuaternion(targetQ, "YXZ");
  eu.y -= e.movementX * 0.004;
  eu.x = THREE.MathUtils.clamp(eu.x - e.movementY * 0.004, -1.5, 1.5);
  eu.z = 0;
  targetQ.setFromEuler(eu);
});
canvas.addEventListener("wheel", (e) => (e.preventDefault(), setLens(lensMm * (e.deltaY > 0 ? 0.95 : 1.05))), { passive: false });
const axis = (a: string, b: string) => (keys.has(a) ? 1 : 0) - (keys.has(b) ? 1 : 0);

// =====================================================================================
// Recording
// =====================================================================================
let recording = false, recStart = 0;
let frames: Frame[] = [];
let snaps: { t: number; img: string }[] = [];
let recInto: Shot | null = null;

function snapshot(): string {
  const d = renderer.getPixelRatio();
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = Math.round(320 / aspect);
  c.getContext("2d")!.drawImage(canvas, frame.x * d, frame.y * d, frame.w * d, frame.h * d, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.72);
}
function startRec() {
  if (recording) return;
  stopPlayback();
  recording = true;
  recStart = now();
  frames = [];
  snaps = [];
  const s = selected();
  recInto = s && !s.frames.length ? s : null; // fill a planned shot if one is selected
  document.body.classList.add("recording");
  broadcast();
}
function stopRec() {
  if (!recording) return;
  recording = false;
  document.body.classList.remove("recording");
  if (frames.length >= 2 && frames[frames.length - 1].t > 300) {
    const dur = Math.round(frames[frames.length - 1].t);
    const mid = snaps.length ? snaps[Math.floor(snaps.length / 2)].img : snapshot();
    const base: Shot = recInto ?? {
      id: uid(), name: "", type: defaultType(lensMm), movement: "Static", lensMm: 0, frames: [],
      durationMs: 0, inMs: 0, outMs: 0, thumb: "", notes: "",
    };
    Object.assign(base, { frames, durationMs: dur, inMs: 0, outMs: dur, thumb: mid, lensMm: Math.round(lensMm), tracking: source() });
    base.movement = classifyMove(frames, 0, dur);
    if (!recInto) {
      base.name = `${base.type} ${base.movement.toLowerCase()}`;
      const i = project.shots.findIndex((s) => s.id === selectedId);
      project.shots.splice(i >= 0 ? i + 1 : project.shots.length, 0, base);
    }
    selectedId = base.id;
    persist();
    renderTimeline();
    renderInspector();
    toast(`Recorded ${(dur / 1000).toFixed(1)}s · ${base.movement} · ${base.tracking}`);
    // Auto-select the next planned shot so you can keep shooting down the list.
  }
  recInto = null;
  broadcast();
}
const broadcast = () => send({ type: "status", recording, takes: project.shots.filter((s) => s.frames.length).length });
setInterval(broadcast, 2000);

// =====================================================================================
// Playback (single shot or whole sequence)
// =====================================================================================
let playing: { list: Shot[]; idx: number; t0: number } | null = null;
const pScratch = new THREE.Vector3(), qScratch = new THREE.Quaternion();

function playShots(list: Shot[]) {
  list = list.filter((s) => s.frames.length > 1);
  if (!list.length) return toast("Nothing recorded yet");
  if (recording) stopRec();
  playing = { list, idx: 0, t0: now() };
  document.body.classList.add("playing");
  $("t-play").textContent = "❚❚";
}
function stopPlayback() {
  if (!playing) return;
  playing = null;
  document.body.classList.remove("playing");
  $("t-play").textContent = "▶";
}
const togglePlay = () => (playing ? stopPlayback() : playShots(project.shots));

// =====================================================================================
// Timeline
// =====================================================================================
const track = $("track"), ruler = $("ruler"), playhead = $("playhead");
let pxPerSec = 70;
const GAP = 4, PAD = 12;
let clipX: Record<string, number> = {};
const lenOf = (s: Shot) => (s.frames.length ? shotLen(s) : s.durationMs);

function renderTimeline() {
  track.innerHTML = "";
  clipX = {};
  let x = PAD, total = 0;
  project.shots.forEach((s, i) => {
    const w = Math.max(48, (lenOf(s) / 1000) * pxPerSec);
    clipX[s.id] = x;
    const el = document.createElement("div");
    el.className = "clip" + (s.id === selectedId ? " sel" : "") + (s.frames.length ? "" : " planned");
    el.style.left = `${x}px`;
    el.style.width = `${w}px`;
    el.dataset.id = s.id;
    el.innerHTML = s.frames.length
      ? `<div class="img" style="background-image:url(${s.thumb})"></div><div class="cap"><b>${i + 1}</b><span>${esc(s.name)}</span></div>`
      : `<div class="ptext">${esc(s.name)}<br><span class="muted">${esc(s.planned ?? "")}</span></div><div class="cap"><b>${i + 1}</b><span>planned · ${s.lensMm}mm</span></div>`;
    el.insertAdjacentHTML("beforeend", `<span class="badge">${s.type}</span>${s.critique ? `<span class="ai">✦${s.critique.score}</span>` : ""}`);
    if (s.frames.length) el.insertAdjacentHTML("beforeend", `<div class="handle l"></div><div class="handle r"></div>`);
    track.append(el);
    x += w + GAP;
    total += lenOf(s);
  });
  if (!project.shots.length) track.innerHTML = `<div class="empty-track">No shots yet. Press <kbd>R</kbd> to record, or generate a shot plan in AI Studio.</div>`;
  const width = Math.max(x + 200, (document.getElementById("timeline")!.clientWidth));
  track.style.width = ruler.style.width = `${width}px`;
  ruler.innerHTML = "";
  const step = pxPerSec < 40 ? 5 : pxPerSec < 90 ? 2 : 1;
  for (let t = 0; PAD + (t * pxPerSec) < width; t += step) {
    ruler.insertAdjacentHTML("beforeend", `<div class="tick" style="left:${PAD + t * pxPerSec}px">${t}s</div>`);
  }
  const recorded = project.shots.filter((s) => s.frames.length).length;
  $("seq-info").textContent = `${project.shots.length} shot${project.shots.length === 1 ? "" : "s"} · ${recorded} recorded · ${timecode(total)}`;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// select / drag-reorder / trim
track.addEventListener("pointerdown", (e) => {
  const target = e.target as HTMLElement;
  const el = target.closest<HTMLElement>(".clip");
  if (!el) return;
  const shot = project.shots.find((s) => s.id === el.dataset.id)!;
  const startX = e.clientX;
  const handle = target.classList.contains("handle") ? (target.classList.contains("l") ? "l" : "r") : null;
  const orig = { in: shot.inMs, out: shot.outMs };
  let dragging = false;
  el.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - startX;
    if (handle) {
      const dMs = (dx / pxPerSec) * 1000;
      if (handle === "l") shot.inMs = THREE.MathUtils.clamp(orig.in + dMs, 0, shot.outMs - 300);
      else shot.outMs = THREE.MathUtils.clamp(orig.out + dMs, shot.inMs + 300, shot.durationMs);
      el.style.width = `${Math.max(48, (shotLen(shot) / 1000) * pxPerSec)}px`;
      return;
    }
    if (!dragging && Math.abs(dx) > 6) (dragging = true), el.classList.add("dragging");
    if (dragging) el.style.transform = `translateX(${dx}px)`;
  };
  const up = (ev: PointerEvent) => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    if (handle) {
      shot.movement = classifyMove(shot.frames, shot.inMs, shot.outMs);
      persist();
    } else if (dragging) {
      const x = clipX[shot.id] + (ev.clientX - startX);
      const others = project.shots.filter((s) => s !== shot);
      let idx = others.findIndex((s) => x < clipX[s.id]);
      if (idx < 0) idx = others.length;
      others.splice(idx, 0, shot);
      project.shots = others;
      persist();
    } else select(shot.id);
    renderTimeline();
    renderInspector();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
});
track.addEventListener("dblclick", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(".clip");
  const s = el && project.shots.find((x) => x.id === el.dataset.id);
  if (s) playShots([s]);
});

function select(id: string | null) {
  selectedId = id;
  const s = selected();
  if (s && !s.frames.length) {
    setLens(s.lensMm); // planned shot: dial in the planned lens
    toast(`Ready for "${s.name}": ${s.type}, ${s.movement}, ${s.lensMm}mm. Press R to shoot it.`, 4500);
  } else if (s) {
    // Jump the camera to the first frame so you can re-shoot from the same mark.
    const f = s.frames.find((x) => x.t >= s.inMs) ?? s.frames[0];
    targetP.fromArray(f.p);
    targetQ.fromArray(f.q);
    camera.position.copy(targetP);
    camera.quaternion.copy(targetQ);
    anchor.copy(targetP);
    setLens(fovToLens(f.fov));
    if (arLive()) setMark(true);
  }
  renderTimeline();
  renderInspector();
}

// =====================================================================================
// Inspector
// =====================================================================================
const fill = (sel: HTMLSelectElement, opts: string[]) => (sel.innerHTML = opts.map((o) => `<option>${o}</option>`).join(""));
fill($("insp-type"), SHOT_TYPES);
fill($("insp-move"), MOVES);

function renderInspector() {
  const s = selected();
  $("insp-empty").hidden = !!s;
  $("insp").hidden = !s;
  if (!s) return;
  $<HTMLImageElement>("insp-thumb").src = s.thumb || "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
  $<HTMLInputElement>("insp-name").value = s.name;
  $<HTMLSelectElement>("insp-type").value = s.type;
  $<HTMLSelectElement>("insp-move").value = s.movement;
  $<HTMLInputElement>("insp-lens").value = `${s.lensMm}mm`;
  $<HTMLInputElement>("insp-len").value = `${(lenOf(s) / 1000).toFixed(2)}s`;
  $<HTMLTextAreaElement>("insp-notes").value = s.notes;
  const has = s.frames.length > 0;
  $("insp-trim").hidden = !has;
  $("insp-play").hidden = !has;
  $("insp-crit").hidden = !has;
  for (const id of ["insp-in", "insp-out"]) {
    const r = $<HTMLInputElement>(id);
    r.max = String(s.durationMs);
  }
  $<HTMLInputElement>("insp-in").value = String(s.inMs);
  $<HTMLInputElement>("insp-out").value = String(s.outMs);
  $("insp-plan").hidden = !s.planned;
  $("insp-plan").textContent = s.planned ? `Plan: ${s.planned}` : "";
  renderCritique(s);
}
function renderCritique(s: Shot) {
  const out = $("insp-crit-out");
  out.hidden = !s.critique;
  if (!s.critique) return;
  const c = s.critique;
  out.innerHTML = `<div><span class="score">${c.score}/10</span> ${esc(c.summary)}</div><ul>${c.suggestions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
}
const bindField = (id: string, key: "name" | "type" | "movement" | "notes") =>
  $(id).addEventListener("input", (e) => {
    const s = selected();
    if (!s) return;
    s[key] = (e.target as HTMLInputElement).value;
    persist();
    renderTimeline();
  });
bindField("insp-name", "name");
bindField("insp-type", "type");
bindField("insp-move", "movement");
bindField("insp-notes", "notes");
for (const [id, key] of [["insp-in", "inMs"], ["insp-out", "outMs"]] as const) {
  $(id).addEventListener("input", (e) => {
    const s = selected();
    if (!s) return;
    const v = +(e.target as HTMLInputElement).value;
    if (key === "inMs") s.inMs = Math.min(v, s.outMs - 300);
    else s.outMs = Math.max(v, s.inMs + 300);
    s.movement = classifyMove(s.frames, s.inMs, s.outMs);
    persist();
    renderTimeline();
    $<HTMLInputElement>("insp-len").value = `${(shotLen(s) / 1000).toFixed(2)}s`;
  });
}
$("insp-play").onclick = () => selected() && playShots([selected()!]);
$("insp-del").onclick = () => deleteSelected();
function deleteSelected() {
  const i = project.shots.findIndex((s) => s.id === selectedId);
  if (i < 0) return;
  project.shots.splice(i, 1);
  selectedId = project.shots[Math.min(i, project.shots.length - 1)]?.id ?? null;
  persist();
  renderTimeline();
  renderInspector();
  broadcast();
}

// =====================================================================================
// AI Studio (Gemini)
// =====================================================================================
async function busy<T>(btn: HTMLButtonElement, label: string, fn: () => Promise<T>) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try {
    return await fn();
  } catch (e: any) {
    toast(e?.message ?? String(e), 7000);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}
aiStatus().then((ok) => $("chip-ai").classList.toggle("live", ok));
$<HTMLTextAreaElement>("ai-script").value = project.script;

$("insp-crit").onclick = () => {
  const s = selected();
  if (!s) return;
  busy($<HTMLButtonElement>("insp-crit"), "✦ Thinking…", async () => {
    const c = await aiCritique(s);
    s.critique = c;
    if (/^\w+ (static|pan|tilt|dolly|truck|crane|handheld|orbit)/i.test(s.name) && c.suggestedName) s.name = c.suggestedName;
    if (c.shotType && SHOT_TYPES.includes(c.shotType)) s.type = c.shotType;
    persist();
    renderTimeline();
    renderInspector();
  });
};
$("ai-plan").onclick = () => {
  const script = $<HTMLTextAreaElement>("ai-script").value.trim();
  if (!script) return toast("Write a few lines of script first");
  project.script = script;
  busy($<HTMLButtonElement>("ai-plan"), "✦ Planning shots…", async () => {
    const plan = await aiPlan(script, $<HTMLInputElement>("ai-location").value);
    if (plan.title && /^Untitled/.test(project.title)) project.title = plan.title;
    $<HTMLInputElement>("title").value = project.title;
    const added: Shot[] = plan.shots.map((p) => ({
      id: uid(), name: p.name, type: p.type, movement: p.movement, lensMm: Math.round(p.lensMm),
      frames: [], durationMs: Math.round(p.durationSec * 1000), inMs: 0, outMs: 0, thumb: "", notes: "", planned: p.description,
    }));
    project.shots.push(...added);
    persist();
    select(added[0]?.id ?? null);
    switchTab("inspector");
    toast(`Gemini planned ${added.length} shots. Select one and press R to shoot it.`, 5000);
  });
};
$("ai-review").onclick = () => {
  const shots = project.shots.filter((s) => s.frames.length);
  if (shots.length < 2) return toast("Record at least two shots first");
  busy($<HTMLButtonElement>("ai-review"), "✦ Reviewing cut…", async () => {
    const r = await aiReview(shots);
    const out = $("ai-out");
    out.hidden = false;
    out.innerHTML =
      `<div>${esc(r.verdict)}</div><ul>${r.notes.map((n) => `<li><b>Shot ${n.shot}:</b> ${esc(n.note)}</li>`).join("")}</ul>` +
      (r.missingShots.length
        ? `<h4>Missing coverage</h4>${r.missingShots.map((m, i) => `<button class="btn apply" data-miss="${i}">+ ${esc(m)}</button>`).join("")}`
        : "");
    out.querySelectorAll<HTMLButtonElement>("[data-miss]").forEach((b) => {
      b.onclick = () => {
        const text = r.missingShots[+b.dataset.miss!];
        project.shots.push({ id: uid(), name: text.slice(0, 40), type: "MS", movement: "Static", lensMm: Math.round(lensMm), frames: [], durationMs: 3000, inMs: 0, outMs: 0, thumb: "", notes: "", planned: text });
        persist();
        renderTimeline();
        b.remove();
      };
    });
  });
};

// =====================================================================================
// Chrome: tabs, title, export menu, transport, setup
// =====================================================================================
function switchTab(name: string) {
  document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll<HTMLElement>(".tab").forEach((t) => (t.hidden = t.id !== `tab-${name}`));
}
document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => (b.onclick = () => switchTab(b.dataset.tab!)));

const title = $<HTMLInputElement>("title");
title.value = project.title;
title.oninput = () => ((project.title = title.value), persist());

const menu = $("export-menu");
$("btn-export").onclick = (e) => (e.stopPropagation(), (menu.hidden = !menu.hidden));
addEventListener("click", () => (menu.hidden = true));
menu.querySelectorAll<HTMLButtonElement>("[data-export]").forEach((b) => {
  b.onclick = () => {
    const k = b.dataset.export;
    if (k === "csv") exportCsv(project);
    if (k === "json") exportJson(project);
    if (k === "blender") exportBlender(project, flipped);
    if (k === "import") $("import-file").click();
    if (k === "clear" && confirmClear()) {
      project.shots = [];
      project.title = "Untitled sequence";
      title.value = project.title;
      selectedId = null;
      persist();
      renderTimeline();
      renderInspector();
    }
  };
});
let clearArmed = 0;
function confirmClear() {
  // Two clicks within 3 s instead of a blocking confirm() dialog.
  if (now() - clearArmed < 3000) return true;
  clearArmed = now();
  toast("Click 'New sequence' again to clear all shots");
  setTimeout(() => (menu.hidden = false));
  return false;
}
$<HTMLInputElement>("import-file").onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const p = JSON.parse(await f.text());
    Object.assign(project, p);
    title.value = project.title;
    persist();
    renderTimeline();
    toast(`Imported ${project.shots.length} shots`);
  } catch {
    toast("That file isn't a Pocket Film Set project");
  }
};

$("t-play").onclick = togglePlay;
$("t-start").onclick = () => (stopPlayback(), select(project.shots[0]?.id ?? null));
$("t-rec").onclick = () => (recording ? stopRec() : startRec());
$("t-mark").onclick = () => setMark();
$("t-cal").onclick = () => startCalibration();
$("cal-cancel").onclick = () => (cal && cal.step === 4 ? finishCalibration() : ((cal = null), ($("cal").hidden = true)));
$("cal-reset").onclick = () => resetCalibration();
$<HTMLInputElement>("t-lens").oninput = (e) => setLens(+(e.target as HTMLInputElement).value);
$<HTMLSelectElement>("t-aspect").onchange = (e) => ((aspect = +(e.target as HTMLSelectElement).value), computeFrame(), applyLens());
const gridBtn = $("t-grid");
const toggleGrid = () => ((showGrid = !showGrid), gridBtn.classList.toggle("on", showGrid));
gridBtn.onclick = toggleGrid;
$<HTMLInputElement>("t-zoom").oninput = (e) => ((pxPerSec = +(e.target as HTMLInputElement).value), renderTimeline());

$("freed-port").textContent = String(FREED_PORT);
const calUnit = $<HTMLSelectElement>("freed-unit");
calUnit.value = String(freedCal.unit);
const calAxes = $<HTMLSelectElement>("freed-axes"), calPan = $<HTMLInputElement>("freed-pan"), calTilt = $<HTMLInputElement>("freed-tilt");
calAxes.value = freedCal.axes;
calPan.checked = freedCal.flipPan;
calTilt.checked = freedCal.flipTilt;
const saveCal = () => {
  Object.assign(freedCal, { axes: calAxes.value, flipPan: calPan.checked, flipTilt: calTilt.checked, unit: +calUnit.value });
  try { localStorage.setItem("pfs.freed", JSON.stringify(freedCal)); } catch {}
  if (arLive()) setMark(true);
};
calAxes.onchange = calPan.onchange = calTilt.onchange = calUnit.onchange = saveCal;
$("zig-port").textContent = String(ZIG_PORT);
$<HTMLInputElement>("scale").oninput = (e) => {
  scale = +(e.target as HTMLInputElement).value;
  $("scale-v").textContent = `${scale.toFixed(2)}×`;
  if (arLive()) setMark(true);
};
$<HTMLSelectElement>("roll").onchange = (e) => {
  rollDeg = +(e.target as HTMLSelectElement).value;
  rollQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(rollDeg));
};
// ---- laptop address: read live from the server so it follows Wi-Fi / hotspot changes ----
const ipSel = $<HTMLSelectElement>("ip-select");
let ipList: { name: string; ip: string }[] = [];
let currentIp = "";
function showAddress(ip: string) {
  if (ip === currentIp) return;
  currentIp = ip;
  const phoneUrl = `https://${ip}${location.port ? ":" + location.port : ""}/camera.html`;
  $("url").textContent = phoneUrl;
  $("zig-ip").textContent = $("freed-ip").textContent = ip;
  QRCode.toCanvas($<HTMLCanvasElement>("qr"), phoneUrl, { width: 132, margin: 1 });
}
async function refreshAddress() {
  const r = await fetch("/api/net").then((x) => x.json()).catch(() => null);
  const list: typeof ipList = r?.addresses?.length ? r.addresses : [{ name: "startup", ip: LAN_IP }];
  if (JSON.stringify(list) === JSON.stringify(ipList)) return;
  const hadIp = !!currentIp;
  ipList = list;
  ipSel.innerHTML = list.map((a) => `<option value="${a.ip}">${a.ip} · ${esc(a.name)}</option>`).join("");
  ipSel.parentElement!.hidden = list.length < 2;
  // Keep a manual choice while it still exists; otherwise take the best guess (Wi-Fi first).
  const picked = store.get("pfs.ip");
  const ip = list.find((a) => a.ip === picked)?.ip ?? list[0].ip;
  ipSel.value = ip;
  if (hadIp && ip !== currentIp) toast(`Laptop address changed to ${ip}. Update the IP in the tracking app and rescan the QR.`, 9000);
  showAddress(ip);
}
ipSel.onchange = () => (store.set("pfs.ip", ipSel.value), showAddress(ipSel.value));
refreshAddress();
setInterval(refreshAddress, 4000);
$("btn-phone").onclick = () => (switchTab("setup"), $("phone-section").scrollIntoView({ block: "start" }));

addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, textarea, select")) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === "r" || e.key === "PageDown") (e.preventDefault(), recording ? stopRec() : startRec());
  else if (k === " ") (e.preventDefault(), togglePlay());
  else if (k === "m") setMark();
  else if (k === "c") startCalibration();
  else if (k === "f") toggleFlip();
  else if (k === "g") toggleGrid();
  else if (k === "[") setLens(lensMm / 1.1);
  else if (k === "]") setLens(lensMm * 1.1);
  else if (k === "delete" || k === "backspace") deleteSelected();
  else if (k === "escape") select(null);
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

let diagNext = 0;
function renderDiag(t: number) {
  if (t < diagNext) return;
  diagNext = t + 200;
  const el = $("diag");
  if (!arLive()) {
    el.textContent = gyroLive() ? "Phone web page connected (rotation only)." : "No tracking data arriving.\nCheck the IP and port in the phone app, and Windows Firewall (allow Node on private networks).";
    return;
  }
  const f = (n: number, w = 7, d = 2) => n.toFixed(d).padStart(w);
  const fr = diag.freed;
  const lines = [`${arSrc}  ${diag.pps} packets/s`];
  if (arSrc === "FreeD" && fr) {
    lines.push(`pan ${f(fr.pan, 7, 1)}  tilt ${f(fr.tilt, 7, 1)}  roll ${f(fr.roll, 7, 1)}  deg`);
    lines.push(`X ${f(fr.x * freedCal.unit)}  Y ${f(fr.y * freedCal.unit)}  Z ${f(fr.z * freedCal.unit)}  m`);
  } else lines.push(`X ${f(rawP.x)}  Y ${f(rawP.y)}  Z ${f(rawP.z)}  m`);
  lines.push(posFrozen() ? "POSITION NOT CHANGING" : now() - diag.lastMove < 1500 ? "position: moving" : "position: still");
  el.textContent = lines.join("\n");
  el.classList.toggle("bad", posFrozen());
}

// =====================================================================================
// Main loop
// =====================================================================================
const timer = new THREE.Timer();
const dir = new THREE.Vector3();
let lastSnap = 0;
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  const t = now();

  if (playing) {
    const { list, t0 } = playing;
    let s = list[playing.idx];
    let local = s.inMs + (t - t0);
    if (local > s.outMs) {
      playing.idx++;
      playing.t0 = t;
      if (playing.idx >= list.length) stopPlayback();
      else (s = list[playing.idx]), (local = s.inMs);
    }
    if (playing) {
      const fov = sampleFrame(s, local, pScratch, qScratch);
      camera.position.copy(pScratch);
      camera.quaternion.copy(qScratch);
      lensMm = fovToLens(fov);
      applyLens();
      const x = clipX[s.id] + ((local - s.inMs) / 1000) * pxPerSec;
      playhead.style.left = `${x}px`;
      $("tc").textContent = timecode(local - s.inMs);
      $("hud-shot").textContent = `SH${String(project.shots.indexOf(s) + 1).padStart(2, "0")} · ${s.name}`;
      $("mode").textContent = "PLAY";
    }
  } else {
    // Keyboard / phone pads dolly the camera (or the AR anchor) in the camera's own frame.
    const kx = axis("d", "a"), ky = axis("e", "q"), kz = axis("w", "s");
    const mx = kx || gyroMove.x, my = ky || gyroMove.y, mz = kz || gyroMove.z;
    if (mx || my || mz) {
      const v = new THREE.Vector3();
      v.addScaledVector(dir.set(1, 0, 0).applyQuaternion(camera.quaternion), mx);
      v.addScaledVector(dir.set(0, 0, -1).applyQuaternion(camera.quaternion), mz);
      v.y += my;
      v.multiplyScalar(1.2 * dt);
      (arLive() ? anchor : targetP).add(v);
      if (arLive()) targetP.add(v);
    }
    const kp = 1 - Math.exp(-dt * (arLive() ? 25 : 14));
    camera.position.lerp(targetP, kp);
    camera.quaternion.slerp(targetQ, 1 - Math.exp(-dt * 18));
    $("mode").textContent = recording ? "REC" : "STBY";
    const s = selected();
    $("hud-shot").textContent = s ? `SH${String(project.shots.indexOf(s) + 1).padStart(2, "0")} · ${s.name}${s.frames.length ? "" : " (planned)"}` : "";
  }

  tickCalibration();
  renderer.render(scene, camera);
  drawOverlay();

  if (recording) {
    const rt = t - recStart;
    frames.push({ t: rt, p: camera.position.toArray(), q: camera.quaternion.toArray(), fov: lensToFov(lensMm) });
    if (t - lastSnap > 1200) ((lastSnap = t), snaps.push({ t: rt, img: snapshot() }));
    $("tc").textContent = timecode(rt);
  } else if (!playing) $("tc").textContent = timecode(0);

  const src = source();
  const hs = $("hud-src");
  hs.textContent = sourceHud();
  hs.classList.toggle("ar", src.startsWith("AR") && !posFrozen());
  hs.classList.toggle("warn", posFrozen());
  renderDiag(t);
  $("chip-ar").classList.toggle("live", arLive());
  $("chip-gyro").classList.toggle("live", gyroLive());
  const p = camera.position;
  $("hud-pos").textContent = `X ${p.x.toFixed(2)}  Y ${p.y.toFixed(2)}  Z ${p.z.toFixed(2)}  · ${aspect === 1.778 ? "16:9" : aspect + ":1"}`;
});

renderTimeline();
renderInspector();
resize();

// Initial scene: ?scene= in the URL, else the last scan used, else the sample.
(async () => {
  await refreshScenes();
  const param = new URLSearchParams(location.search).get("scene");
  let saved: { url: string; name: string } | null = null;
  try { saved = JSON.parse(store.get("pfs.scene") ?? "null"); } catch {}
  if (param) setSplat({ url: param }, param.split("/").pop() ?? param);
  else if (saved && sceneList.some((s) => s.url === saved!.url)) setSplat({ url: saved.url }, saved.name);
  else if (sceneList.length) loadScene(sceneList[0].url, sceneList[0].name);
  else setSplat({ url: DEFAULT_SCENE }, "sample");
})();
(window as any).__pfs = { camera }; // handy for debugging in the console
