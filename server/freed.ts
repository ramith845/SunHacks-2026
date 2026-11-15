// FreeD D1 receiver: the standard camera-tracking packet used by virtual-production tools.
// Free iPhone apps (e.g. "FREED Tracker") send ARKit tracking in this format over UDP.
//
// D1 layout, 29 bytes, big-endian signed 24-bit fields:
//  0 0xD1 | 1 camera id | 2-4 pan | 5-7 tilt | 8-10 roll (degrees * 32768)
//  11-13 X | 14-16 Y | 17-19 Z (millimetres * 64) | 20-22 zoom | 23-25 focus | 26-27 spare
//  28 checksum = (0x40 - sum(bytes 0..27)) mod 256
import dgram from "node:dgram";

export type FreeD = { cam: number; pan: number; tilt: number; roll: number; x: number; y: number; z: number; zoom: number; focus: number };

const s24 = (b: Buffer, o: number) => {
  const v = (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
  return v & 0x800000 ? v - 0x1000000 : v;
};
const u24 = (b: Buffer, o: number) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];

export function parseFreeD(b: Buffer): FreeD | null {
  if (b.length < 29 || b[0] !== 0xd1) return null;
  let sum = 0;
  for (let i = 0; i < 28; i++) sum += b[i];
  if (((0x40 - sum) & 0xff) !== b[28]) return null; // corrupt or not FreeD
  return {
    cam: b[1],
    pan: s24(b, 2) / 32768,
    tilt: s24(b, 5) / 32768,
    roll: s24(b, 8) / 32768,
    x: s24(b, 11) / 64 / 1000, // metres
    y: s24(b, 14) / 64 / 1000,
    z: s24(b, 17) / 64 / 1000,
    zoom: u24(b, 20),
    focus: u24(b, 23),
  };
}

// Used by tests and handy for faking a tracker.
export function encodeFreeD(f: Omit<FreeD, "zoom" | "focus" | "cam"> & { cam?: number }): Buffer {
  const b = Buffer.alloc(29);
  const w = (o: number, v: number) => {
    const n = Math.round(v) & 0xffffff;
    b[o] = n >> 16; b[o + 1] = (n >> 8) & 0xff; b[o + 2] = n & 0xff;
  };
  b[0] = 0xd1; b[1] = f.cam ?? 1;
  w(2, f.pan * 32768); w(5, f.tilt * 32768); w(8, f.roll * 32768);
  w(11, f.x * 1000 * 64); w(14, f.y * 1000 * 64); w(17, f.z * 1000 * 64);
  w(20, 0x80000); w(23, 0x80000);
  let sum = 0;
  for (let i = 0; i < 28; i++) sum += b[i];
  b[28] = (0x40 - sum) & 0xff;
  return b;
}

export function startFreeD(port: number, onData: (f: FreeD) => void, log: (s: string) => void) {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  let warned = false;
  sock.on("message", (buf) => {
    // Some senders pack several packets into one datagram.
    for (let o = 0; o + 29 <= buf.length; o += 29) {
      const f = parseFreeD(buf.subarray(o, o + 29));
      if (f) onData(f);
      else if (!warned) (warned = true), log(`[freed] got a UDP packet on ${port} that isn't FreeD D1`);
    }
  });
  sock.on("error", (e) => log(`[freed] UDP ${port} unavailable: ${e.message}`));
  sock.bind(port, () => log(`[freed] listening for FreeD tracking on UDP ${port}`));
  return () => sock.close();
}
