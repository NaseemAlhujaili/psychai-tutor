/**
 * /api/ai.js — Unified secure AI route for PsychAI Tutor
 *
 * Features:
 *   osce_msg              – patient messages, unlimited
 *   osce_completed_station – examiner feedback, 3/day
 *   osce_score            – semantic checklist, unlimited, no crash if fails
 *   ddx / ddx_refine      – differential diagnosis, 5/day
 *   mcq                   – MCQ generation, 5/day
 *   mse                   – MSE evaluation, 5/day
 */

import { checkUsage, incrementUsage, DAILY_LIMITS } from "./_usageLimit.js";

const OPENAI_KEY    = process.env.OPENAI_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const MODEL         = "gpt-4o-mini";
const TIMEOUT_MS    = 30_000;

// ── Verify Supabase JWT ───────────────────────────────────────────────────────
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
  } catch (e) {
    console.error("verifyUser error:", e.message);
    return null;
  }
}

// ── Call OpenAI ───────────────────────────────────────────────────────────────
async function callOpenAI(systemPrompt, messages, maxTokens = 1200, temperature = 0.7) {
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
        temperature,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error("OpenAI non-OK:", res.status, JSON.stringify(body).slice(0, 300));
      if (res.status === 429 || res.status === 402) throw new Error("QUOTA_EXCEEDED");
      throw new Error(`OpenAI ${res.status}: ${body?.error?.message ?? "unknown"}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    console.log("OpenAI response length:", text.length, "chars");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// ── System prompts ────────────────────────────────────────────────────────────
function getSystemPrompt(feature, meta) {
  const m = meta ?? {};

  if (feature === "osce_msg") {
    const isArabic = m.lang === "ar";

    if (isArabic) {
      return [
        "====================================================",
        "LANGUAGE MANDATE — أهم شيء — READ FIRST:",
        "You MUST reply ONLY in natural Saudi/GCC colloquial Arabic (العامية السعودية/الخليجية).",
        "NEVER write a single word in English.",
        "NEVER use formal Modern Standard Arabic (الفصحى).",
        "====================================================",
        "",
        "You are roleplaying as " + (m.patientName ?? "a patient") + "، a patient visiting a psychiatrist.",
        "Station context: " + (m.stationTitle ?? "General psychiatry"),
        "IMPORTANT: Do NOT reveal your diagnosis at any point.",
        "Persona: " + (m.persona ?? "You are a distressed patient."),
        "",
        "HOW TO SPEAK — CRITICAL STYLE RULES:",
        "- Use short, natural, everyday Gulf Arabic phrases — 1 to 3 sentences max.",
        "- Sound like a real person talking to a doctor, not a textbook.",
        "- Use expressions like: ما أنام زين، مالي خلق، أحس بضيقة، أفكر كثير، صرت أعصب بسرعة، ما أدري وش فيني، نفسيتي مو زينة",
        "- Vary your phrasing — don't repeat the same expression twice.",
        "- Show emotion through word choice, not length.",
        "- Avoid long explanations — patients in real clinics speak in short bursts.",
        "",
        "PATIENT RULES:",
        "- Stay in character throughout.",
        "- Never give clinical information or diagnoses.",
        "- If the student asks in English, respond in Arabic.",
        "- Reply in Arabic ONLY. No English. No formal Arabic.",
      ].join("\n");
    }

    // English mode (default)
    return [
      "You are roleplaying as " + (m.patientName ?? "a patient") + " in a psychiatry OSCE.",
      "Station: " + (m.stationTitle ?? "General psychiatry"),
      "Diagnosis: " + (m.diagnosis ?? "unknown — do not reveal"),
      "Persona: " + (m.persona ?? "You are a distressed patient."),
      "",
      "RULES:",
      "- Stay in character as the patient. Never reveal your diagnosis.",
      "- Respond naturally with appropriate emotion.",
      "- Keep responses under 80 words.",
      "- Respond as a patient would — not as a clinician.",
      "- Respond in English.",
    ].join("\n");
  }

  if (feature === "osce_completed_station") {
    return "You are a senior psychiatry OSCE examiner.\n" +
           (m.persona ?? "Provide structured JSON feedback only.");
  }

  if (feature === "osce_score") {
    const checklistLines = (Array.isArray(m.checklist) ? m.checklist : [])
      .map(function(item, i) {
        return (i + 1) + ". " + String(item.question ?? "") + " (weight: " + String(item.weight ?? 1) + ")";
      })
      .join("\n");

    const transcript = String(m.transcript ?? "").slice(0, 6000);

    return [
      "You are a psychiatry OSCE examiner evaluating checklist coverage.",
      "Station: " + String(m.stationTitle ?? "Psychiatry OSCE"),
      "Diagnosis: " + String(m.diagnosis ?? "unknown"),
      "",
      "TASK: Decide which checklist items the student meaningfully addressed.",
      "Use SEMANTIC understanding — paraphrase, indirect questioning, and natural",
      "clinical language all count. Award credit for intent, not exact wording.",
      "",
      "BILINGUAL SCORING — award credit for BOTH Arabic and English questions:",
      "English: 'How has this affected your daily life?' covers 'Impact on functioning'",
      "Arabic:  'كيف أثّر هذا على حياتك اليومية؟' covers 'Impact on functioning'",
      "English: 'Have you lost interest in things you enjoy?' covers 'Anhedonia'",
      "Arabic:  'هل توقفت عن الاستمتاع بالأشياء اللي كنت تحبها؟' covers 'Anhedonia'",
      "English: 'Have thoughts of ending your life crossed your mind?' covers 'Suicidal ideation'",
      "Arabic:  'هل عندك أفكار انتحارية؟' or 'تفكر تأذي نفسك؟' covers 'Suicidal ideation'",
      "English: 'Have you felt unusually energetic or needed less sleep?' covers 'Bipolar screen'",
      "Arabic:  'هل مريت بفترة حسيت بطاقة زيادة وما احتجت نوم؟' covers 'Bipolar screen'",
      "English: 'Do you hear things others can't hear?' covers 'Hallucinations'",
      "Arabic:  'هل تسمع أصوات ما يسمعها غيرك؟' covers 'Hallucinations'",
      "",
      "CRITICAL: Award the same checklist credit whether the student asked in Arabic OR English.",
      "DO NOT award credit if the student never meaningfully explored the area.",
      "",
      "CHECKLIST ITEMS:",
      checklistLines,
      "",
      "TRANSCRIPT:",
      transcript,
      "",
      "Return ONLY a JSON array of booleans, one per checklist item, in order.",
      "Example for 3 items: [true, false, true]",
      "No explanation. No markdown. Just the array.",
    ].join("\n");
  }

  switch (feature) {
    case "ddx":
      return [
        "You are an expert psychiatry educator generating a differential diagnosis for medical students.",
        "Return ONLY valid JSON (no markdown, no preamble):",
        JSON.stringify({
          summary: "2-sentence clinical summary",
          differentials: [{
            rank: 1, diagnosis: "Name", category: "DSM-5 category",
            likelihood: "High|Moderate|Low",
            reasoning: "3-4 sentences",
            supporting: ["finding"], against: ["finding"],
            key_discriminating_question: "question",
            dsm5_criteria_met: "criteria",
            initial_management: "management"
          }],
          organic_concerns: ["concern"],
          emergency_flags: ["flag"],
          recommended_investigations: ["investigation"],
          safety_assessment: "brief comment"
        }, null, 2),
        "Include 4-6 differentials. Educational content only — not clinical advice.",
      ].join("\n");

    case "ddx_refine":
      return [
        "You are a psychiatry clinical reasoning tutor.",
        "Original presentation: " + JSON.stringify(m.originalPresentation ?? ""),
        "Current differentials: " + JSON.stringify(m.currentDifferentials ?? []),
        "New information: " + JSON.stringify(m.newInformation ?? ""),
        "",
        "Analyse how the new information changes the differential.",
        "Return ONLY valid JSON (no markdown):",
        JSON.stringify({
          analysis: "2-3 sentences",
          revised_top_diagnosis: "diagnosis",
          rises: ["diagnosis — reason"],
          falls: ["diagnosis — reason"],
          new_considerations: ["new diagnosis"],
          next_question: "most important next question"
        }, null, 2),
        "Educational content only.",
      ].join("\n");

    case "mcq":
      return [
        "You are a psychiatry exam question writer for USMLE Step 2 and MRCPsych.",
        "Generate a single high-quality MCQ. Topic: " + String(m.topic ?? "Psychiatry"),
        "Return ONLY valid JSON (no markdown):",
        JSON.stringify({
          q: "Question stem (clinical vignette, 3-5 sentences)",
          options: ["A. option", "B. option", "C. option", "D. option", "E. option"],
          answer: "A",
          explanation: "3-4 sentence explanation",
          learning_point: "Key teaching point",
          topic: m.topic ?? "Psychiatry"
        }, null, 2),
        "Use clinical vignette format. Vary the scenario.",
      ].join("\n");

    case "mse":
      return [
        "You are a psychiatry clinical educator evaluating an MSE write-up or answering MSE questions.",
        "When evaluating, return ONLY valid JSON (no markdown):",
        JSON.stringify({
          overallScore: 0,
          overallGrade: "Excellent|Good|Satisfactory|Needs Improvement",
          domainFeedback: {
            appearance: "feedback", behaviour: "feedback", speech: "feedback",
            mood: "feedback", affect: "feedback", thought_process: "feedback",
            thought_content: "feedback", perception: "feedback",
            cognition: "feedback", insight: "feedback", judgment: "feedback"
          },
          missedElements: ["missing"],
          exemplarPhrase: "better phrasing example",
          clinicalReasoningFeedback: "2-3 sentences",
          improvements: ["improvement"]
        }, null, 2),
        "When tutoring, respond conversationally. Be Socratic, concise, under 120 words.",
      ].join("\n");

    default:
      throw new Error("Unknown feature: " + feature);
  }
}

// ── Rate limit key ────────────────────────────────────────────────────────────
function getLimitKey(feature) {
  if (feature === "osce_msg" || feature === "osce_score") return null;
  if (feature === "osce_completed_station") return "osce_completed_station";
  if (feature === "ddx_refine") return "ddx";
  return feature;
}

// ── Max tokens and temperature ────────────────────────────────────────────────
function getMaxTokens(feature) {
  if (feature === "osce_msg")               return 200;
  if (feature === "osce_score")             return 200;
  if (feature === "osce_completed_station") return 1000;
  if (feature === "ddx_refine")             return 600;
  return 1400;
}

function getTemperature(feature, meta) {
  // Lower temperature for Arabic patient responses = more obedient language compliance
  if (feature === "osce_msg" && (meta?.lang === "ar")) return 0.5;
  return 0.7;
}

// ── Validate messages array ───────────────────────────────────────────────────
function sanitiseMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(m => m && typeof m.role === "string" && typeof m.content === "string")
    .filter(m => ["user", "assistant", "system"].includes(m.role))
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 8000) }));
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
    return res.status(401).json({ error: "Please log in to use AI features.", code: "NOT_AUTHENTICATED" });
  }

  // 2. Parse body
  let feature, messages, meta, checkOnly;
  try {
    ({ feature, messages, meta, checkOnly } = req.body ?? {});
  } catch (e) {
    console.error("Body parse error:", e.message);
    return res.status(400).json({ error: "Invalid request body" });
  }

  if (!feature) return res.status(400).json({ error: "feature is required" });

  const validFeatures = ["osce_msg","osce_completed_station","osce_score","ddx","ddx_refine","mcq","mse"];
  if (!validFeatures.includes(feature)) {
    return res.status(400).json({ error: "Unknown feature: " + feature });
  }

  const cleanMessages = sanitiseMessages(messages);
  const cleanMeta     = (meta && typeof meta === "object") ? meta : {};

  // Log language for debugging
  if (feature === "osce_msg") {
    console.log("[osce_msg] lang:", cleanMeta.lang ?? "en", "| patient:", cleanMeta.patientName);
  }

  // 3. Usage check
  const limitKey = getLimitKey(feature);
  let usage = { allowed: true, used: 0, limit: null, remaining: null };

  if (limitKey) {
    try {
      usage = await checkUsage(userId, limitKey);
    } catch (e) {
      console.error("Usage check error:", e.message);
    }
    if (!usage.allowed) {
      return res.status(429).json({
        error: "You have reached today's AI practice limit. Please try again tomorrow.",
        code: "DAILY_LIMIT_REACHED", used: usage.used, limit: usage.limit, remaining: 0,
      });
    }
  }

  // 4. checkOnly
  if (checkOnly) {
    return res.status(200).json({ allowed: usage.allowed, used: usage.used, limit: usage.limit, remaining: usage.remaining });
  }

  // 5. Build system prompt
  let systemPrompt;
  try {
    systemPrompt = getSystemPrompt(feature, cleanMeta);
    console.log("Feature:", feature, "| lang:", cleanMeta.lang ?? "en", "| Prompt length:", systemPrompt.length);
  } catch (e) {
    console.error("getSystemPrompt error:", e.message);
    return res.status(400).json({ error: e.message });
  }

  // 6. Call OpenAI with language-appropriate temperature
  const temperature = getTemperature(feature, cleanMeta);
  let aiText;
  try {
    aiText = await callOpenAI(systemPrompt, cleanMessages, getMaxTokens(feature), temperature);
  } catch (err) {
    console.error("callOpenAI error for feature", feature, ":", err.message);
    if (err.message === "QUOTA_EXCEEDED") {
      return res.status(503).json({ error: "AI service is temporarily unavailable. Please try again later.", code: "QUOTA_EXCEEDED" });
    }
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "AI request timed out. Please try again.", code: "TIMEOUT" });
    }
    return res.status(500).json({ error: "AI service is temporarily unavailable. Please try again later.", code: "AI_ERROR" });
  }

  // 7. Increment usage
  if (limitKey) {
    try {
      await incrementUsage(userId, limitKey);
    } catch (e) {
      console.error("Usage increment error:", e.message);
    }
  }

  // 8. Respond
  const newUsed = limitKey ? ((usage.used ?? 0) + 1) : null;
  const newRemaining = (limitKey && usage.limit !== null) ? Math.max(0, usage.limit - newUsed) : null;

  return res.status(200).json({ text: aiText, used: newUsed, limit: usage.limit, remaining: newRemaining });
}
