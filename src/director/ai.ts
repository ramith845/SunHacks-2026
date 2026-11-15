// Browser side of AI Studio features. All calls go through the dev server, which holds the Gemini key.
import { shotLen, type Shot, type Critique } from "./shots";

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new Error(`Gemini: ${j.error ?? r.status}`);
  return j as T;
}

export const aiStatus = () => fetch("/api/ai/status").then((r) => r.json()).then((j) => !!j.ok).catch(() => false);

export type PlanShot = { name: string; type: string; movement: string; lensMm: number; durationSec: number; description: string };
export const aiPlan = (script: string, location: string) => post<{ title: string; shots: PlanShot[] }>("/api/ai/plan", { script, location });

export const aiCritique = (s: Shot) =>
  post<Critique & { suggestedName: string; shotType: string }>("/api/ai/critique", {
    image: s.thumb,
    shot: { lensMm: s.lensMm, movement: s.movement, durationMs: shotLen(s) },
    intent: s.planned,
  });

export const aiReview = (shots: Shot[]) =>
  post<{ verdict: string; notes: { shot: number; note: string }[]; missingShots: string[] }>("/api/ai/review", {
    shots: shots.map((s) => ({ name: s.name, type: s.type, lensMm: s.lensMm, movement: s.movement, durationMs: shotLen(s), thumb: s.thumb })),
  });
