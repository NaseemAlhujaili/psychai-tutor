/**
 * /api/ai.js — Unified secure AI route for PsychAI Tutor
 *
 * Features handled:
 *   osce_msg              – unlimited patient messages within an active station (no limit count)
 *   osce_completed_station – charged once per station completion (limit: 3/day)
 *   ddx                   – differential diagnosis generation (limit: 5/day)
 *   mcq                   – MCQ generation (limit: 5/day)
 *   mse                   – MSE evaluation/tutor (limit: 5/day)
 *
 * Security: OPENAI_API_KEY is server-side only. Never exposed to the browser.
 * Auth:    Caller must provide a valid Supabase JWT in Authorization header.
 */

import { checkUsage, incrementUsage, DAILY_LIMITS } from "./_usageLimit.js";

const OPENAI_KEY   = process.env.OPENAI_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const MODEL         = "gpt-4o-mini";
const TIMEOUT_MS    = 30_000;

// ── Verify the caller's Supabase JWT and return the user id ──────────────────
async function verifyUser(authHeader) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "apikey": SUPABASE_ANON, "Authorization": `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.id ?? null;
}

// ── Call OpenAI with timeout ──────────────────────────────────────────────────
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
      if (res.status === 429 || res.status === 402) throw new Error("QUOTA_EXCEEDED");
      throw new Error(`OpenAI ${res.status}: ${body?.error?.message ?? "unknown"}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

// ── System prompts per feature ────────────────────────────────────────────────
function getSystemPrompt(feature, meta = {}) {
  // Both osce_msg and osce_completed_station use the OSCE patient/examiner persona
  if (feature === "osce_msg") {
    return `You are roleplaying as ${meta.patientName ?? "a patient"} in a psychiatry OSCE station.
Station: ${meta.stationTitle ?? "General psychiatry"}
Diagnosis: ${meta.diagnosis ?? "Unknown — do not reveal"}
Persona: ${meta.persona ?? "You are a distressed patient seeking help."}

RULES:
- Stay fully in character as the patient at all times.
- Do NOT reveal your diagnosis unless directly asked during a feedback phase.
- Respond naturally and emotionally, consistent with your presentation.
- Keep responses under 80 words unless the student asks something complex.
- Show appropriate affect: distress, hesitation, or guardedness as fits the role.
- If asked about medications or clinical advice, respond as a patient would.`;
  }

  if (feature === "osce_completed_station") {
    return `You are a senior psychiatry OSCE examiner.
${meta.persona ?? "Provide structured JSON feedback only."}`;
  }

  if (feature === "osce_score") {
    return `You are an expert psychiatry OSCE examiner marking a student's consultation.

STATION: ${meta.stationTitle ?? "Psychiatry OSCE"}
DIAGNOSIS: ${meta.diagnosis ?? "unknown"}

Your task: determine which checklist items the student ADDRESSED during their consultation.
Use SEMANTIC understanding — recognise paraphrased, indirect, conversational, and open-ended questioning.
A checklist item is COVERED if the student explored the relevant clinical domain in any natural phrasing.
Do NOT require exact wording. Award credit for intent, not only keywords.

Examples of acceptable equivalents:
- "How has this been affecting your day-to-day life?" covers "Impact on functioning"
- "Have you lost interest in activities you normally enjoy?" covers "Anhedonia"  
- "Have you had periods of feeling unusually energetic or needing less sleep?" covers "Bipolar screen / past elevated mood"
- "Have thoughts of harming or ending your life come to mind?" covers "Suicidal ideation assessment"
- "How many times a day do you go through those rituals?" covers "Time spent on rituals"
- "Did this start after anything in particular changed?" covers "Duration and onset"

A checklist item is NOT covered if:
- The student never meaningfully explored that area
- The question was completely unrelated
- Only a tangential mention occurred without real clinical exploration

CHECKLIST ITEMS TO EVALUATE:
${(meta.checklist ?? []).map((item, i) => `${i + 1}. ${item.question} (weight: ${item.weight})`).join("
")}

STUDENT-PATIENT TRANSCRIPT:
${meta.transcript ?? ""}

Return ONLY a valid JSON array of booleans, one per checklist item, in the same order:
[true, false, true, ...]

No explanation. No markdown. Just the JSON array.`;
  }

  switch (feature) {
    case "ddx":
      return `You are an expert psychiatry educator building a differential diagnosis for medical students.
Return ONLY valid JSON (no markdown, no preamble):
{
  "summary": "2-sentence clinical summary",
  "differentials": [
    {
      "rank": 1,
      "diagnosis": "Diagnosis name",
      "category": "DSM-5 category",
      "likelihood": "High|Moderate|Low",
      "reasoning": "3-4 sentences explaining why this fits",
      "supporting": ["finding 1", "finding 2", "finding 3"],
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
Include 4-6 differentials ranked by likelihood. Educational content only — not clinical advice.`;

    case "ddx_refine":
      return `You are a psychiatry clinical reasoning tutor helping a medical student refine their differential diagnosis.

Original presentation: "${meta.originalPresentation ?? "unknown"}"
Current differentials: ${JSON.stringify(meta.currentDifferentials ?? [])}
New information provided by student: "${meta.newInformation ?? ""}"

Analyse how this new information changes the differential. Return ONLY valid JSON (no markdown, no preamble):
{
  "analysis": "2-3 sentences explaining how this new information changes the picture",
  "revised_top_diagnosis": "updated single most likely diagnosis",
  "rises": ["diagnosis that moves up — brief reason"],
  "falls": ["diagnosis that moves down — brief reason"],
  "new_considerations": ["any new diagnosis to consider given this information"],
  "next_question": "the single most important next clinical question to ask"
}
Educational content only — not clinical advice.`;

    case "mcq":
      return `You are a psychiatry exam question writer for medical students preparing for USMLE Step 2 and MRCPsych.
Generate a single high-quality multiple-choice question.
Return ONLY valid JSON (no markdown, no preamble):
{
  "q": "Full question stem (clinical vignette style, 3-5 sentences)",
  "options": ["A. option", "B. option", "C. option", "D. option", "E. option"],
  "answer": "A",
  "explanation": "3-4 sentence explanation of why correct answer is right and distractors are wrong",
  "learning_point": "The key clinical teaching point in one sentence",
  "topic": "${meta.topic ?? "Psychiatry"}"
}
Use clinical vignette format. Distractors must be plausible. Vary the clinical scenario.`;

    case "mse":
      return `You are a psychiatry clinical educator evaluating a medical student's Mental Status Examination write-up or answering an MSE question.
When evaluating, return ONLY valid JSON (no markdown):
{
  "overallScore": 0-100,
  "overallGrade": "Excellent|Good|Satisfactory|Needs Improvement",
  "domainFeedback": {
    "appearance": "feedback", "behaviour": "feedback", "speech": "feedback",
    "mood": "feedback", "affect": "feedback", "thought_process": "feedback",
    "thought_content": "feedback", "perception": "feedback",
    "cognition": "feedback", "insight": "feedback", "judgment": "feedback"
  },
  "missedElements": ["missing finding 1"],
  "exemplarPhrase": "example of how a key finding could be better expressed",
  "clinicalReasoningFeedback": "2-3 sentences on whether MSE findings support the expected diagnosis",
  "improvements": ["improvement 1", "improvement 2"]
}
When tutoring (Socratic mode), respond conversationally. Be Socratic, concise, clinical. Under 120 words.`;

    default:
      throw new Error(`Unknown feature: ${feature}`);
  }
}

