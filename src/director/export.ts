// Shot list (CSV), project (JSON) and a Blender script that rebuilds every shot as a keyframed camera.
import { shotLen, type Project, type Shot } from "./shots";

function download(name: string, text: string, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const slug = (s: string) => s.replace(/[^\w-]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "sequence";
export const timecode = (ms: number, fps = 24) => {
  const f = Math.floor((ms / 1000) * fps);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(f / (fps * 3600)))}:${p(Math.floor(f / (fps * 60)) % 60)}:${p(Math.floor(f / fps) % 60)}:${p(f % fps)}`;
};

export function exportCsv(p: Project) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["#", "Name", "Size", "Move", "Lens (mm)", "Duration (s)", "Record in", "Tracking", "Notes", "AI score", "AI note"]];
  let t = 0;
  p.shots.forEach((s, i) => {
    const len = s.frames.length ? shotLen(s) : s.durationMs;
    rows.push([String(i + 1), s.name, s.type, s.movement, String(s.lensMm), (len / 1000).toFixed(2), timecode(t), s.tracking ?? (s.frames.length ? "" : "planned"), s.notes || s.planned || "", s.critique ? String(s.critique.score) : "", s.critique?.summary ?? ""]);
    t += len;
  });
  download(`${slug(p.title)}_shotlist.csv`, rows.map((r) => r.map(esc).join(",")).join("\n"), "text/csv");
}

export function exportJson(p: Project) {
  download(`${slug(p.title)}.pocketfilm.json`, JSON.stringify(p), "application/json");
}

// three.js world is y-up / -z forward; Blender is z-up. Rotate +90deg about X: (x, y, z) -> (x, -z, y).
export function exportBlender(p: Project, sceneFlipped: boolean, fps = 24) {
  const shots = p.shots.filter((s) => s.frames.length > 1);
  const data = shots.map((s: Shot) => {
    const f = s.frames.filter((x) => x.t >= s.inMs && x.t <= s.outMs);
    const step = Math.max(1, Math.round(f.length / ((shotLen(s) / 1000) * fps))); // ~1 key per frame
    return {
      name: s.name,
      keys: f.filter((_, i) => i % step === 0).map((x) => [
        +((x.t - s.inMs) / 1000).toFixed(4),
        x.p.map((v) => +v.toFixed(4)),
        x.q.map((v) => +v.toFixed(5)),
        +(12 / Math.tan((x.fov * Math.PI) / 360)).toFixed(2),
      ]),
    };
  });
  const py = `# Pocket Film Set -> Blender (tested API: Blender 4.x/5.x)
# Run in Blender: Scripting tab > Open > Run Script.
# Optional: set SPLAT_PATH to your .ply/.spz scan to load it in place (Blender 5.3+ imports splats).
import bpy, json, math
from mathutils import Quaternion, Vector

SPLAT_PATH = ""   # e.g. r"E:\\scans\\lobby.ply"
FPS = ${fps}
SHOTS = json.loads(r'''${JSON.stringify(data)}''')
SCENE_FLIPPED = ${sceneFlipped ? "True" : "False"}

scn = bpy.context.scene
scn.render.fps = FPS
C = Quaternion((1, 0, 0), math.radians(90))   # y-up -> z-up

def conv_p(p): return Vector((p[0], -p[2], p[1]))
def conv_q(q): return C @ Quaternion((q[3], q[0], q[1], q[2]))

if SPLAT_PATH:
    try:
        bpy.ops.wm.ply_import(filepath=SPLAT_PATH)  # PLY works everywhere; for .spz use File > Import in 5.3
        ob = bpy.context.selected_objects[0]
        ob.rotation_mode = 'QUATERNION'
        ob.rotation_quaternion = C @ (Quaternion((1, 0, 0), math.pi) if SCENE_FLIPPED else Quaternion())
    except Exception as e:
        print("Splat import failed:", e)

col = bpy.data.collections.get("PocketFilmSet") or bpy.data.collections.new("PocketFilmSet")
if col.name not in scn.collection.children: scn.collection.children.link(col)
for m in list(scn.timeline_markers):
    if m.name.startswith("SH"): scn.timeline_markers.remove(m)

start = 1
first = None
for i, s in enumerate(SHOTS):
    cd = bpy.data.cameras.new(f"SH{i+1:02d}_{s['name']}")
    cd.sensor_fit = 'VERTICAL'; cd.sensor_height = 24.0
    cam = bpy.data.objects.new(cd.name, cd); col.objects.link(cam)
    cam.rotation_mode = 'QUATERNION'
    for t, p, q, lens in s["keys"]:
        fr = start + t * FPS
        cam.location = conv_p(p); cam.rotation_quaternion = conv_q(q); cd.lens = lens
        cam.keyframe_insert("location", frame=fr); cam.keyframe_insert("rotation_quaternion", frame=fr)
        cd.keyframe_insert("lens", frame=fr)
    first = first or cam
    mk = scn.timeline_markers.new(f"SH{i+1:02d} {s['name']}", frame=int(start)); mk.camera = cam
    start += max(1, round(s["keys"][-1][0] * FPS)) + 1

scn.frame_start, scn.frame_end = 1, int(start)
if first: scn.camera = first
print(f"Pocket Film Set: built {len(SHOTS)} shot cameras, {int(start)} frames")
`;
  download(`${slug(p.title)}_blender.py`, py, "text/x-python");
}
