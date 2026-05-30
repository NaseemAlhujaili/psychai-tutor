/**
 * /api/tts.js — Secure OpenAI Text-to-Speech for PsychAI Tutor
 *
 * Security: OPENAI_API_KEY stays server-side only. Never exposed to browser.
 * Used only for OSCE patient replies during active consultation.
 * English and Arabic (UTF-8) are both supported.
 * Audio is never stored — streamed directly to the client.
 */

const OPENAI_KEY    = process.env.OPENAI_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;

const TTS_MODEL   = "tts-1";  // tts-1 = fast; tts-1-hd = higher quality
const MAX_TTS_CHARS = 600;
const TIMEOUT_MS    = 25_000;

// ── Voice and speed selection ─────────────────────────────────────────────────
//
// ARABIC: always use "alloy" at 1.0× speed regardless of station category.
//   "alloy" is the most reliably multilingual of OpenAI's six voices.
//   Other voices (echo, nova, fable, shimmer, onyx) mispronounce Arabic
//   and produce garbled output that sounds like a foreign language.
//   Speed adjustments further degrade Arabic pronunciation, so we fix at 1.0.
//
// ENGLISH: select voice/speed by station category for emotional tone.

const ARABIC_VOICE = "alloy";
const ARABIC_SPEED = 1.0;

const ENGLISH_VOICE_MAP = {
  Psychosis:  "echo",     // male, lower energy, guarded
  Depression: "nova",     // female, warm, slow
  Mania:      "fable",    // expressive, energetic
  OCD:        "shimmer",  // soft, hesitant
  Anxiety:    "shimmer",  // soft, worried
  default:    "alloy",
};

const ENGLISH_SPEED_MAP = {
  Psychosis:  0.90,
  Depression: 0.85,
  Mania:      1.15,
  OCD:        0.95,
  Anxiety:    1.00,
  default:    1.00,
};

// ── Auth ──────────────────────────────────────────────────────────────────────
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

// ── Sentence-boundary truncation ──────────────────────────────────────────────
// Trims to a natural break within maxChars.
// Arabic punctuation handled via unicode escapes — no literal newline bytes.
function shortenForSpeech(text, maxChars, isArabic) {
  if (!text || text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);

  let lastBoundary = -1;
  const endings = isArabic
    ? ["\u061F ", "! ", ". ", "\u060C "]   // ؟  !  .  ،
    : [". ", "! ", "? "];

  for (const e of endings) {
    const idx = truncated.lastIndexOf(e);
    if (idx > lastBoundary) lastBoundary = idx;
  }

  if (lastBoundary > maxChars * 0.4) {
    return truncated.slice(0, lastBoundary + 1).trimEnd();
  }

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

  // 2. Parse body
  const body     = req.body ?? {};
  const text     = typeof body.text     === "string" ? body.text.trim() : "";
  const category = typeof body.category === "string" ? body.category    : "default";
  const lang     = typeof body.lang     === "string" ? body.lang        : "en";
  const isArabic = lang === "ar";

  if (!text) {
    return res.status(400).json({ error: "text is required" });
  }
  if (!OPENAI_KEY) {
    console.error("[tts] OPENAI_API_KEY not configured");
    return res.status(503).json({ error: "TTS not configured" });
  }

  // 3. Select voice and speed — Arabic ALWAYS gets alloy + 1.0
  const voice      = isArabic ? ARABIC_VOICE : (ENGLISH_VOICE_MAP[category] ?? ENGLISH_VOICE_MAP.default);
  const speed      = isArabic ? ARABIC_SPEED : (ENGLISH_SPEED_MAP[category] ?? ENGLISH_SPEED_MAP.default);
  const spokenText = shortenForSpeech(text, MAX_TTS_CHARS, isArabic);

  // Full debug log — model, voice, language, first 100 chars of text sent
  console.log(
    "[tts] model=" + TTS_MODEL +
    " | voice=" + voice +
    " | lang=" + lang +
    " | isArabic=" + isArabic +
    " | category=" + category +
    " | speed=" + speed +
    " | chars=" + spokenText.length + "/" + text.length +
    " | text[0:100]=" + spokenText.slice(0, 100).replace(/\n/g, " ")
  );

  // 4. Call OpenAI TTS
  const controller = new AbortController();
  const timer = setTimeout(function() { controller.abort(); }, TIMEOUT_MS);

  try {
    const payload = JSON.stringify({
      model:           TTS_MODEL,
      input:           spokenText,   // only the patient reply text — no prompts or metadata
      voice:           voice,
      speed:           speed,
      response_format: "mp3",
    });

    console.log("[tts] Payload bytes (UTF-8):", Buffer.byteLength(payload, "utf8"));

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
      let errDetail = "HTTP " + openaiRes.status;
      try {
        const errBody = await openaiRes.json();
        errDetail = JSON.stringify(errBody).slice(0, 400);
      } catch (_) {}
      console.error("[tts] OpenAI error — status:", openaiRes.status, "| body:", errDetail);
      return res.status(502).json({
        error:  "TTS generation failed",
        detail: errDetail,
        status: openaiRes.status,
      });
    }

    // 5. Stream audio back to client
    const audioArrayBuffer = await openaiRes.arrayBuffer();
    const audioBuffer      = Buffer.from(audioArrayBuffer);

    console.log("[tts] Success — audio bytes:", audioBuffer.length, "| voice:", voice, "| lang:", lang);

    res.setHeader("Content-Type",   "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length);
    res.setHeader("Cache-Control",  "no-store");
    return res.status(200).end(audioBuffer);

  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      console.error("[tts] Timed out after", TIMEOUT_MS, "ms");
      return res.status(504).json({ error: "TTS request timed out" });
    }
    console.error("[tts] Unexpected error:", err.message);
    return res.status(500).json({ error: "TTS error: " + err.message });
  }
}
