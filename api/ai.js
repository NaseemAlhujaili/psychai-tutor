/**
 * /api/ai.js — Unified secure AI route for PsychAI Tutor
 */

import { checkUsage, incrementUsage, DAILY_LIMITS } from "./_usageLimit.js";

const OPENAI_KEY    = process.env.OPENAI_API_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const MODEL         = "gpt-4o-mini";
const TIMEOUT_MS    = 30_000;

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

async function callOpenAI(systemPrompt, messages, maxTokens = 1200, temperature = 0.7) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, temperature, messages: [{ role: "system", content: systemPrompt }, ...messages] }),
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

// ── Suggested questions for missed domains ────────────────────────────────────
const SUGGESTED_QUESTIONS = {
  "presenting complaint":   "Can you tell me what brought you here today and when it started?",
  "psychopathology":        "Can you describe the main symptoms you have been experiencing?",
  "risk":                   "Have you had any thoughts of harming yourself or ending your life?",
  "psychosocial":           "Are there any significant stressors or changes in your life recently?",
  "past psychiatric":       "Have you ever experienced anything like this before, or had any previous psychiatric treatment?",
  "medical":                "Do you have any medical conditions, and are you taking any medications?",
  "substance":              "Do you use alcohol or any recreational substances?",
  "functional":             "How has this been affecting your work, relationships, or daily activities?",
  "differential":           "Have you had periods of elevated mood, unusual beliefs, or other significant symptoms?",
  "management":             "What kind of support or help do you currently have around you?",
  "structure":              "(Demonstrate systematic, organised interview flow)",
  "communication":          "I can see this has been really difficult — tell me more about how it has affected you.",
  "formulation":            "What do you think might have contributed to these difficulties?",
  // Specific domains
  "hallucination":          "Have you heard voices or seen things that others around you couldn't hear or see?",
  "delusion":               "Have you had any unusual beliefs or felt that people were watching or following you?",
  "mania":                  "Have you ever had periods when you felt unusually energetic, needed much less sleep, or did things that were out of character?",
  "sleep":                  "How have you been sleeping — any difficulty falling asleep, staying asleep, or waking early?",
  "appetite":               "Have there been any changes in your appetite or weight recently?",
  "energy":                 "How has your energy level been?",
  "concentration":          "Have you had any difficulty concentrating or making decisions?",
  "suicidal":               "Have you had thoughts of suicide or of ending your life?",
  "self-harm":              "Have you had any thoughts of hurting yourself?",
  "alcohol":                "How much alcohol do you drink in a typical week?",
  "drugs":                  "Do you use cannabis, stimulants, or any other substances?",
  "obsession":              "Do you experience repetitive, unwanted thoughts that you find difficult to control?",
  "compulsion":             "Do you feel driven to perform any repetitive behaviours or rituals?",
  "anxiety":                "Do you experience excessive worry or anxiety that is difficult to control?",
  "panic":                  "Have you had episodes of sudden intense fear or panic?",
  "bipolar":                "Have you ever had a period when you felt unusually high, needed less sleep, or were more active than usual?",
};

function getSuggestedQuestion(itemText) {
  const lower = itemText.toLowerCase();
  for (const [key, q] of Object.entries(SUGGESTED_QUESTIONS)) {
    if (lower.includes(key)) return q;
  }
  return null;
}

