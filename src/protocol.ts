// Messages between the phone (/camera.html), the ZIG SIM bridge and the laptop (/). Keep them tiny.
declare const __LAN_IP__: string;
declare const __ZIG_PORT__: number;
export const LAN_IP = __LAN_IP__;
export const ZIG_PORT = __ZIG_PORT__;

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export type PoseMsg = {
  type: "pose"; // web page on the phone: orientation only (3DoF)
  q: Quat;
  move: Vec3; // dolly pads: right, up, forward, each -1..1
  fov: number; // vertical field of view in degrees
};
export type ArPoseMsg = { type: "arpose"; p: Vec3; q: Quat; src: string }; // ARKit world tracking (6DoF), metres
export type Msg =
  | PoseMsg
  | ArPoseMsg
  | { type: "mark" } // "where I stand now = where the camera is now"
  | { type: "rec" }
  | { type: "stop" }
  | { type: "status"; recording: boolean; takes: number };

export function connect(onMsg: (m: Msg) => void, onState?: (open: boolean) => void) {
  let ws: WebSocket | null = null;
  const open = () => {
    ws = new WebSocket(`wss://${location.host}/relay`);
    ws.onopen = () => onState?.(true);
    ws.onmessage = (e) => {
      try {
        onMsg(JSON.parse(e.data));
      } catch {}
    };
    ws.onclose = () => {
      onState?.(false);
      setTimeout(open, 1000); // auto-reconnect
    };
  };
  open();
  return (m: Msg) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };
}

// 35mm-equivalent focal length <-> vertical FOV (24mm tall full-frame gate).
export const lensToFov = (mm: number) => (2 * Math.atan(12 / mm) * 180) / Math.PI;
export const fovToLens = (fov: number) => 12 / Math.tan((fov * Math.PI) / 360);
