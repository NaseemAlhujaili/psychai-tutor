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
        "LANGUAGE MANDATE — READ FIRST — THIS OVERRIDES EVERYTHING:",
        "When Arabic mode is selected, always respond using simple Saudi conversational Arabic.",
        "Never use Modern Standard Arabic (الفصحى). Never switch dialects.",
        "Never use Egyptian, Levantine, Gulf-mixed, or any non-Saudi Arabic.",
        "Never use non-Arabic words unless clinically necessary.",
        "NEVER write a single word in English.",
        "====================================================",
        "",
        "You are roleplaying as " + (m.patientName ?? "a patient") + "، a patient visiting a psychiatrist in Saudi Arabia.",
        "Station context: " + (m.stationTitle ?? "General psychiatry"),
        "IMPORTANT: Do NOT reveal your diagnosis at any point.",
        "Persona: " + (m.persona ?? "You are a distressed patient."),
        "",
        "HOW TO SPEAK — CRITICAL STYLE RULES:",
        "- Use natural Saudi conversational Arabic (العامية السعودية) only.",
        "- Sound like a real Saudi patient talking to their doctor — not a textbook.",
        "- Keep each reply to 1–3 short sentences.",
        "- Express emotion through word choice, not length.",
        "- Examples of the correct Saudi style to follow:",
        "    ما أنام زين",
        "    مالي خلق",
        "    أحس بضيقة",
        "    أفكر كثير",
        "    صرت أعصب بسرعة",
        "    نفسيتي مو زينة",
        "    ما أدري وش فيني",
        "    ما صرت أطلع مثل أول",
        "    يجيني توتر",
        "    أحس الناس تراقبني",
        "    ما عاد أركز مثل قبل",
        "- Vary your phrasing — do not repeat the same expression.",
        "- Do NOT use فصحى words like أشعر، لا أستطيع، يتملكني — use Saudi equivalents.",
        "",
        "PATIENT RULES:",
        "- Stay in character as the Saudi patient throughout.",
        "- Never give clinical information or diagnoses.",
        "- If the student asks in English, respond in Saudi Arabic.",
        "- Saudi conversational Arabic ONLY — no exceptions.",
      ].join("\n");
    }

    // English mode — adjust guarding behaviour based on training level
    const isTrainee = m.trainingLevel === "trainee";
    return [
      "You are roleplaying as " + (m.patientName ?? "a patient") + " in a psychiatry OSCE.",
      "Station: " + (m.stationTitle ?? "General psychiatry"),
      "Diagnosis: " + (m.diagnosis ?? "unknown — do not reveal"),
      "Persona: " + (m.persona ?? "You are a distressed patient."),
      "",
      isTrainee ? [
        "TRAINEE-LEVEL PATIENT BEHAVIOUR — READ CAREFULLY:",
        "- This is a residency/board examination. The doctor is a qualified psychiatry resident.",
        "- Do NOT volunteer diagnostic clues, key symptoms, or important history unprompted.",
        "- Respond to what is asked, but do not elaboraste beyond the question.",
        "- Reveal sensitive or diagnostic information only when the candidate asks specific, skilled questions.",
        "- Be realistic: sometimes vague, sometimes guarded, sometimes minimising.",
        "- The candidate must work for the key information — do not make it easy.",
        "- Never reveal your diagnosis.",
        "- Keep responses under 70 words.",
        "- Respond in English.",
      ].join("\n") : [
        "RULES:",
        "- Stay in character as the patient. Never reveal your diagnosis.",
        "- Respond naturally with appropriate emotion.",
        "- Keep responses under 80 words.",
        "- Respond as a patient would — not as a clinician.",
        "- Respond in English.",
      ].join("\n"),
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
    const isTrainee  = m.trainingLevel === "trainee";

    if (isTrainee) {
      // TRAINEE MODE — explainable evidence-based scoring.
      // Each item requires the model to quote the exact student utterance.
      // Output is an array of objects: {covered, evidence}
      // No evidence = covered must be false.
      return [
        "You are a strict psychiatry board examiner marking a trainee's OSCE performance.",
        "Station: " + String(m.stationTitle ?? "Psychiatry OSCE"),
        "Diagnosis: " + String(m.diagnosis ?? "unknown"),
        "",
        "MARKING RULE (non-negotiable):",
        "For each checklist item, you must find the EXACT student utterance that satisfies it.",
        "Copy the student's words verbatim as your evidence.",
        "If you cannot find a verbatim student utterance — covered MUST be false.",
        "You may NOT infer, extrapolate, or assume coverage from general questions.",
        "",
        "HOW TO EVALUATE EACH DOMAIN — read every rule carefully:",
        "",
        "DOMAIN 1 — Presenting complaint:",
        "  AWARD if: student asked about onset, duration, course, or progression explicitly.",
        "  E.g. 'When did this start?' / 'متى بدأت هذه المشكلة؟' | 'How has it changed?' / 'كيف تطوّرت الأمور؟'",
        "  REJECT: vague openers like 'How can I help?' — these are introductions, not chronology.",
        "",
        "DOMAIN 2 — Psychopathology:",
        "  AWARD only if: student asked about MULTIPLE symptom subdomains relevant to the case.",
        "  One question is NOT enough. Minimum requirement: at least THREE distinct symptom areas asked.",
        "  For a depressive presentation, relevant subdomains include:",
        "    low mood, anhedonia/loss of interest, sleep, appetite/weight, energy/fatigue,",
        "    concentration, guilt/worthlessness, hopelessness.",
        "  'كيف مزاجك؟' or 'How is your mood?' alone = REJECT. That is ONE subdomain only.",
        "  'كيف مزاجك؟' + sleep + appetite = three subdomains = borderline acceptable.",
        "  Use the station diagnosis to judge which subdomains are clinically relevant.",
        "  REJECT if student asked only one broad mood question and nothing else.",
        "",
        "DOMAIN 3 — Risk:",
        "  AWARD only if: student directly and explicitly asked about suicide, self-harm, violence, or vulnerability.",
        "  'كيف مزاجك؟' = REJECT. Mood questions are NOT risk questions.",
        "  'هل راودتك أفكار لإيذاء نفسك؟' = AWARD. Direct self-harm question.",
        "  'هل فكّرت في إنهاء حياتك؟' = AWARD. Direct suicidal ideation question.",
        "  'Do you have thoughts of harming yourself?' = AWARD.",
        "  REJECT: general distress questions, mood questions, or quality-of-life questions.",
        "",
        "DOMAIN 4 — Psychosocial: student asked about stressors, supports, relationships, or occupational/academic functioning.",
        "",
        "DOMAIN 5 — Past psychiatric history: student asked about previous episodes, diagnoses, treatments, or admissions.",
        "",
        "DOMAIN 6 — Medical/substance history: student asked about medical conditions, medications, alcohol, or drug use by name or category.",
        "",
        "DOMAIN 7 — Functional impairment: student asked about impact on work, study, relationships, or self-care.",
        "",
        "DOMAIN 8 — Differential diagnosis information:",
        "  AWARD if: student explored alternative explanations OR screened for conditions not in the chief complaint.",
        "  E.g. bipolar screen, substance-related causes, psychosis screen when presenting with mood.",
        "  Candidate does NOT need to state a diagnosis — only gather the relevant information.",
        "",
        "DOMAIN 9 — Management information:",
        "  AWARD if: student gathered information relevant to safe management decisions.",
        "  E.g. assessed risk level, social supports, previous treatment response, factors affecting follow-up.",
        "  Candidate does NOT need to state a management plan — only gather the relevant information.",
        "",
        "DOMAIN 10 — Interview structure:",
        "  AWARD if: the transcript shows a logical, organised sequence — opening, systematic exploration, risk, history, close.",
        "  REJECT if: interview is chaotic, repetitive, or the student jumped randomly between topics.",
        "",
        "DOMAIN 11 — Communication skills and rapport:",
        "  STRICT RULE: Do NOT award this domain for routine symptom questioning alone.",
        "  AWARD only if there is EXPLICIT evidence of at least ONE of the following in a STUDENT utterance:",
        "    (a) Introduction or role clarification: 'أنا الدكتور...' / 'I am Dr...'",
        "    (b) Empathy or validation: 'يبدو أن هذا كان صعباً عليك' / 'That sounds really difficult'",
        "    (c) Open-ended exploration: 'احك لي أكثر عن ذلك' / 'Tell me more about that'",
        "    (d) Reflective listening: paraphrasing or reflecting back what the patient said",
        "    (e) Professional transition: 'الآن أودّ أن أسألك عن...' / 'I'd like to move on to ask about...'",
        "  'كيف مزاجك؟' = REJECT. Clinical question, not a communication skill.",
        "  'كيف حالك اليوم؟' as an opener without introduction or empathy = REJECT.",
        "  'يبدو أن هذا صعب، احك لي أكثر' = AWARD. Empathy + open-ended exploration.",
        "",
        "DOMAIN 12 — Formulation information:",
        "  AWARD if: student gathered information across biological, psychological, AND social dimensions.",
        "  All three dimensions must be present — a partial interview covering only symptoms is NOT enough.",
        "",
        "WHAT DOES NOT SATISFY ANY DOMAIN:",
        "  'كيف مزاجك؟' / 'How are you feeling?' → satisfies mood ONLY within Domain 2, nothing else",
        "  'Tell me more' / 'احك لي أكثر' → communication skill ONLY (Domain 11), not a clinical domain",
        "  Patient volunteering information the student never asked about → NOT covered",
        "  Student stating a diagnosis or management plan → NOT scored",
        "",
        "BILINGUAL: Arabic and English questions are equivalent. Examples:",
        "  كيف نومك؟ = sleep  |  شهيتك للأكل؟ = appetite  |  هل راودتك أفكار لإيذاء نفسك؟ = suicidal ideation",
        "  احك لي أكثر = open-ended (communication)  |  يبدو هذا صعباً = empathy (communication)",
        "",
        "CHECKLIST ITEMS TO EVALUATE:",
        checklistLines,
        "",
        "TRANSCRIPT (only STUDENT: lines count for scoring — PATIENT: lines are context only):",
        transcript,
        "",
        "OUTPUT FORMAT — return a JSON array, one object per checklist item, in the same order:",
        '[{"covered": true, "evidence": "exact student quote here"}, {"covered": false, "evidence": "not asked"}, ...]',
        "",
        "RULES FOR OUTPUT:",
        "- covered: true only when you can copy an exact student utterance as evidence",
        "- evidence: the verbatim student words that justify covered:true, OR 'not asked' if false",
        "- Array length MUST match the number of checklist items exactly",
        "- No markdown. No explanation outside the array. Just the JSON array.",
      ].join("\n");
    }

    // STUDENT MODE — semantic, lenient
    return [
      "You are a psychiatry OSCE examiner evaluating checklist coverage for a medical student.",
      "Station: " + String(m.stationTitle ?? "Psychiatry OSCE"),
      "Diagnosis: " + String(m.diagnosis ?? "unknown"),
      "",
      "TASK: Decide which checklist items the student meaningfully addressed.",
      "Use SEMANTIC understanding — paraphrase, indirect questioning, and natural clinical language all count.",
      "Award credit for intent and equivalent phrasing, not only exact wording.",
      "When in doubt, err toward generosity for medical students.",
      "",
      "BILINGUAL: accept Arabic OR English for any item:",
      "  'How has this affected your daily life?' = 'كيف أثّر هذا على حياتك اليومية؟'",
      "  'Have you lost interest in things you enjoy?' = 'هل توقفت عن الاستمتاع بالأشياء اللي كنت تحبها؟'",
      "  'Have thoughts of ending your life crossed your mind?' = 'هل عندك أفكار انتحارية؟'",
      "  'Do you hear things others can't hear?' = 'هل تسمع أصوات ما يسمعها غيرك؟'",
      "",
      "CHECKLIST ITEMS (evaluate each independently):",
      checklistLines,
      "",
      "TRANSCRIPT:",
      transcript,
      "",
      "Return ONLY a JSON array of booleans, one per checklist item, in the same order.",
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
  if (feature === "osce_score")             return 300;  // trainee checklist has up to 12 items
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