// ── osce_score — UNIVERSAL evidence-based scoring (both student and trainee) ──
function buildOsceScorePrompt(m) {
  const isTrainee = m.trainingLevel === "trainee";

  const checklistLines = (Array.isArray(m.checklist) ? m.checklist : [])
    .map((item, i) => `${i + 1}. ${String(item.question ?? "")} (weight: ${String(item.weight ?? 1)})`)
    .join("\n");

  // Build a clearly labelled transcript — patient lines are marked as context-only
  const transcript = String(m.transcript ?? "").slice(0, 6000);

  // Strictness level label for the prompt
  const level = isTrainee ? "PSYCHIATRY TRAINEE / BOARD EXAMINATION" : "MEDICAL STUDENT";

  return [
    "You are a psychiatry OSCE examiner evaluating checklist coverage.",
    "Station: " + String(m.stationTitle ?? "Psychiatry OSCE"),
    "Diagnosis: " + String(m.diagnosis ?? "unknown"),
    "Assessment level: " + level,
    "",
    "═══════════════════════════════════════════════════════════",
    "UNIVERSAL EVIDENCE RULE — applies to ALL stations, ALL diagnoses:",
    "═══════════════════════════════════════════════════════════",
    "A checklist item is covered ONLY when you can find an EXACT CANDIDATE utterance",
    "in the transcript that directly and explicitly addresses that domain.",
    "",
    "THE ONLY EVIDENCE SOURCE IS CANDIDATE: LINES.",
    "PATIENT: lines are context only and cannot be the sole basis for a green check.",
    "If the candidate never asked — covered MUST be false, regardless of what the patient said.",
    "",
    "YOU MAY NOT:",
    "- Infer coverage from the station diagnosis",
    "- Infer coverage from the presenting complaint",
    "- Infer coverage from what the patient volunteered",
    "- Assume a general question covers multiple specific domains",
    "- Credit a domain because it is clinically expected",
    "- Hallucinate an evidence quote",
    "",
    "DOMAIN MAPPING — what counts as explicit evidence for each domain type:",
    "",
    "PRESENTING COMPLAINT / CHRONOLOGY:",
    "  ✓ Candidate asked about onset, duration, course, or progression",
    "  ✗ Vague opener ('How can I help?') does not count",
    "",
    "PSYCHOPATHOLOGY (symptoms relevant to case):",
    "  ✓ Candidate asked about SPECIFIC symptoms (mood, anhedonia, sleep, appetite,",
    "    energy, concentration, hallucinations, delusions, obsessions, worry, etc.)",
    "  ✗ 'كيف مزاجك؟' / 'How is your mood?' = ONE subdomain only (mood)",
    "  ✗ 'كيف مزاجك؟' does NOT cover sleep, appetite, energy, cognition, or risk",
    "  ✗ 'هل في ضغوطات؟' = psychosocial stressors ONLY, not psychopathology",
    "",
    "RISK ASSESSMENT:",
    "  ✓ Candidate directly asked about suicide, self-harm, harm to others, or vulnerability",
    "  ✓ 'هل فكّرت في إيذاء نفسك؟' / 'Have you had thoughts of harming yourself?'",
    "  ✗ Mood questions, distress questions, or quality-of-life questions do NOT count",
    "  ✗ 'هل تفكر بالانتحار؟' alone = suicide ideation only, not full risk assessment",
    "",
    "PSYCHOSOCIAL FACTORS:",
    "  ✓ Candidate asked about stressors, supports, relationships, or functioning",
    "  ✗ 'هل في ضغوطات؟' alone = stressors only; does NOT cover supports or functioning",
    "",
    "PAST PSYCHIATRIC HISTORY:",
    "  ✓ Candidate asked about previous episodes, diagnoses, treatments, or admissions",
    "  ✗ General history questions do not count unless specifically psychiatric",
    "",
    "MEDICAL / SUBSTANCE HISTORY:",
    "  ✓ Candidate asked about medical conditions, medications, alcohol, or drugs by name/category",
    "  ✗ General wellbeing questions do not count",
    "  ✗ Substance use requires naming alcohol, drugs, cannabis, or substances explicitly",
    "",
    "FUNCTIONAL IMPAIRMENT:",
    "  ✓ Candidate asked about impact on work, study, relationships, or self-care",
    "  ✗ 'كيف مزاجك؟' does NOT count for functioning",
    "",
    "DIFFERENTIAL DIAGNOSIS INFORMATION:",
    "  ✓ Candidate screened for an alternative diagnosis (e.g. bipolar screen, substance screen,",
    "    psychosis screen) — even if not in the chief complaint",
    "  ✗ Asking only about the presenting diagnosis does not satisfy this",
    "",
    "MANAGEMENT INFORMATION:",
    "  ✓ Candidate gathered information needed for management: risk level, supports,",
    "    treatment history, factors affecting disposition",
    "  ✓ This can be satisfied by a combination of risk, social, and history questions",
    "  ✗ 'Tell me what brought you here' does NOT satisfy management information",
    "",
    "INTERVIEW STRUCTURE:",
    "  ✓ Transcript shows logical sequence: opening → symptoms → risk → history → close",
    "  ✗ Chaotic or randomly ordered interview = not covered",
    "",
    "COMMUNICATION SKILLS:",
    "  ✓ Candidate demonstrated introduction, empathy, validation, open-ended questioning,",
    "    or reflective listening",
    "  ✓ 'يبدو أن هذا صعب، احك لي أكثر' = empathy + open-ended = AWARD",
    "  ✗ Routine clinical questions alone do NOT demonstrate communication skills",
    "  ✗ 'كيف مزاجك؟' alone does NOT demonstrate communication skills",
    "",
    "BIOPSYCHOSOCIAL FORMULATION:",
    "  ✓ Candidate gathered information across biological (symptoms), psychological",
    "    (cognitions, stressors), AND social (supports, functioning) dimensions",
    "  ✗ Partial interview covering only symptoms is NOT enough",
    "",
    "STRICTNESS:",
    isTrainee
      ? "TRAINEE MODE: Apply board-examination standards. When in doubt → false."
      : "STUDENT MODE: Apply educational standards. Accept paraphrase and equivalent phrasing.",
    "",
    "BILINGUAL: Arabic and English are equivalent. Examples:",
    "  كيف نومك؟ = sleep  |  هل راودتك أفكار لإيذاء نفسك؟ = suicidal ideation",
    "  شهيتك للأكل؟ = appetite  |  هل تستخدم الكحول أو المخدرات؟ = substance use",
    "  احك لي أكثر = open-ended  |  يبدو هذا صعباً = empathy",
    "",
    "CHECKLIST ITEMS TO EVALUATE:",
    checklistLines,
    "",
    "TRANSCRIPT (CANDIDATE: lines are evidence — PATIENT: lines are context only):",
    transcript,
    "",
    "OUTPUT FORMAT:",
    "Return a JSON array — one object per checklist item, in the same order as the checklist.",
    'Each object: {"covered": true/false, "evidence": "exact candidate quote or \'not asked\'"}',
    "",
    "RULES:",
    "- covered: true ONLY when you can copy an exact CANDIDATE utterance as evidence",
    "- evidence: verbatim candidate words for true items; 'not asked' for false items",
    "- If uncertain: covered = false",
    "- Array length MUST equal the number of checklist items",
    "- No markdown. No explanation. Just the JSON array.",
  ].join("\n");
}