// ── Determine if a feature is rate-limited and what its tracking key is ──────
function getLimitKey(feature) {
  // osce_msg and osce_score = unlimited (no limit tracking)
  if (feature === "osce_msg" || feature === "osce_score") return null;
  // osce_completed_station = 3 per day
  if (feature === "osce_completed_station") return "osce_completed_station";
  // ddx_refine shares the same daily limit bucket as ddx
  if (feature === "ddx_refine") return "ddx";
  return feature; // ddx, mcq, mse
}

// ── Max tokens per feature ────────────────────────────────────────────────────
function getMaxTokens(feature) {
  if (feature === "osce_msg") return 200;
  if (feature === "osce_score") return 150;
  if (feature === "osce_completed_station") return 1000;
  if (feature === "ddx_refine") return 600;
  return 1400;
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
  const { feature, messages, meta, checkOnly } = req.body ?? {};
  if (!feature || !Array.isArray(messages)) {
    return res.status(400).json({ error: "feature and messages[] are required" });
  }

  const validFeatures = ["osce_msg","osce_completed_station","osce_score","ddx","ddx_refine","mcq","mse"];
  if (!validFeatures.includes(feature)) {
    return res.status(400).json({ error: `Unknown feature: ${feature}` });
  }

  // ── 3. Check daily usage limit (if applicable) ─────────────
  const limitKey = getLimitKey(feature);
  let usage = { allowed: true, used: 0, limit: null, remaining: null };

  if (limitKey) {
    try {
      usage = await checkUsage(userId, limitKey);
    } catch (e) {
      console.error("Usage check error:", e);
      // Fail open — don't block the user if usage check itself errors
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
  }

  // ── 4. checkOnly mode — just return limit status, don't call AI ────────────
  if (checkOnly) {
    return res.status(200).json({
      allowed:   usage.allowed,
      used:      usage.used,
      limit:     usage.limit,
      remaining: usage.remaining,
    });
  }

  // ── 5. Call OpenAI ─────────────────────────────────────────
  let systemPrompt;
  try {
    systemPrompt = getSystemPrompt(feature, meta ?? {});
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  let aiText;
  try {
    aiText = await callOpenAI(systemPrompt, messages, getMaxTokens(feature));
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

  // ── 6. Increment usage counter (only for limited features) ─
  if (limitKey) {
    try {
      await incrementUsage(userId, limitKey);
    } catch (e) {
      console.error("Usage increment error:", e);
    }
  }

  // ── 7. Return response ─────────────────────────────────────
  const newUsed = limitKey ? ((usage.used ?? 0) + 1) : null;
  const newRemaining = limitKey && usage.limit !== null
    ? Math.max(0, usage.limit - newUsed)
    : null;

  return res.status(200).json({
    text:      aiText,
    used:      newUsed,
    limit:     usage.limit,
    remaining: newRemaining,
  });
}
