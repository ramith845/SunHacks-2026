// Receives ARKit 6DoF pose from the ZIG SIM Pro iPhone app (UDP, JSON or OSC) and hands it on.
import dgram from "node:dgram";

export type ArPose = { p: [number, number, number]; q: [number, number, number, number] };

const isNumArr = (v: any, n: number) => Array.isArray(v) && v.length >= n && v.slice(0, n).every((x) => typeof x === "number");
const vec = (v: any, n: number): number[] | null => {
  if (isNumArr(v, n)) return v.slice(0, n);
  if (v && typeof v === "object" && typeof v.x === "number") {
    const out = [v.x, v.y, v.z, v.w].slice(0, n);
    return out.every((x) => typeof x === "number") ? out : null;
  }
  return null;
};

// ZIG SIM's JSON nests sensors under sensordata; find any object with position + rotation under an "arkit" key.
function findArkit(o: any, depth = 0): any {
  if (!o || typeof o !== "object" || depth > 5) return null;
  for (const [k, v] of Object.entries(o)) {
    if (k.toLowerCase() === "arkit" && v && typeof v === "object") return v;
    const hit = findArkit(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

export function parseJson(buf: Buffer): Partial<ArPose> | null {
  let j: any;
  try {
    j = JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  }
  const a = findArkit(j);
  if (!a) return null;
  const p = vec(a.position ?? a.pos, 3) as ArPose["p"] | null;
  const q = vec(a.rotation ?? a.quaternion ?? a.rot, 4) as ArPose["q"] | null;
  return { ...(p && { p }), ...(q && { q }) };
}

// Minimal OSC reader: messages and bundles with float/int args.
function readStr(b: Buffer, o: number): [string, number] {
  let e = o;
  while (e < b.length && b[e] !== 0) e++;
  return [b.toString("ascii", o, e), (e + 4) & ~3];
}
export function parseOsc(b: Buffer, out: Partial<ArPose> = {}): Partial<ArPose> {
  if (b.toString("ascii", 0, 7) === "#bundle") {
    let o = 16;
    while (o + 4 <= b.length) {
      const size = b.readInt32BE(o);
      parseOsc(b.subarray(o + 4, o + 4 + size), out);
      o += 4 + size;
    }
    return out;
  }
  const [addr, o1] = readStr(b, 0);
  const [tags, o2] = readStr(b, o1);
  const args: number[] = [];
  let o = o2;
  for (const t of tags.slice(1)) {
    if (t === "f") (args.push(b.readFloatBE(o)), (o += 4));
    else if (t === "i") (args.push(b.readInt32BE(o)), (o += 4));
    else if (t === "d") (args.push(b.readDoubleBE(o)), (o += 8));
    else break;
  }
  const a = addr.toLowerCase();
  if (a.endsWith("arkitposition") && args.length >= 3) out.p = args.slice(0, 3) as ArPose["p"];
  if (a.endsWith("arkitrotation") && args.length >= 4) out.q = args.slice(0, 4) as ArPose["q"];
  return out;
}

export function startZigSim(port: number, onPose: (p: ArPose) => void, log: (s: string) => void) {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  let last: Partial<ArPose> = {};
  let warned = false;
  sock.on("message", (buf) => {
    const got = buf[0] === 0x7b /* { */ ? parseJson(buf) : parseOsc(buf);
    if (!got || (!got.p && !got.q)) {
      if (!warned) log("[zigsim] packets arriving but no ARKit data: in ZIG SIM pick ARKit (DEVICE mode).");
      warned = true;
      return;
    }
    last = { ...last, ...got };
    if (last.p && last.q) onPose(last as ArPose);
  });
  sock.on("error", (e) => log(`[zigsim] UDP ${port} unavailable: ${e.message}`));
  sock.bind(port, () => log(`[zigsim] listening for ARKit on UDP ${port}`));
  return () => sock.close();
}
