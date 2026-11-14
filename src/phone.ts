// iPhone page: reads the motion sensors and streams the camera pose to the laptop.
import * as THREE from "three";
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

// Device orientation (alpha/beta/gamma) -> camera quaternion. Same maths as the
// classic three.js DeviceOrientationControls: camera looks out of the back of the phone.
const q = new THREE.Quaternion();
const euler = new THREE.Euler();
const zee = new THREE.Vector3(0, 0, 1);
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const rad = THREE.MathUtils.degToRad;
let gotPose = false;

function onOrient(e: DeviceOrientationEvent) {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  const orient = rad(screen.orientation?.angle ?? (window as any).orientation ?? 0);
  euler.set(rad(e.beta), rad(e.alpha), -rad(e.gamma), "YXZ");
  q.setFromEuler(euler).multiply(q1).multiply(q0.setFromAxisAngle(zee, -orient));
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
  const D = DeviceOrientationEvent as any;
  if (typeof D?.requestPermission === "function") {
    const r = await D.requestPermission().catch(() => "denied");
    if (r !== "granted") {
      startBtn.textContent = "Motion access denied — reload and allow";
      return;
    }
  }
  window.addEventListener("deviceorientation", onOrient);
  startBtn.hidden = true;
  startBtn.style.display = "none";
  ui.hidden = false;
  (navigator as any).wakeLock?.request("screen").catch(() => {});
  setInterval(() => {
    if (!gotPose) return;
    send({
      type: "pose",
      q: [q.x, q.y, q.z, q.w],
      move: [...move] as [number, number, number],
      fov: lensToFov(+lens.value),
    });
  }, 1000 / 30);
};
