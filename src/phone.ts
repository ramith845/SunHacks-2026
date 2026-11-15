// iPhone page: reads the motion sensors and streams the camera pose to the laptop.
import { connect, lensToFov, type Msg } from "./protocol";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const startBtn = $("start"), ui = $("ui"), conn = $("conn"), recBtn = $("rec");
const lens = $<HTMLInputElement>("lens"), mm = $("mm");

let recording = false;
const send = connect(
  (m: Msg) => {
    if (m.type === "status") {
      recording = m.recording;
      document.body.classList.toggle("recording", recording);
      recBtn.textContent = recording ? "■ STOP" : "● REC";
      conn.textContent = `Connected · ${m.takes} take${m.takes === 1 ? "" : "s"}`;
    }
  },
  (open) => (conn.textContent = open ? "Connected" : "Reconnecting…"),
);

// Device orientation (alpha/beta/gamma) -> camera quaternion [x, y, z, w]. Same maths as the classic
// three.js DeviceOrientationControls (camera looks out of the back of the phone), written out by hand
// so this page stays tiny and has nothing heavy to load.
type Q = [number, number, number, number];
const mul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
function eulerYXZ(x: number, y: number, z: number): Q {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
}
const Q1: Q = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // -90 deg about X
const rad = (d: number) => (d * Math.PI) / 180;
let q: Q = [0, 0, 0, 1];
let gotPose = false;

function onOrient(e: DeviceOrientationEvent) {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  const orient = rad(screen.orientation?.angle ?? (window as any).orientation ?? 0);
  const screenQ: Q = [0, 0, Math.sin(-orient / 2), Math.cos(-orient / 2)];
  q = mul(mul(eulerYXZ(rad(e.beta), rad(e.alpha), -rad(e.gamma)), Q1), screenQ);
  gotPose = true;
}

// Hold-to-move buttons.
const move: [number, number, number] = [0, 0, 0];
document.querySelectorAll<HTMLButtonElement>("[data-move]").forEach((b) => {
  const v = b.dataset.move!.split(",").map(Number);
  const set = (s: number) => (e: Event) => {
    e.preventDefault();
    b.classList.toggle("down", s > 0);
    v.forEach((x, i) => (move[i] += x * s));
  };
  b.addEventListener("pointerdown", set(1));
  b.addEventListener("pointerup", set(-1));
  b.addEventListener("pointercancel", set(-1));
});

lens.oninput = () => (mm.textContent = `${lens.value}mm`);
$("mark").onclick = () => send({ type: "mark" });
recBtn.onclick = () => send({ type: recording ? "stop" : "rec" });

startBtn.onclick = async () => {
  // iOS needs a user tap + HTTPS before it hands out motion data.
  startBtn.textContent = "Asking for motion access…"; // instant feedback so the tap never looks dead
  const D = (window as any).DeviceOrientationEvent;
  if (typeof D?.requestPermission === "function") {
    // Some browsers never answer; don't wait forever.
    const r = await Promise.race([
      D.requestPermission().catch(() => "denied"),
      new Promise((res) => setTimeout(() => res("timeout"), 4000)),
    ]);
    if (r === "denied") {
      startBtn.textContent = "Motion access denied. Close this tab, reopen the link and tap Allow.";
      return;
    }
  }
  window.addEventListener("deviceorientation", onOrient);
  $("home").style.display = "none";
  ui.hidden = false;
  (navigator as any).wakeLock?.request("screen").catch(() => {});
  setInterval(() => {
    if (!gotPose) return;
    send({
      type: "pose",
      q,
      move: [...move] as [number, number, number],
      fov: lensToFov(+lens.value),
    });
  }, 1000 / 30);
};

(window as any).__pfsReady = true; // tells the page's inline script that this module loaded
