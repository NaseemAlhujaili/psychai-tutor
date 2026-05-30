/**
 * /api/tts.js — Secure OpenAI Text-to-Speech for PsychAI Tutor
 *
 * Security: OPENAI_API_KEY is server-side only. Never exposed to the browser.
 * Used only for OSCE patient/informant replies during active consultation.
 * Supports English and Arabic (UTF-8). Does not store audio.
 */

const OPENAI_KEY    = process.env.OPENAI_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;

const MAX_TTS_CHARS = 600;  // keep responses short and cost-controlled
const TIMEOUT_MS    = 25_000;

// OpenAI TTS voice selection per station category
// All six OpenAI voices support multilingual text including Arabic
const VOICE_MAP = {
  Psychosis:  "echo",     // male, guarded tone
  Depression: "nova",     // female, warm and slow
  Mania:      "fable",    // expressive, energetic
  OCD:        "shimmer",  // soft, hesitant
  Anxiety:    "shimmer",  // soft, worried
  default:    "alloy",    // neutral
};

// Speed per station (0.25–4.0; 1.0 = normal)
const SPEED_MAP = {
  Psychosis:  0.90,
  Depression: 0.85,
  Mania:      1.15,
  OCD:        0.95,
  Anxiety:    1.00,
  default:    1.00,
};

// Verify Supabase JWT — keeps TTS behind auth wall
async function verifyUser(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;
  try {
    const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { "apikey": SUPABASE_ANON, "Authorization": "Bearer " + token },
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.id ? d.id : null;
  } catch (e) {
    console.error("[tts] verifyUser error:", e.message);
    return null;
  }
}

// Trim text to a natural sentence boundary within maxChars
// Handles Arabic punctuation correctly without any literal newline characters
function shortenForSpeech(text, maxChars, isArabic) {
  if (!text || text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);

  // Sentence-ending markers — use char codes, no embedded newlines
  let lastBoundary = -1;
  if (isArabic) {
    // Arabic: sentence ends with ؟ (U+061F), ! , . , ، (U+060C)
    const arEndings = ["\u061F ", "! ", ". ", "\u060C ", "? "];
    for (const e of arEndings) {
      const idx = truncated.lastIndexOf(e);
      if (idx > lastBoundary) lastBoundary = idx;
    }
  } else {
    const enEndings = [". ", "! ", "? "];
    for (const e of enEndings) {
      const idx = truncated.lastIndexOf(e);
      if (idx > lastBoundary) lastBoundary = idx;
    }
  }

  if (lastBoundary > maxChars * 0.4) {
    return truncated.slice(0, lastBoundary + 1).trimEnd();
  }

  // Fall back to whitespace boundary
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > 0 ? truncated.slice(0, lastSpace) + "\u2026" : truncated;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  // 1. Auth
  const userId = await verifyUser(req.headers.authorization);
  if (!userId) {
    console.error("[tts] Unauthenticated request");
    return res.status(401).json({ error: "Authentication required" });
  }

  // 2. Parse body — Vercel auto-parses JSON when Content-Type is application/json
  const body     = req.body ?? {};
  const text     = typeof body.text === "string" ? body.text.trim() : "";
  const category = typeof body.category === "string" ? body.category : "default";
  const lang     = typeof body.lang === "string" ? body.lang : "en";
  const isArabic = lang === "ar";

  // Validate
  if (!text) {
    return res.status(400).json({ error: "text is required" });
  }
  if (!OPENAI_KEY) {
    console.error("[tts] OPENAI_API_KEY not configured");
    return res.status(503).json({ error: "TTS not configured" });
  }

  // 3. Prepare text for speech
  const spokenText = shortenForSpeech(text, MAX_TTS_CHARS, isArabic);
  const voice      = VOICE_MAP[category] ?? VOICE_MAP.default;
  const speed      = SPEED_MAP[category] ?? SPEED_MAP.default;

  // Detailed server log for debugging
  console.log(
    "[tts] lang=" + lang +
    " | isArabic=" + isArabic +
    " | category=" + category +
    " | voice=" + voice +
    " | speed=" + speed +
    " | chars=" + spokenText.length + "/" + text.length +
    " | preview=" + spokenText.slice(0, 50).replace(/\n/g, " ")
  );

  // 4. Call OpenAI TTS
  const controller = new AbortController();
  const timer = setTimeout(function() { controller.abort(); }, TIMEOUT_MS);

  try {
    const payload = JSON.stringify({
      model:           "tts-1",
      input:           spokenText,
      voice:           voice,
      speed:           speed,
      response_format: "mp3",
    });

    console.log("[tts] Sending to OpenAI TTS, payload bytes:", Buffer.byteLength(payload, "utf8"));

    const openaiRes = await fetch("https://api.openai.com/v1/audio/speech", {
      method:  "POST",
      signal:  controller.signal,
      headers: {
        "Content-Type":  "application/json",
        "Authorization": "Bearer " + OPENAI_KEY,
      },
      body: payload,
    });

    clearTimeout(timer);

    if (!openaiRes.ok) {
      let errDetail = "status " + openaiRes.status;
      try {
        const errBody = await openaiRes.json();
        errDetail = JSON.stringify(errBody).slice(0, 300);
      } catch (_) {}
      console.error("[tts] OpenAI TTS error:", openaiRes.status, errDetail);
      return res.status(502).json({
        error:  "TTS generation failed",
        detail: errDetail,
        status: openaiRes.status,
      });
    }

    // 5. Read audio and return to client
    const audioArrayBuffer = await openaiRes.arrayBuffer();
    const audioBuffer      = Buffer.from(audioArrayBuffer);

    console.log("[tts] Success — audio bytes:", audioBuffer.length);

    res.setHeader("Content-Type",   "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length);
    res.setHeader("Cache-Control",  "no-store");
    return res.status(200).end(audioBuffer);

  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      console.error("[tts] Request timed out after", TIMEOUT_MS, "ms");
      return res.status(504).json({ error: "TTS request timed out" });
    }
    console.error("[tts] Unexpected error:", err.message);
    return res.status(500).json({ error: "TTS service error: " + err.message });
  }
}
