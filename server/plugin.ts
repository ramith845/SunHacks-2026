// Dev-server plugin: WebSocket relay, ZIG SIM ARKit bridge, and the Gemini API endpoints.
import type { Plugin } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, ServerResponse } from "node:http";
import { makeGemini, planSchema, critiqueSchema, reviewSchema, SYSTEM_DP, type Part } from "./gemini";
import { startZigSim } from "./zigsim";
import { startFreeD } from "./freed";

type Opts = { geminiKey?: string; geminiModel?: string; zigPort: number; freedPort: number };

const readBody = (req: IncomingMessage) =>
  new Promise<any>((res, rej) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => {
      try {
        res(s ? JSON.parse(s) : {});
      } catch (e) {
        rej(e);
      }
    });
    req.on("error", rej);
  });

const img = (dataUrl: string): Part => {
  const m = /^data:(.+?);base64,(.*)$/.exec(dataUrl ?? "");
  if (!m) throw new Error("bad image");
  return { inlineData: { mimeType: m[1], data: m[2] } };
};

export function pocketFilmSet(opts: Opts): Plugin {
  const gemini = makeGemini(opts.geminiKey, opts.geminiModel);

  const routes: Record<string, (b: any) => Promise<unknown>> = {
    "/api/ai/status": async () => ({ ok: !!opts.geminiKey }),
    "/api/ai/plan": async ({ script, location }) =>
      gemini(
        [
          {
            text:
              `Break this script or scene idea into a shot list of 4 to 8 shots that could be filmed in the scanned location` +
              (location ? ` ("${location}")` : "") +
              `. Vary shot sizes, give coverage an editor can cut, and keep each shot 2-8 seconds.\n\nSCRIPT:\n${script}`,
          },
        ],
        planSchema,
        SYSTEM_DP,
      ),
    "/api/ai/critique": async ({ image, shot, intent }) =>
      gemini(
        [
          img(image),
          {
            text:
              `This is a storyboard frame from a virtual camera. Lens ${shot?.lensMm}mm, move: ${shot?.movement}, ` +
              `${(shot?.durationMs ?? 0) / 1000}s.` +
              (intent ? ` The director intended: "${intent}".` : "") +
              ` Critique the framing and composition and say how to improve the shot.`,
          },
        ],
        critiqueSchema,
        SYSTEM_DP,
      ),
    "/api/ai/review": async ({ shots }) =>
      gemini(
        [
          ...(shots as any[]).flatMap((s, i): Part[] => [
            { text: `Shot ${i + 1}: "${s.name}" ${s.type}, ${s.lensMm}mm, ${s.movement}, ${(s.durationMs / 1000).toFixed(1)}s` },
            img(s.thumb),
          ]),
          { text: "Review this sequence as an editor and DP: flow, coverage, variety of shot sizes, continuity, pacing." },
        ],
        reviewSchema,
        SYSTEM_DP,
      ),
  };

  const attach = (httpServer: any, middlewares: any, log: (s: string) => void) => {
    if (!httpServer) return;
    // ---- relay ----
    const wss = new WebSocketServer({ noServer: true });
    const broadcast = (data: string, except?: WebSocket) => {
      for (const c of wss.clients) if (c !== except && c.readyState === WebSocket.OPEN) c.send(data);
    };
    httpServer.on("upgrade", (req: any, socket: any, head: any) => {
      if (!req.url?.startsWith("/relay")) return; // leave Vite's HMR socket alone
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on("message", (data) => broadcast(data.toString(), ws));
      });
    });
    // ---- ZIG SIM ARKit bridge ----
    const stop = startZigSim(
      opts.zigPort,
      (pose) => broadcast(JSON.stringify({ type: "arpose", p: pose.p, q: pose.q, src: "zigsim" })),
      log,
    );
    // ---- FreeD (free "FREED Tracker" app and any virtual-production tracker) ----
    const stopFreeD = startFreeD(opts.freedPort, (f) => broadcast(JSON.stringify({ type: "freed", ...f })), log);
    httpServer.on("close", () => (stop(), stopFreeD()));
    // ---- AI endpoints ----
    middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const route = routes[(req.url ?? "").split("?")[0]];
      if (!route) return next();
      res.setHeader("content-type", "application/json");
      try {
        res.end(JSON.stringify(await route(req.method === "POST" ? await readBody(req) : {})));
      } catch (e: any) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: e?.message ?? String(e) }));
      }
    });
  };

  return {
    name: "pocket-film-set",
    configureServer: (s) => attach(s.httpServer, s.middlewares, (m) => s.config.logger.info(m)),
    configurePreviewServer: (s) => attach(s.httpServer, s.middlewares, (m) => s.config.logger.info(m)),
  };
}