function getSystemPrompt(feature, meta) {
  const m = meta ?? {};

  if (feature === "osce_msg") {
    const isArabic  = m.lang === "ar";
    const isTrainee = m.trainingLevel === "trainee";

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
        "- Keep each reply to 1–3 short sentences.",
        "- Examples: ما أنام زين | مالي خلق | أحس بضيقة | أفكر كثير | صرت أعصب بسرعة",
        "- Do NOT use فصحى words like أشعر، لا أستطيع — use Saudi equivalents.",
        "",
        "PATIENT RULES:",
        "- Stay in character. Never reveal diagnosis. Respond in Saudi Arabic ONLY.",
        isTrainee ? "- Be realistic and sometimes guarded — do not volunteer key diagnostic clues." : "",
      ].filter(Boolean).join("\n");
    }

    return [
      "You are roleplaying as " + (m.patientName ?? "a patient") + " in a psychiatry OSCE.",
      "Station: " + (m.stationTitle ?? "General psychiatry"),
      "Diagnosis: " + (m.diagnosis ?? "unknown — do not reveal"),
      "Persona: " + (m.persona ?? "You are a distressed patient."),
      "",
      isTrainee ? [
        "TRAINEE-LEVEL PATIENT BEHAVIOUR:",
        "- Do NOT volunteer diagnostic clues or key symptoms unprompted.",
        "- Respond to what is asked; do not elaborate beyond the question.",
        "- Reveal sensitive information only after specific skilled questions.",
        "- Be realistic: sometimes vague, sometimes guarded.",
        "- Never reveal your diagnosis.",
        "- Keep responses under 70 words. Respond in English.",
      ].join("\n") : [
        "RULES:",
        "- Stay in character. Never reveal your diagnosis.",
        "- Respond naturally with appropriate emotion.",
        "- Keep responses under 80 words. Respond in English.",
      ].join("\n"),
    ].join("\n");
  }

  if (feature === "osce_completed_station") {
    return "You are a senior psychiatry OSCE examiner.\n" +
           (m.persona ?? "Provide structured JSON feedback only.");
  }

  if (feature === "osce_score") {
    return buildOsceScorePrompt(m);
  }

  switch (feature) {
    case "ddx":
      return [
        "You are an expert psychiatry educator generating a differential diagnosis for medical students.",
        "Return ONLY valid JSON (no markdown, no preamble):",
        JSON.stringify({
          summary: "2-sentence clinical summary",
          differentials: [{ rank: 1, diagnosis: "Name", category: "DSM-5 category", likelihood: "High|Moderate|Low", reasoning: "3-4 sentences", supporting: ["finding"], against: ["finding"], key_discriminating_question: "question", dsm5_criteria_met: "criteria", initial_management: "management" }],
          organic_concerns: ["concern"], emergency_flags: ["flag"], recommended_investigations: ["investigation"], safety_assessment: "brief comment"
        }, null, 2),
        "Include 4-6 differentials. Educational content only.",
      ].join("\n");

    case "ddx_refine":
      return [
        "You are a psychiatry clinical reasoning tutor.",
        "Original presentation: " + JSON.stringify(m.originalPresentation ?? ""),
        "Current differentials: " + JSON.stringify(m.currentDifferentials ?? []),
        "New information: " + JSON.stringify(m.newInformation ?? ""),
        "",
        "Analyse how the new information changes the differential. Return ONLY valid JSON (no markdown):",
        JSON.stringify({ analysis: "2-3 sentences", revised_top_diagnosis: "diagnosis", rises: ["diagnosis — reason"], falls: ["diagnosis — reason"], new_considerations: ["new diagnosis"], next_question: "most important next question" }, null, 2),
        "Educational content only.",
      ].join("\n");

    case "mcq":
      return [
        "You are a psychiatry exam question writer for USMLE Step 2 and MRCPsych.",
        "Generate a single high-quality MCQ. Topic: " + String(m.topic ?? "Psychiatry"),
        "Return ONLY valid JSON (no markdown):",
        JSON.stringify({ q: "Question stem (clinical vignette, 3-5 sentences)", options: ["A. option", "B. option", "C. option", "D. option", "E. option"], answer: "A", explanation: "3-4 sentence explanation", learning_point: "Key teaching point", topic: m.topic ?? "Psychiatry" }, null, 2),
        "Use clinical vignette format. Vary the scenario.",
      ].join("\n");

    case "mse":
      return [
        "You are a psychiatry clinical educator evaluating an MSE write-up or answering MSE questions.",
        "When evaluating, return ONLY valid JSON (no markdown):",
        JSON.stringify({ overallScore: 0, overallGrade: "Excellent|Good|Satisfactory|Needs Improvement", domainFeedback: { appearance: "feedback", behaviour: "feedback", speech: "feedback", mood: "feedback", affect: "feedback", thought_process: "feedback", thought_content: "feedback", perception: "feedback", cognition: "feedback", insight: "feedback", judgment: "feedback" }, missedElements: ["missing"], exemplarPhrase: "better phrasing example", clinicalReasoningFeedback: "2-3 sentences", improvements: ["improvement"] }, null, 2),
        "When tutoring, respond conversationally. Be Socratic, concise, under 120 words.",
      ].join("\n");

    default:
      throw new Error("Unknown feature: " + feature);
  }
}

