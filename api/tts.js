/**
 * /api/tts.js — Secure text-to-speech via OpenAI TTS API
 *
 * - OPENAI_API_KEY stays server-side only. Never exposed to the browser.
 * - Returns audio/mpeg stream directly.
 * - Hard limits on text length to control cost.
 * - Only used for OSCE patient responses — not for examiner feedback.
 */

const OPENAI_KEY  = process.env.OPENAI_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;

const MAX_TTS_CHARS = 800;
const TIMEOUT_MS    = 20_000;

// OpenAI TTS voices — all support the same languages
// alloy: neutral  | echo: male warm  | fable: expressive
// onyx: deep male | nova: warm female | shimmer: soft female
const VOICE_MAP = {
  Psychosis:   "echo",     // guarded, lower energy
  Depression:  "nova",     // warm, slower natural pacing
  Mania:       "fable",    // expressive, energetic
  OCD:         "shimmer",  // soft, anxious quality
  Anxiety:     "shimmer",  // soft, worried quality
  default:     "alloy",
};

// Speed map — OpenAI TTS accepts 0.25–4.0 (1.0 = normal)
const SPEED_MAP = {
  Psychosis:  0.90,   // slightly slower, guarded
  Depression: 0.85,   // notably slower, low energy
  Mania:      1.20,   // faster, energetic
  OCD:        0.95,   // slightly hesitant
  Anxiety:    1.00,   // normal but tense
  default:    1.00,
};

async function verifyUser(authHeader) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "apikey": SUPABASE_ANON, "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

// Shorten text to spoken version if over limit
// Keeps the first sentence(s) up to MAX_TTS_CHARS
function shortenForSpeech(text, maxChars, isArabic) {
  if (!text || text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  // Sentence boundaries — include Arabic punctuation
  const endings = isArabic
    ? ["؟ ", "! ", ". ", "، ", ".
"]   // Arabic question mark, stops, comma
    : [". ", "! ", "? ", ".
"];
  const lastBoundary = Math.max(...endings.map(e => truncated.lastIndexOf(e)));
  if (lastBoundary > maxChars * 0.5) {
    return truncated.slice(0, lastBoundary + 1).trimEnd();
  }
  // Fall back to word/space boundary
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > 0 ? truncated.slice(0, lastSpace) + "…" : truncated + "…";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  // 1. Auth check
  const userId = await verifyUser(req.headers.authorization);
  if (!userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  // 2. Parse body
  const { text, category, lang } = req.body ?? {};
  const isArabic = lang === "ar";
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "text is required" });
  }
  if (!OPENAI_KEY) {
    console.error("[tts] OPENAI_API_KEY not configured");
    return res.status(503).json({ error: "TTS service not configured" });
  }

  // 3. Select voice and speed for this station category
  const voice = VOICE_MAP[category] ?? VOICE_MAP.default;
  const speed = SPEED_MAP[category] ?? SPEED_MAP.default;

  // 4. Shorten text if needed (cost control)
  const spokenText = shortenForSpeech(text.trim(), MAX_TTS_CHARS, isArabic);
  console.log("[tts] category:", category, "| lang:", lang ?? "en", "| voice:", voice,
              "| speed:", speed, "| chars:", spokenText.length, "(original:", text.length, ")");

  // 5. Call OpenAI TTS
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/audio/speech", {
      method:  "POST",
      signal:  controller.signal,
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: "tts-1",          // tts-1 = fast/cheap; tts-1-hd = higher quality
        input: spokenText,
        voice,
        speed,
        response_format: "mp3",
      }),
    });

    if (!openaiRes.ok) {
      const errBody = await openaiRes.json().catch(() => ({}));
      console.error("[tts] OpenAI error:", openaiRes.status, JSON.stringify(errBody).slice(0, 200));
      return res.status(502).json({
        error: "TTS generation failed",
        detail: errBody?.error?.message ?? String(openaiRes.status),
      });
    }

    // 6. Stream audio back to client
    const audioBuffer = await openaiRes.arrayBuffer();
    clearTimeout(timer);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.byteLength);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).end(Buffer.from(audioBuffer));

  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      console.error("[tts] Request timed out");
      return res.status(504).json({ error: "TTS request timed out" });
    }
    console.error("[tts] Unexpected error:", err.message);
    return res.status(500).json({ error: "TTS service error" });
  }
}
