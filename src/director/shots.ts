// Shot data, persistence and automatic labelling.
import * as THREE from "three";

export type Frame = { t: number; p: number[]; q: number[]; fov: number };
export type Critique = { score: number; summary: string; suggestions: string[]; shotType?: string };
export type Shot = {
  id: string;
  name: string;
  type: string; // EWS WS MWS MS MCU CU ECU OTS POV INSERT
  movement: string;
  lensMm: number;
  frames: Frame[]; // empty = planned, not shot yet
  durationMs: number; // recorded length (or planned length)
  inMs: number;
  outMs: number;
  thumb: string;
  notes: string;
  tracking?: string; // AR 6DoF / Gyro / Mouse
  planned?: string; // AI or manual description of the planned shot
  critique?: Critique;
};

export const SHOT_TYPES = ["EWS", "WS", "MWS", "MS", "MCU", "CU", "ECU", "OTS", "POV", "INSERT"];
export const MOVES = ["Static", "Pan", "Tilt", "Dolly in", "Dolly out", "Truck", "Crane up", "Crane down", "Handheld", "Orbit"];

const KEY = "pocket-film-set.v2";
export type Project = { title: string; script: string; shots: Shot[] };

export function load(): Project {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "");
    if (p && Array.isArray(p.shots)) return p;
  } catch {}
  return { title: "Untitled sequence", script: "", shots: [] };
}
export function save(p: Project) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage full: drop the oldest thumbnails' quality rather than lose the cut.
    console.warn("localStorage full; export your project to keep it");
  }
}

export const uid = () => Math.random().toString(36).slice(2, 9);
export const shotLen = (s: Shot) => Math.max(0, s.outMs - s.inMs);

export function defaultType(lensMm: number) {
  if (lensMm < 20) return "EWS";
  if (lensMm < 28) return "WS";
  if (lensMm < 40) return "MS";
  if (lensMm < 70) return "MCU";
  if (lensMm < 110) return "CU";
  return "ECU";
}

// Classify the camera move from the recorded path (within the trim), in the camera's own starting frame.
export function classifyMove(frames: Frame[], inMs: number, outMs: number): string {
  const f = frames.filter((x) => x.t >= inMs && x.t <= outMs);
  if (f.length < 2) return "Static";
  const a = f[0], b = f[f.length - 1];
  const qa = new THREE.Quaternion().fromArray(a.q);
  const d = new THREE.Vector3().fromArray(b.p).sub(new THREE.Vector3().fromArray(a.p));
  const local = d.clone().applyQuaternion(qa.clone().invert()); // x right, y up, -z forward
  const ea = new THREE.Euler().setFromQuaternion(qa, "YXZ");
  const eb = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(b.q), "YXZ");
  const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
  const yaw = THREE.MathUtils.radToDeg(wrap(eb.y - ea.y));
  const pitch = THREE.MathUtils.radToDeg(eb.x - ea.x);
  const dist = d.length();
  // Path length vs straight-line distance tells handheld wobble from a clean move.
  let path = 0;
  for (let i = 1; i < f.length; i++) path += Math.hypot(f[i].p[0] - f[i - 1].p[0], f[i].p[1] - f[i - 1].p[1], f[i].p[2] - f[i - 1].p[2]);

  if (dist > 0.25 && Math.abs(yaw) > 35) return "Orbit";
  if (dist > 0.2) {
    const ax = Math.abs(local.x), ay = Math.abs(local.y), az = Math.abs(local.z);
    if (path > dist * 2.2) return "Handheld";
    if (az >= ax && az >= ay) return local.z < 0 ? "Dolly in" : "Dolly out";
    if (ay >= ax) return local.y > 0 ? "Crane up" : "Crane down";
    return "Truck";
  }
  if (Math.abs(yaw) > 8 && Math.abs(yaw) >= Math.abs(pitch)) return "Pan";
  if (Math.abs(pitch) > 6) return "Tilt";
  return path > 0.3 ? "Handheld" : "Static";
}

export function sampleFrame(s: Shot, t: number, outPos: THREE.Vector3, outQ: THREE.Quaternion): number {
  const f = s.frames;
  let i = f.findIndex((x) => x.t >= t);
  if (i < 0) i = f.length - 1;
  i = Math.max(i, 1);
  const a = f[i - 1], b = f[i];
  const k = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t || 1), 0, 1);
  outPos.fromArray(a.p).lerp(new THREE.Vector3().fromArray(b.p), k);
  outQ.fromArray(a.q).slerp(new THREE.Quaternion().fromArray(b.q), k);
  return a.fov + (b.fov - a.fov) * k;
}
