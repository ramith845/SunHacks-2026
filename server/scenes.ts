// Scan library: the phone (or a drag-and-drop on the laptop) uploads a splat file, the laptop loads it.
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const EXT = /\.(spz|ply|splat|ksplat|sog|rad)$/i;
const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB

export function makeScenes(dir: string, onNew: (url: string, name: string) => void) {
  fs.mkdirSync(dir, { recursive: true });
  // Keep only safe characters and a known splat extension, so an upload can't write outside the folder.
  const clean = (name: string) => {
    const base = path.basename(name.replace(/\\/g, "/")).replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "").trim();
    return EXT.test(base) ? base : null;
  };
  const list = () =>
    fs
      .readdirSync(dir)
      .filter((f) => EXT.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { name: f, url: `/scenes/${encodeURIComponent(f)}`, bytes: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.statusCode = code;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };

  // Returns true when it handled the request.
  return function handle(req: IncomingMessage, res: ServerResponse): boolean {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/api/scenes" && req.method === "GET") return json(res, 200, list()), true;

    if (url.pathname === "/api/scenes/upload" && req.method === "POST") {
      const name = clean(url.searchParams.get("name") ?? "");
      if (!name) return json(res, 400, { error: "Pick a .spz or .ply splat file (Scaniverse: Export Model → SPZ)." }), true;
      if (Number(req.headers["content-length"] ?? 0) > MAX_BYTES) return json(res, 413, { error: "File is over 1 GB." }), true;
      const tmp = path.join(dir, `.upload-${Date.now()}-${name}`);
      const out = fs.createWriteStream(tmp);
      let bytes = 0, failed = false;
      const fail = (code: number, error: string) => {
        if (failed) return;
        failed = true;
        out.destroy();
        fs.rm(tmp, { force: true }, () => {});
        json(res, code, { error });
      };
      req.on("data", (c: Buffer) => {
        bytes += c.length;
        if (bytes > MAX_BYTES) (fail(413, "File is over 1 GB."), req.destroy());
      });
      req.on("error", () => fail(400, "Upload interrupted."));
      req.on("aborted", () => fail(400, "Upload interrupted."));
      req.pipe(out);
      out.on("error", (e) => fail(500, e.message));
      out.on("finish", () => {
        if (failed) return;
        if (!bytes) return fail(400, "That file was empty.");
        fs.renameSync(tmp, path.join(dir, name)); // replaces an older scan with the same name
        const sceneUrl = `/scenes/${encodeURIComponent(name)}`;
        json(res, 200, { name, url: sceneUrl, bytes });
        if (url.searchParams.get("announce") !== "0") onNew(sceneUrl, name);
      });
      return true;
    }

    // Serve scans ourselves so a file uploaded a second ago is available immediately.
    if (url.pathname.startsWith("/scenes/") && (req.method === "GET" || req.method === "HEAD")) {
      const name = clean(decodeURIComponent(url.pathname.slice("/scenes/".length)));
      const file = name && path.join(dir, name);
      if (!file || !fs.existsSync(file)) return false;
      res.setHeader("content-type", "application/octet-stream");
      res.setHeader("content-length", fs.statSync(file).size);
      res.setHeader("cache-control", "no-cache");
      if (req.method === "HEAD") return res.end(), true;
      fs.createReadStream(file).pipe(res);
      return true;
    }
    return false;
  };
}
