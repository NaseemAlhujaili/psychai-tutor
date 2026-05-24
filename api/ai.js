/**
 * /api/ai.js — Unified secure AI route for PsychAI Tutor
 *
 * Handles: osce | ddx | mcq | mse
 * Model:   gpt-4o-mini (OpenAI)
 * Security: OPENAI_API_KEY is server-side only. Never in frontend.
 * Auth:    Caller must provide a valid Supabase JWT in Authorization header.
 * Limits:  5 requests/user/day per feature, tracked in Supabase ai_usage table.
 */

import { checkUsage, incrementUsage, DAILY_LIMITS } from "./_usageLimit.js";

const OPENAI_KEY     = process.env.OPENAI_API_KEY;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_ANON  = process.env.SUPABASE_ANON_KEY;

const MODEL          = "gpt-4o-mini";
const TIMEOUT_MS     = 30_000;

// ── Verify the caller's Supabase JWT and return the user id ──────────────────
async function verifyUser(authHeader) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);

  if (!SUPABASE_URL || !SUPABASE_ANON) return null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      "apikey":        SUPABASE_ANON,
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data?.id ?? null;
}

// ── Call OpenAI with a timeout ────────────────────────────────────────────────
async function callOpenAI(systemPrompt, messages, maxTokens = 1200) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      signal:  controller.signal,
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model:       MODEL,
        max_tokens:  maxTokens,
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 429 || res.status === 402) {
        throw new Error("QUOTA_EXCEEDED");
      }
      throw new Error(`OpenAI ${res.status}: ${body?.error?.message ?? "unknown"}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

// ── Feature-specific system prompts ──────────────────────────────────────────
function getSystemPrompt(feature, meta = {}) {
  switch (feature) {
    case "osce":
      return `You are roleplaying as ${meta.patientName ?? "a patient"} in a psychiatry OSCE station.
Station: ${meta.stationTitle ?? "General psychiatry"}
Diagnosis: ${meta.diagnosis ?? "Unknown — do not reveal"}
Persona: ${meta.persona ?? "You are a distressed patient seeking help."}

RULES:
- Stay fully in character as the patient at all times.
- Do NOT reveal your diagnosis to the student unless directly asked in a feedback phase.
- Respond naturally and emotionally, consistent with your presentation.
- Keep responses under 80 words unless the student asks something complex.
- Show appropriate affect: distress, hesitation, or guardedness as fits the role.
- If asked about medications or clinical advice, respond as a patient would ("I don't know, the doctor said...").`;

    case "ddx":
      return `You are a psychiatry clinical reasoning tutor.
Generate a structured differential diagnosis for a psychiatry clerkship student.
Return ONLY valid JSON (no markdown, no prose), exactly this structure:
{
  "summary": "2-sentence clinical summary",
  "differentials": [
    {
      "rank": 1,
      "diagnosis": "Diagnosis name",
      "probability": "High/Moderate/Low",
      "reasoning": "2-3 sentences why this fits",
      "supporting": ["finding 1", "finding 2"],
      "against": ["feature arguing against"],
      "key_discriminating_question": "single most useful next question",
      "dsm5_criteria_met": "which DSM-5 criteria the presentation satisfies",
      "initial_management": "first-line management if confirmed"
    }
  ],
  "organic_concerns": ["organic cause to exclude"],
  "emergency_flags": ["immediate safety concern if any"],
  "recommended_investigations": ["investigation 1", "investigation 2"],
  "safety_assessment": "brief risk comment"
}
Include 4-6 differentials ranked by likelihood. This is EDUCATIONAL content only — not clinical advice.`;

    case "mcq":
      return `You are a psychiatry exam question writer for medical students preparing for USMLE Step 2 and MRCPsych.
Generate a single high-quality multiple-choice question.
Return ONLY valid JSON (no markdown, no preamble):
{
  "q": "Full question stem (clinical vignette style, 3-5 sentences)",
  "options": ["A. option", "B. option", "C. option", "D. option", "E. option"],
  "answer": "A",
  "explanation": "3-4 sentence explanation of why the correct answer is right and distractors are wrong",
  "learning_point": "The key clinical teaching point in one sentence",
  "topic": "${meta.topic ?? "Psychiatry"}"
}
Rules: Use clinical vignette format. Avoid trick questions. Distractors must be plausible. Do not repeat questions already seen (vary the clinical scenario).`;

    case "mse":
      return `You are a psychiatry clinical educator evaluating a medical student's Mental Status Examination (MSE) write-up.
Provide structured educational feedback.
Return ONLY valid JSON (no markdown, no preamble):
{
  "overallScore": <0-100>,
  "overallGrade": "Excellent/Good/Satisfactory/Needs Improvement",
  "domainFeedback": {
    "appearance":      "feedback",
    "behaviour":       "feedback",
    "speech":          "feedback",
    "mood":            "feedback",
    "affect":          "feedback",
    "thought_process": "feedback",
    "thought_content": "feedback",
    "perception":      "feedback",
    "cognition":       "feedback",
    "insight":         "feedback",
    "judgment":        "feedback"
  },
  "missedElements": ["missing finding 1", "missing finding 2"],
  "exemplarPhrase": "example of how a key finding could be better expressed",
  "clinicalReasoningFeedback": "2-3 sentences on whether MSE findings support the expected diagnosis",
  "improvements": ["improvement 1", "improvement 2", "improvement 3"]
}`;

    default:
      throw new Error(`Unknown feature: ${feature}`);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  // ── 1. Verify user ─────────────────────────────────────────
  const userId = await verifyUser(req.headers.authorization);
  if (!userId) {
    return res.status(401).json({
      error: "Please log in to use AI features.",
      code:  "NOT_AUTHENTICATED",
    });
  }

  // ── 2. Parse request ───────────────────────────────────────
  const { feature, messages, meta } = req.body ?? {};
  if (!feature || !messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "feature and messages[] are required" });
  }
  if (!["osce","ddx","mcq","mse"].includes(feature)) {
    return res.status(400).json({ error: `Unknown feature: ${feature}` });
  }

  // ── 3. Check daily usage limit ─────────────────────────────
  let usage;
  try {
    usage = await checkUsage(userId, feature);
  } catch (e) {
    console.error("Usage check error:", e);
    // Fail open — don't block the user if usage check itself errors
    usage = { allowed: true, used: 0, limit: DAILY_LIMITS[feature], remaining: DAILY_LIMITS[feature] };
  }

  if (!usage.allowed) {
    return res.status(429).json({
      error:     "You have reached today's AI practice limit. Please try again tomorrow.",
      code:      "DAILY_LIMIT_REACHED",
      used:      usage.used,
      limit:     usage.limit,
      remaining: 0,
    });
  }

  // ── 4. Call OpenAI ─────────────────────────────────────────
  const systemPrompt = getSystemPrompt(feature, meta ?? {});

  let aiText;
  try {
    aiText = await callOpenAI(systemPrompt, messages, feature === "osce" ? 200 : 1400);
  } catch (err) {
    console.error("OpenAI error:", err.message);
    if (err.message === "QUOTA_EXCEEDED") {
      return res.status(503).json({
        error: "AI service is temporarily unavailable. Please try again later.",
        code:  "QUOTA_EXCEEDED",
      });
    }
    if (err.name === "AbortError") {
      return res.status(504).json({
        error: "AI request timed out. Please try again.",
        code:  "TIMEOUT",
      });
    }
    return res.status(500).json({
      error: "AI service is temporarily unavailable. Please try again later.",
      code:  "AI_ERROR",
    });
  }

  // ── 5. Increment usage counter ─────────────────────────────
  try {
    await incrementUsage(userId, feature);
  } catch (e) {
    console.error("Usage increment error:", e);
    // Don't fail the request if counter fails
  }

  // ── 6. Return response ─────────────────────────────────────
  return res.status(200).json({
    text:      aiText,
    used:      (usage.used ?? 0) + 1,
    limit:     usage.limit,
    remaining: Math.max(0, (usage.remaining ?? usage.limit) - 1),
  });
}