function getLimitKey(feature) {
  if (feature === "osce_msg" || feature === "osce_score") return null;
  if (feature === "osce_completed_station") return "osce_completed_station";
  if (feature === "ddx_refine") return "ddx";
  return feature;
}

function getMaxTokens(feature) {
  if (feature === "osce_msg")               return 200;
  if (feature === "osce_score")             return 600;  // {covered,evidence} objects for all items
  if (feature === "osce_completed_station") return 1000;
  if (feature === "ddx_refine")             return 600;
  return 1400;
}

function getTemperature(feature, meta) {
  if (feature === "osce_msg" && meta?.lang === "ar") return 0.5;
  if (feature === "osce_score") return 0.2;  // low temperature = more consistent, less hallucination
  return 0.7;
}

function sanitiseMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(m => m && typeof m.role === "string" && typeof m.content === "string")
    .filter(m => ["user", "assistant", "system"].includes(m.role))
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 8000) }));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  const userId = await verifyUser(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: "Please log in to use AI features.", code: "NOT_AUTHENTICATED" });

  let feature, messages, meta, checkOnly;
  try { ({ feature, messages, meta, checkOnly } = req.body ?? {}); }
  catch (e) { return res.status(400).json({ error: "Invalid request body" }); }

  if (!feature) return res.status(400).json({ error: "feature is required" });

  const validFeatures = ["osce_msg","osce_completed_station","osce_score","ddx","ddx_refine","mcq","mse"];
  if (!validFeatures.includes(feature)) return res.status(400).json({ error: "Unknown feature: " + feature });

  const cleanMessages = sanitiseMessages(messages);
  const cleanMeta     = (meta && typeof meta === "object") ? meta : {};

  if (feature === "osce_msg") console.log("[osce_msg] lang:", cleanMeta.lang ?? "en", "| patient:", cleanMeta.patientName, "| level:", cleanMeta.trainingLevel);
  if (feature === "osce_score") console.log("[osce_score] level:", cleanMeta.trainingLevel, "| checklist items:", Array.isArray(cleanMeta.checklist) ? cleanMeta.checklist.length : 0);

  const limitKey = getLimitKey(feature);
  let usage = { allowed: true, used: 0, limit: null, remaining: null };
  if (limitKey) {
    try { usage = await checkUsage(userId, limitKey); }
    catch (e) { console.error("Usage check error:", e.message); }
    if (!usage.allowed) return res.status(429).json({ error: "You have reached today's AI practice limit. Please try again tomorrow.", code: "DAILY_LIMIT_REACHED", used: usage.used, limit: usage.limit, remaining: 0 });
  }

  if (checkOnly) return res.status(200).json({ allowed: usage.allowed, used: usage.used, limit: usage.limit, remaining: usage.remaining });

  let systemPrompt;
  try {
    systemPrompt = getSystemPrompt(feature, cleanMeta);
    console.log("Feature:", feature, "| lang:", cleanMeta.lang ?? "en", "| Prompt length:", systemPrompt.length);
  } catch (e) {
    console.error("getSystemPrompt error:", e.message);
    return res.status(400).json({ error: e.message });
  }

  const temperature = getTemperature(feature, cleanMeta);
  let aiText;
  try {
    aiText = await callOpenAI(systemPrompt, cleanMessages, getMaxTokens(feature), temperature);
  } catch (err) {
    console.error("callOpenAI error for feature", feature, ":", err.message);
    if (err.message === "QUOTA_EXCEEDED") return res.status(503).json({ error: "AI service is temporarily unavailable. Please try again later.", code: "QUOTA_EXCEEDED" });
    if (err.name === "AbortError") return res.status(504).json({ error: "AI request timed out. Please try again.", code: "TIMEOUT" });
    return res.status(500).json({ error: "AI service is temporarily unavailable. Please try again later.", code: "AI_ERROR" });
  }

  if (limitKey) {
    try { await incrementUsage(userId, limitKey); }
    catch (e) { console.error("Usage increment error:", e.message); }
  }

  const newUsed = limitKey ? ((usage.used ?? 0) + 1) : null;
  const newRemaining = (limitKey && usage.limit !== null) ? Math.max(0, usage.limit - newUsed) : null;
  return res.status(200).json({ text: aiText, used: newUsed, limit: usage.limit, remaining: newRemaining });
}
