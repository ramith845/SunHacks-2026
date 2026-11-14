// Messages between the phone (/camera.html) and the laptop (/). Keep them tiny.
declare const __LAN_IP__: string;
export const LAN_IP = __LAN_IP__;

export type PoseMsg = {
  type: "pose";
  q: [number, number, number, number]; // phone orientation quaternion (x, y, z, w)
  move: [number, number, number]; // dolly input: right, up, forward, each -1..1
  fov: number; // vertical field of view in degrees
};
export type Msg =
  | PoseMsg
  | { type: "mark" } // "this direction is forward"
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

// 35mm-equivalent focal length <-> vertical FOV (24mm tall full-frame sensor).
export const lensToFov = (mm: number) => (2 * Math.atan(12 / mm) * 180) / Math.PI;
