// Server-side Gemini calls. The API key never reaches the browser.
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export function makeGemini(apiKey: string | undefined, preferred?: string) {
  // First model that answers wins; later ones are fallbacks when one is overloaded or retired.
  const models = [preferred, "gemini-3.8-flash", "gemini-flash-latest", "gemini-3.6-flash"].filter(
    (m, i, a): m is string => !!m && a.indexOf(m) === i,
  );

  return async function generateJson<T>(parts: Part[], schema: object, system?: string): Promise<T> {
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing. Put it in .env and restart npm run dev.");
    const errs: string[] = [];
    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(`${BASE}/${model}:generateContent`, {
          signal: AbortSignal.timeout(45_000),
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: system ? { parts: [{ text: system }] } : undefined,
            contents: [{ role: "user", parts }],
            generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.6 },
          }),
        }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as const);
        if (res.ok) {
          const j: any = await (res as Response).json();
          const text: string = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
          try {
            return JSON.parse(text) as T;
          } catch {
            errs.push(`${model} returned non-JSON output`);
            break;
          }
        }
        const body = await res.text();
        const msg = /"message":\s*"([^"]+)/.exec(body)?.[1] ?? body.slice(0, 160);
        errs.push(`${model}: ${res.status} ${msg}`);
        if (res.status === 503 || res.status === 429 || res.status === 500) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue; // overloaded: retry, then fall through to next model
        }
        if (res.status === 401 || res.status === 403) throw new Error(`Gemini rejected the API key (${res.status}).`);
        break; // 404 etc: try next model
      }
    }
    throw new Error(`Gemini unavailable. ${errs.slice(-3).join(" | ")}`);
  };
}

const SHOT_TYPES = ["EWS", "WS", "MWS", "MS", "MCU", "CU", "ECU", "OTS", "POV", "INSERT"];
const MOVES = ["Static", "Pan", "Tilt", "Dolly in", "Dolly out", "Truck", "Crane up", "Crane down", "Handheld", "Orbit"];

export const planSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    shots: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Short slug, e.g. 'Hero walks in'" },
          type: { type: "STRING", enum: SHOT_TYPES },
          movement: { type: "STRING", enum: MOVES },
          lensMm: { type: "NUMBER" },
          durationSec: { type: "NUMBER" },
          description: { type: "STRING", description: "What the camera sees and does, one or two sentences" },
        },
        required: ["name", "type", "movement", "lensMm", "durationSec", "description"],
      },
    },
  },
  required: ["title", "shots"],
};

export const critiqueSchema = {
  type: "OBJECT",
  properties: {
    score: { type: "NUMBER", description: "Framing/composition score 1-10" },
    suggestedName: { type: "STRING" },
    shotType: { type: "STRING", enum: SHOT_TYPES },
    summary: { type: "STRING", description: "One sentence verdict" },
    suggestions: { type: "ARRAY", items: { type: "STRING" }, description: "2-4 concrete, actionable camera notes" },
  },
  required: ["score", "suggestedName", "shotType", "summary", "suggestions"],
};

export const reviewSchema = {
  type: "OBJECT",
  properties: {
    verdict: { type: "STRING", description: "Two sentence overall read of the sequence" },
    notes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { shot: { type: "NUMBER" }, note: { type: "STRING" } },
        required: ["shot", "note"],
      },
    },
    missingShots: { type: "ARRAY", items: { type: "STRING" }, description: "Coverage the editor will wish they had" },
  },
  required: ["verdict", "notes", "missingShots"],
};

export const SYSTEM_DP =
  "You are an experienced director of photography and storyboard artist helping a filmmaker pre-visualise " +
  "scenes inside a 3D Gaussian-splat scan of a real location. Be concrete and use standard film language " +
  "(shot sizes, lens choices in 35mm-equivalent mm, camera moves, rule of thirds, headroom, lead room, 180-degree rule). " +
  "Keep every string short enough to fit on a storyboard card.";
