import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient.js";

/* ── DESIGN TOKENS ── */
const ACCENT       = "#1E5FAD";
const ACCENT_LIGHT = "#EBF2FB";
const ACCENT_DARK  = "#163F73";
const TEAL         = "#0F6E56";
const TEAL_LIGHT   = "#E1F5EE";
const PURPLE       = "#5B21B6";
const AMBER        = "#B45309";
const ROSE         = "#9D174D";
const BG           = "#F0F4F8";
const SIDEBAR_W    = 220;

const NAV_ITEMS = [
  { id: "home",     label: "Dashboard",       icon: "⊞",  shortLabel: "Home"     },
  { id: "cases",    label: "Clinical Cases",  icon: "🩺", shortLabel: "Cases"    },
  { id: "osce",     label: "OSCE Simulator",  icon: "🎭", shortLabel: "OSCE"     },
  { id: "mse",      label: "MSE Trainer",     icon: "🧠", shortLabel: "MSE"      },
  { id: "ddx",      label: "Differential Dx", icon: "🔍", shortLabel: "DDx"      },
  { id: "mcq",      label: "MCQ Practice",    icon: "📝", shortLabel: "MCQ"      },
  { id: "ref",      label: "Reference",       icon: "📚", shortLabel: "Ref"      },
  { id: "analytics",label: "Analytics",      icon: "📊", shortLabel: "Stats"    },
  { id: "profile",  label: "My Profile",      icon: "👤", shortLabel: "Profile"  },
  { id: "feedback", label: "Feedback",        icon: "⭐", shortLabel: "Feedback" },
  { id: "about",    label: "About",           icon: "ℹ️",  shortLabel: "About"    },
];

const S = {
  card: { background: "#fff", borderRadius: 14, border: "1px solid #E8EEF4", padding: "1.5rem", marginBottom: "1rem", boxShadow: "0 1px 5px rgba(0,0,0,0.05)" },
  sectionTitle: { fontSize: 22, fontWeight: 700, color: ACCENT_DARK, marginBottom: 4, fontFamily: "Georgia,serif" },
  sectionSub: { fontSize: 14, color: "#64748b", marginBottom: "1.5rem" },
  badge: (v) => ({ display: "inline-block", background: v === "teal" ? TEAL_LIGHT : v === "purple" ? "#EDE9FE" : v === "amber" ? "#FEF3C7" : v === "rose" ? "#FFF1F5" : ACCENT_LIGHT, color: v === "teal" ? TEAL : v === "purple" ? PURPLE : v === "amber" ? AMBER : v === "rose" ? ROSE : ACCENT_DARK, borderRadius: 20, padding: "3px 11px", fontSize: 11.5, fontWeight: 600, marginRight: 6, letterSpacing: 0.2 }),
  btn: (v) => ({ background: v === "outline" ? "#fff" : v === "teal" ? TEAL : v === "ghost" ? "transparent" : v === "danger" ? "#DC2626" : ACCENT, color: v === "outline" ? ACCENT : v === "ghost" ? "#64748b" : "#fff", border: v === "outline" ? `1.5px solid ${ACCENT}` : "none", borderRadius: 9, padding: "9px 20px", cursor: "pointer", fontSize: 14, fontFamily: "inherit", fontWeight: 600, transition: "all .15s" }),
  input: { width: "100%", border: "1.5px solid #D1D9E4", borderRadius: 9, padding: "10px 14px", fontSize: 14, fontFamily: "inherit", outline: "none", background: "#fff", boxSizing: "border-box", transition: "border .15s, box-shadow .15s" },
  textarea: { width: "100%", border: "1.5px solid #D1D9E4", borderRadius: 9, padding: "10px 14px", fontSize: 14, fontFamily: "inherit", outline: "none", background: "#fff", resize: "vertical", minHeight: 100, boxSizing: "border-box" },
  divider: { borderTop: "1px solid #EEF2F7", margin: "1rem 0" },
  bubble: (r) => ({ alignSelf: r === "user" ? "flex-end" : "flex-start", background: r === "user" ? ACCENT_LIGHT : "#F1F5F9", color: "#1a1a2e", borderRadius: r === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px", padding: "10px 14px", maxWidth: "82%", fontSize: 14, lineHeight: 1.65, marginBottom: 8, border: `1px solid ${r === "user" ? "#BFDBFE" : "#E8EEF4"}`, whiteSpace: "pre-wrap" }),
};

/**
 * askAI — secure frontend AI caller.
 * Sends the Supabase session JWT so the server can verify the user
 * and enforce daily usage limits. Never touches the OpenAI key.
 *
 * @param {string}   feature  - "osce" | "ddx" | "mcq" | "mse"
 * @param {object[]} messages - [{role, content}]
 * @param {object}   meta     - feature-specific metadata (patient info, topic, etc.)
 * @param {object}   session  - Supabase session object (has access_token)
 * @returns {Promise<{text: string, remaining: number}>}
 */
async function askAI(feature, messages, meta = {}, session = null) {
  const headers = { "Content-Type": "application/json" };
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }

  const res = await fetch("/api/ai", {
    method:  "POST",
    headers,
    body: JSON.stringify({ feature, messages, meta }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const code = data.code || "";
    if (code === "NOT_AUTHENTICATED") throw Object.assign(new Error(data.error), { code });
    if (code === "DAILY_LIMIT_REACHED") throw Object.assign(new Error(data.error), { code, remaining: 0 });
    if (code === "QUOTA_EXCEEDED")      throw Object.assign(new Error(data.error), { code });
    if (code === "TIMEOUT")             throw Object.assign(new Error(data.error), { code });
    throw new Error(data.error || `API error ${res.status}`);
  }

  return { text: data.text ?? "", remaining: data.remaining ?? null, used: data.used, limit: data.limit };
}

/* ── Safe JSON parser — handles truncated / incomplete AI responses ── */
function safeParseJSON(raw) {
  // Strip markdown fences
  const cleaned = raw.replace(/```json|```/g, "").trim();
  // 1. Direct parse
  try { return JSON.parse(cleaned); } catch {}
  // 2. Walk chars properly (respecting strings) to close open brackets
  let s = cleaned;
  let opens = 0, squares = 0, inString = false, escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") opens++;
    else if (ch === "}") opens--;
    else if (ch === "[") squares++;
    else if (ch === "]") squares--;
  }
  if (inString) s += '"';
  while (squares > 0) { s += "]"; squares--; }
  while (opens > 0) { s += "}"; opens--; }
  try { return JSON.parse(s); } catch {}
  // 3. Trim to last complete comma-separated item
  const lastComma = Math.max(s.lastIndexOf(",\n"), s.lastIndexOf(", "));
  if (lastComma > s.length * 0.3) {
    let t = s.slice(0, lastComma);
    let o2 = 0, sq2 = 0, inStr2 = false, esc2 = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (esc2) { esc2 = false; continue; }
      if (ch === "\\") { esc2 = true; continue; }
      if (ch === '"') { inStr2 = !inStr2; continue; }
      if (inStr2) continue;
      if (ch === "{") o2++; else if (ch === "}") o2--;
      else if (ch === "[") sq2++; else if (ch === "]") sq2--;
    }
    while (sq2 > 0) { t += "]"; sq2--; }
    while (o2 > 0) { t += "}"; o2--; }
    try { return JSON.parse(t); } catch {}
  }
  return null;
}

/* ── GLOBAL CSS ── */
function GlobalStyles() {
  useEffect(() => {
    const id = "psychai-styles";
    if (document.getElementById(id)) return;
    const st = document.createElement("style");
    st.id = id;
    st.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap');
      *{box-sizing:border-box;}
      body{font-family:'Inter',sans-serif!important;background:#F0F4F8;}
      ::-webkit-scrollbar{width:5px;height:5px;}
      ::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:99px;}
      .ch:hover{box-shadow:0 8px 28px rgba(0,0,0,.10)!important;transform:translateY(-2px)!important;}
      .fade-in{animation:fadeIn .28s ease both;}
      @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
      .slide-in{animation:slideIn .22s ease both;}
      @keyframes slideIn{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:translateX(0)}}
      .pulse{animation:pulse 2s infinite;}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}
      button:active{transform:scale(.97);}
      input:focus,textarea:focus,select:focus{border-color:#1E5FAD!important;box-shadow:0 0 0 3px rgba(30,95,173,.15)!important;outline:none!important;}
      .nav-item:hover{background:rgba(255,255,255,.12)!important;}
      .nav-item.active{background:rgba(255,255,255,.18)!important;}
      @media(max-width:700px){
        .sidebar{display:none!important;}
        .bottom-nav{display:flex!important;}
        .main-wrap{margin-left:0!important;}
        .main-pad{padding-bottom:76px!important;}
      }
      @media(min-width:701px){
        .bottom-nav{display:none!important;}
        .main-wrap{margin-left:${SIDEBAR_W}px;}
      }
    `;
    document.head.appendChild(st);
  }, []);
  return null;
}

/* ── PROGRESS BAR ── */
function ProgressBar({ value, max, color = ACCENT, height = 8 }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ background: "#F1F5F9", borderRadius: 99, height, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: 99, transition: "width 0.5s ease" }} />
    </div>
  );
}

/* ── STAT CARD ── */
function StatCard({ label, value, sub, color = ACCENT, icon }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "1rem 1.25rem", flex: 1, minWidth: 110 }}>
      <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* ══════════════════════════════════════════
   HOME DASHBOARD
══════════════════════════════════════════ */
const DAILY_PEARLS = [
  { pearl: "Lithium has a narrow therapeutic index (0.6–1.2 mmol/L). Always check renal function before initiating.", tag: "Pharmacology" },
  { pearl: "First-rank symptoms of schizophrenia (Schneider): thought insertion/withdrawal/broadcast, passivity phenomena, third-person auditory hallucinations, delusional perception.", tag: "Psychosis" },
  { pearl: "The PHQ-9 scores depression 0–27. ≥10 suggests moderate depression and warrants treatment discussion.", tag: "Assessment" },
  { pearl: "Clozapine requires mandatory FBC monitoring due to risk of agranulocytosis (1–2%). Weekly for 18 weeks, then fortnightly.", tag: "Pharmacology" },
  { pearl: "Anorexia nervosa has the highest mortality rate of any psychiatric disorder (~10%), primarily from cardiac complications and suicide.", tag: "Eating Disorders" },
  { pearl: "The CAGE questionnaire screens for alcohol use disorder. ≥2 'yes' answers warrants further assessment.", tag: "Substance Use" },
  { pearl: "Borderline personality disorder features: emotional instability, impulsivity, identity disturbance, fear of abandonment — DBT is first-line psychotherapy.", tag: "Personality" },
  { pearl: "ECT is considered first-line in severe depression with psychotic features, catatonia, or life-threatening refusal to eat/drink.", tag: "Treatment" },
];

const QUICK_FACTS = [
  { label: "MDD lifetime prevalence", value: "~16%", color: ACCENT },
  { label: "Schizophrenia prevalence", value: "~1%", color: PURPLE },
  { label: "Bipolar disorder (type I+II)", value: "~2–3%", color: AMBER },
  { label: "Anxiety disorders (lifetime)", value: "~30%", color: TEAL },
];

function Home({ setSection, progress }) {
  const todayPearl = DAILY_PEARLS[new Date().getDay() % DAILY_PEARLS.length];
  const totalMCQ = progress.mcq.total;
  const mcqPct = totalMCQ ? Math.round((progress.mcq.correct / totalMCQ) * 100) : 0;
  const casesCompleted = progress.cases.completed.length;
  const osceDone = progress.osce.completed.length;
  const mseDone = progress.mse.explored.length;
  const overallPct = Math.round(
    ((casesCompleted / CASES.length) * 40) +
    ((osceDone / 5) * 20) +
    ((mseDone / 6) * 20) +
    (Math.min(totalMCQ / 20, 1) * 20)
  );

  const features = [
    { id: "cases", icon: "🩺", title: "Clinical Cases", desc: "15 DSM-5 categories · AI-guided reasoning", color: ACCENT,    done: casesCompleted, total: CASES.length, unit: "cases" },
    { id: "osce",  icon: "🎭", title: "OSCE Simulator", desc: "Structured patient encounters",             color: PURPLE,   done: osceDone,        total: 3,            unit: "stations" },
    { id: "mse",   icon: "🧠", title: "MSE Trainer",    desc: "Mental Status Examination",                color: TEAL,     done: mseDone,         total: 6,            unit: "domains" },
    { id: "ddx",   icon: "🔍", title: "Differential Dx",desc: "AI-assisted clinical reasoning",           color: AMBER,    done: progress.ddx.built, total: null,      unit: "built" },
    { id: "mcq",   icon: "📝", title: "MCQ Practice",   desc: "Board-style question bank",                color: ROSE,     done: totalMCQ,        total: null,         unit: `answered · ${mcqPct || 0}% correct` },
    { id: "ref",   icon: "📚", title: "Reference",      desc: "DSM-5, drugs & clinical tools",            color: "#0891B2",done: null,            total: null },
  ];

  return (
    <div className="fade-in">
      {/* Hero */}
      <div style={{ borderRadius: 16, background: `linear-gradient(135deg, ${ACCENT_DARK} 0%, #1E5FAD 100%)`, color: "#fff", marginBottom: "1.25rem", padding: "1.75rem", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -20, top: -20, width: 160, height: 160, background: "rgba(255,255,255,.04)", borderRadius: "50%" }} />
        <div style={{ position: "absolute", right: 40, bottom: -40, width: 120, height: 120, background: "rgba(255,255,255,.04)", borderRadius: "50%" }} />
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", opacity: 0.6, marginBottom: 6, fontWeight: 600 }}>AI-Powered Medical Education</div>
          <h1 style={{ fontFamily: "Georgia,serif", fontSize: 26, fontWeight: 700, margin: "0 0 8px", color: "#fff", lineHeight: 1.2 }}>Welcome to PsychAI Tutor</h1>
          <p style={{ fontSize: 14, opacity: 0.85, marginBottom: "1.25rem", lineHeight: 1.65, maxWidth: 500 }}>Your intelligent psychiatry clerkship companion — powered by Claude AI. Practice cases, simulate OSCEs, and master clinical reasoning.</p>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["DSM-5-TR", "Evidence-Based", "USMLE-Style"].map(t => (
                <span key={t} style={{ background: "rgba(255,255,255,.14)", borderRadius: 20, padding: "3px 12px", fontSize: 11, fontWeight: 600 }}>{t}</span>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
              <div style={{ background: "rgba(255,255,255,.12)", borderRadius: 12, padding: "8px 16px", textAlign: "center" }}>
                <div style={{ fontWeight: 800, fontSize: 22, lineHeight: 1 }}>{overallPct}%</div>
                <div style={{ fontSize: 10, opacity: .7, marginTop: 1 }}>Progress</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: "0.75rem", marginBottom: "1.25rem" }}>
        {[
          { icon: "🩺", label: "Cases",       value: casesCompleted, sub: `of ${CASES.length}`,  color: ACCENT  },
          { icon: "📝", label: "MCQs",        value: totalMCQ,       sub: totalMCQ ? `${mcqPct}% correct` : "—", color: ROSE   },
          { icon: "🎭", label: "OSCE",        value: osceDone,       sub: "of 3",                color: PURPLE  },
          { icon: "🧠", label: "MSE Domains", value: mseDone,        sub: "of 6",                color: TEAL    },
        ].map((st, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #E8EEF4", borderRadius: 13, padding: "1rem 1rem .875rem", boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
            <div style={{ fontSize: 18, marginBottom: 5 }}>{st.icon}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: st.color, lineHeight: 1 }}>{st.value}</div>
            <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 3 }}>{st.label}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{st.sub}</div>
          </div>
        ))}
      </div>

      {/* Daily Pearl */}
      <div style={{ ...S.card, background: "#FFFBEB", border: "1px solid #FDE68A", marginBottom: "1.25rem", display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ fontSize: 22, flexShrink: 0 }}>💡</div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: AMBER, marginBottom: 4 }}>Daily Clinical Pearl · {todayPearl.tag}</div>
          <div style={{ fontSize: 14, color: "#1e293b", lineHeight: 1.65 }}>{todayPearl.pearl}</div>
        </div>
      </div>

      {/* Section cards */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Learning Modules</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: "0.875rem", marginBottom: "1.5rem" }}>
        {features.map(f => (
          <button key={f.id} onClick={() => setSection(f.id)} className="ch"
            style={{ ...S.card, cursor: "pointer", textAlign: "left", marginBottom: 0, padding: "1.125rem", borderTop: `3px solid ${f.color}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ fontSize: 26, lineHeight: 1 }}>{f.icon}</div>
              {f.done !== null && f.total && (
                <span style={{ fontSize: 11, fontWeight: 700, color: f.done === f.total ? TEAL : "#94a3b8", background: f.done === f.total ? TEAL_LIGHT : "#F1F5F9", borderRadius: 20, padding: "2px 8px" }}>
                  {f.done}/{f.total}
                </span>
              )}
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, color: f.color, margin: "8px 0 3px" }}>{f.title}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: f.total ? 10 : 0, lineHeight: 1.4 }}>{f.desc}</div>
            {f.total && <ProgressBar value={f.done} max={f.total} color={f.color} height={5} />}
            {f.done !== null && !f.total && (
              <div style={{ fontSize: 12, color: f.color, fontWeight: 600, marginTop: 6 }}>{f.done} {f.unit}</div>
            )}
          </button>
        ))}
      </div>

      {/* Quick epidemiology row */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Epidemiology Quick Reference</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {QUICK_FACTS.map((f, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #E8EEF4", borderRadius: 12, padding: "0.875rem 1rem", boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: f.color }}>{f.value}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{f.label}</div>
          </div>
        ))}
      </div>

      {/* Feedback CTA */}
      <div style={{ ...S.card, background: "linear-gradient(135deg, #EBF2FB, #F0F7FF)", border: "1px solid #BFDBFE", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ fontSize: 32, flexShrink: 0 }}>📬</div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: ACCENT_DARK, marginBottom: 4 }}>Share Your Feedback</div>
            <p style={{ margin: 0, fontSize: 13, color: "#475569", lineHeight: 1.6 }}>
              Help us improve PsychAI Tutor by sharing your feedback.
            </p>
          </div>
          <button
            onClick={() => setSection("feedback")}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, background: ACCENT, color: "#fff", borderRadius: 10, padding: "10px 20px", border: "none", fontWeight: 600, fontSize: 13.5, fontFamily: "inherit", flexShrink: 0, boxShadow: "0 2px 8px rgba(30,95,173,.25)", cursor: "pointer", transition: "background .15s" }}
            onMouseEnter={e => e.currentTarget.style.background = ACCENT_DARK}
            onMouseLeave={e => e.currentTarget.style.background = ACCENT}
          >
            <span>📝</span> Provide Feedback
          </button>
        </div>
      </div>

      {/* Disclaimer */}
      <div style={{ ...S.card, background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
        <span style={{ fontSize: 12, color: "#64748b" }}>⚠️ <strong>Disclaimer:</strong> For educational purposes only. All cases use fictional, non-identifiable information. Clinical decisions must not be based solely on AI output.</span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   CLINICAL CASES — 15 CATEGORIES
══════════════════════════════════════════ */
const CASE_CATEGORIES = [
  { id: "neurodev", label: "Neurodevelopmental Disorders", icon: "🧩", color: "#7C3AED" },
  { id: "psychosis", label: "Schizophrenia Spectrum & Psychotic Disorders", icon: "🌀", color: "#5B21B6" },
  { id: "bipolar", label: "Bipolar & Related Disorders", icon: "⚡", color: "#D97706" },
  { id: "depressive", label: "Depressive Disorders", icon: "🌧️", color: ACCENT },
  { id: "anxiety", label: "Anxiety Disorders", icon: "😰", color: "#0891B2" },
  { id: "ocd", label: "Obsessive-Compulsive & Related Disorders", icon: "🔄", color: "#059669" },
  { id: "trauma", label: "Trauma & Stressor-Related Disorders", icon: "⚠️", color: "#DC2626" },
  { id: "somatic", label: "Somatic Symptom & Related Disorders", icon: "🫀", color: "#DB2777" },
  { id: "eating", label: "Feeding & Eating Disorders", icon: "🍽️", color: "#9D174D" },
  { id: "disruptive", label: "Disruptive, Impulse-Control & Conduct Disorders", icon: "💥", color: "#B45309" },
  { id: "substance", label: "Substance-Related & Addictive Disorders", icon: "⚗️", color: "#92400E" },
  { id: "neurocog", label: "Neurocognitive Disorders", icon: "🧠", color: TEAL },
  { id: "personality", label: "Personality Disorders", icon: "🪞", color: "#6D28D9" },
  { id: "history", label: "History Taking in Psychiatry", icon: "📋", color: "#0F766E" },
  { id: "mse_cases", label: "Mental State Examination", icon: "🔎", color: "#1D4ED8" },
];

const CASES = [
  {
    id: 101, category: "neurodev", difficulty: "Beginner",
    title: "The Struggling Schoolboy",
    scenario: "A 9-year-old boy is referred by his school after persistent difficulties concentrating, frequently leaving his seat, calling out in class, and failing to complete assignments despite average intelligence. His mother reports he was always 'on the go' since toddlerhood, loses things constantly, and cannot wait his turn. Symptoms are present at home and school. No anxiety or mood disturbance identified.",
    guidedQuestions: ["What diagnostic criteria need to be met for ADHD?", "How do you distinguish ADHD from normal childhood behaviour?", "What structured tools would you use to assess this child?", "What are the core domains of impairment to explore?"],
    differentialDiagnosis: ["ADHD (Combined presentation) — most likely", "Specific learning disorder (dyslexia)", "Anxiety disorder (can mimic inattention)", "Autism Spectrum Disorder", "Normal developmental variation"],
    mseFinding: "Appearance: fidgety, unable to sit still. Speech: rapid, impulsive interruptions. Mood: euthymic. Thought: no psychosis. Cognition: intact for age. Insight: limited (child).",
    mostLikelyDiagnosis: "ADHD — Combined Presentation (DSM-5)",
    initialManagement: "Multimodal: parent/teacher psychoeducation, behavioural interventions first (if <6 yrs). Methylphenidate (1st-line pharmacotherapy ≥6 yrs). Refer to child psychiatry/paediatrics. School accommodations (IEP/extra time).",
    clinicalPearls: ["ADHD requires symptoms in ≥2 settings (school AND home). Never diagnose from one setting alone.", "Inattentive-predominant ADHD is more common in girls and often missed.", "Always screen for comorbidities: anxiety, depression, learning disorders, ASD."]
  },
  {
    id: 102, category: "neurodev", difficulty: "Intermediate",
    title: "The Silent Teenager",
    scenario: "A 14-year-old girl is brought by her parents. She makes minimal eye contact, has a very restricted set of interests (trains and timetables), speaks in a formal monotone, and does not understand social cues or sarcasm. She has one close friend who shares her interest. No intellectual disability. She was previously diagnosed with 'shyness' but her parents are concerned about her increasingly rigid routines and distress when plans change.",
    guidedQuestions: ["What core domains define Autism Spectrum Disorder?", "How does ASD present differently in females?", "What screening tools are available?", "What distinguishes ASD from social anxiety disorder?"],
    differentialDiagnosis: ["Autism Spectrum Disorder (Level 1) — most likely", "Social Anxiety Disorder", "Schizoid Personality Disorder (adult, not applicable here)", "Avoidant Personality", "Selective Mutism"],
    mseFinding: "Appearance: well-groomed, avoids eye contact. Speech: formal, monotone, literal. Mood: anxious when routine disrupted. Thought: no psychosis; perseverative topics. Cognition: intact, above average IQ. Insight: partial.",
    mostLikelyDiagnosis: "Autism Spectrum Disorder (Level 1, without intellectual or language impairment)",
    initialManagement: "Refer to child/adolescent psychiatry. Multidisciplinary assessment (ADOS-2, ADI-R). Social skills training, CBT adapted for ASD. School support plan. Treat comorbid anxiety if present (SSRIs).",
    clinicalPearls: ["ASD in females is often 'masked' — they mimic social behaviour, leading to later diagnosis and higher burnout.", "Restricted interests and insistence on sameness are as diagnostically important as social communication deficits.", "DSM-5 merged Asperger's into ASD Level 1."]
  },
  {
    id: 201, category: "psychosis", difficulty: "Intermediate",
    title: "The Fearful Farmer",
    scenario: "A 24-year-old male farmer is brought by his family. For 8 months, he has believed neighbours are poisoning his crops using radio waves. He hears a voice narrating his actions in the third person. He has become increasingly isolated and is neglecting self-care and farm duties. No substance use. No mood episode identified. Family history: paternal uncle with schizophrenia.",
    guidedQuestions: ["What are the positive and negative symptoms present?", "What duration criteria must be met for schizophrenia?", "How do you differentiate schizophrenia from a mood disorder with psychosis?", "What organic causes must be excluded?"],
    differentialDiagnosis: ["Schizophrenia — most likely", "Schizoaffective disorder", "Brief psychotic disorder", "Substance-induced psychosis", "Organic psychosis (encephalitis, temporal lobe epilepsy)"],
    mseFinding: "Appearance: unkempt, poor hygiene. Behaviour: guarded, suspicious. Speech: normal rate, poverty of content. Mood: blunted affect. Thought: persecutory delusion, third-person auditory hallucination. Cognition: intact. Insight: absent.",
    mostLikelyDiagnosis: "Schizophrenia (Paranoid type, DSM-5)",
    initialManagement: "Urgent psychiatric assessment. Investigations: FBC, metabolic panel, TFTs, urine drug screen, MRI brain. Start oral atypical antipsychotic (risperidone/olanzapine). Psychoeducation. Community psychiatric team referral. Assess risk.",
    clinicalPearls: ["Third-person auditory hallucinations and thought broadcast are Schneiderian first-rank symptoms.", "Negative symptoms (social withdrawal, alogia, avolition) predict long-term functional outcome.", "Duration ≥6 months distinguishes schizophrenia from schizophreniform disorder (1–6 months)."]
  },
  {
    id: 202, category: "psychosis", difficulty: "Advanced",
    title: "The Postpartum Puzzle",
    scenario: "A 28-year-old woman is brought to the ED 5 days after giving birth. Her husband reports she has not slept since delivery, is speaking rapidly and incoherently, believes her baby has been 'replaced by a demon', and has been seen trying to harm the infant. She is agitated, tearful, and disoriented to time.",
    guidedQuestions: ["What is the most urgent clinical priority?", "What distinguishes postpartum psychosis from postpartum blues?", "What risk factors predispose to postpartum psychosis?", "What is the safest pharmacological approach while breastfeeding?"],
    differentialDiagnosis: ["Postpartum psychosis — most likely", "Bipolar disorder (manic episode triggered by delivery)", "Severe postpartum depression with psychotic features", "Organic cause: thyroiditis, encephalitis", "Substance intoxication"],
    mseFinding: "Appearance: dishevelled, agitated. Speech: rapid, incoherent. Mood: labile (elated and tearful). Thought: persecutory and religious delusions; disorganised. Perception: possible hallucinations. Cognition: disoriented. Insight: absent.",
    mostLikelyDiagnosis: "Postpartum Psychosis (likely bipolar spectrum)",
    initialManagement: "PSYCHIATRIC EMERGENCY. Immediate mother-baby unit admission. Ensure infant safety — safeguarding referral. Treat with mood stabiliser + antipsychotic (haloperidol or quetiapine — lower breastfeeding risk). Monitor for escalation. Family support.",
    clinicalPearls: ["Postpartum psychosis is a psychiatric emergency with ~5% infanticide and ~4% maternal suicide risk.", "Onset typically within 2 weeks of delivery — distinguish from 'baby blues' (day 3–5, self-limiting).", "80% of postpartum psychosis cases are bipolar spectrum; treat accordingly long-term."]
  },
  {
    id: 301, category: "bipolar", difficulty: "Intermediate",
    title: "The Elevated Executive",
    scenario: "A 35-year-old female executive presents to the ED at 3 AM brought by her husband. She has not slept in 4 days, is making grandiose business plans, has spent £15,000 online, and is speaking so rapidly she cannot be interrupted. She feels 'better than ever.' First psychiatric presentation. She takes no medications. No substance use.",
    guidedQuestions: ["What DSM-5 criteria for a manic episode are being met?", "How does mania differ from hypomania?", "What mood stabiliser would you initiate acutely?", "What safety issues must be addressed immediately?"],
    differentialDiagnosis: ["Bipolar I Disorder — Manic episode", "Substance-induced mood disorder (stimulants)", "Secondary mania (thyrotoxicosis, steroids)", "Schizoaffective disorder", "ADHD (does not cause acute episodic change)"],
    mseFinding: "Appearance: overdressed, excessive make-up, loud. Behaviour: disinhibited, intrusive. Speech: pressured, flight of ideas. Mood: elevated, grandiose. Thought: grandiose delusions (borderline). Cognition: distractible. Insight: absent.",
    mostLikelyDiagnosis: "Bipolar I Disorder — Current Manic Episode",
    initialManagement: "Hospitalisation (voluntary or compulsory if risk present). Oral lithium or sodium valproate (avoid valproate in women of childbearing age). Add short-term antipsychotic (olanzapine) for acute control. Lorazepam PRN for agitation. Safeguard finances. Psychoeducation for family.",
    clinicalPearls: ["Decreased need for sleep WITHOUT fatigue is the most specific symptom of mania (vs insomnia in depression).", "Mania requires ≥7 days of symptoms OR hospitalisation; hypomania ≥4 days without hospitalisation.", "Never start an antidepressant alone in suspected bipolar — risk of triggering mixed state or cycle acceleration."]
  },
  {
    id: 302, category: "bipolar", difficulty: "Advanced",
    title: "The Cyclical Nurse",
    scenario: "A 32-year-old nurse presents reporting 'mood swings for years.' She describes periods of weeks where she is tearful, cannot work, sleeps 14 hours, and feels hopeless — alternating with 3–4 day periods where she feels 'amazing', needs only 4 hours sleep, is highly productive, socialises excessively, and makes impulsive decisions. She has been treated for recurrent depression with multiple SSRIs with no sustained benefit. BMI is normal.",
    guidedQuestions: ["Why have SSRIs failed this patient?", "What specific history would confirm hypomanic episodes?", "What distinguishes Bipolar II from cyclothymia?", "What is the first-line mood stabiliser in Bipolar II?"],
    differentialDiagnosis: ["Bipolar II Disorder — most likely", "Cyclothymic disorder", "Borderline personality disorder (rapid cycling can mimic)", "Recurrent MDD", "ADHD with emotional dysregulation"],
    mseFinding: "Currently euthymic. Speech: normal rate. Mood: subjectively 'okay today'. Thought: no psychosis. Cognition: intact. Insight: moderate — she recognises mood episodes but not the pattern.",
    mostLikelyDiagnosis: "Bipolar II Disorder",
    initialManagement: "Discontinue SSRI (risk of cycle acceleration). Start lithium or lamotrigine (preferred for depressive predominance in Bipolar II). Mood monitoring diary. Psychoeducation about sleep regularity. Referral to bipolar specialist. CBT-BP.",
    clinicalPearls: ["Bipolar II is commonly misdiagnosed as recurrent depression — always screen for past hypomanic episodes.", "Lamotrigine is preferred when depressive episodes predominate; lithium when manic episodes predominate.", "The 'DIGFAST' mnemonic for mania: Distractibility, Impulsivity, Grandiosity, Flight of ideas, Activity increase, Sleep decrease, Talkativeness."]
  },
  {
    id: 401, category: "depressive", difficulty: "Beginner",
    title: "The Withdrawn Student",
    scenario: "A 20-year-old male university student is brought to the campus health clinic by his roommate. Over 6 weeks, he has been sleeping 12+ hours, skipping classes, eating very little, and expressing worthlessness. He denies suicidal ideation. No prior psychiatric history. Family history: mother with recurrent depressive disorder. Bloods normal.",
    guidedQuestions: ["What DSM-5 criteria for MDD are being met?", "What safety assessment must you complete?", "What first-line treatments would you recommend?", "When would you consider referral to secondary care?"],
    differentialDiagnosis: ["Major Depressive Disorder — most likely", "Adjustment disorder with depressed mood", "Bipolar II — depressive episode (rule out)", "Dysthymia / PDD", "Hypothyroidism (bloods normal here)"],
    mseFinding: "Appearance: unkempt, psychomotor retardation. Speech: slow, reduced spontaneity. Mood: low, subjective and objective. Affect: flat. Thought: themes of worthlessness, passive death wishes — no active SI. Cognition: poor concentration. Insight: fair.",
    mostLikelyDiagnosis: "Major Depressive Disorder (Moderate severity)",
    initialManagement: "Safety plan. Start SSRI (sertraline/fluoxetine). Refer for CBT. Sleep hygiene advice. Review in 2 weeks. Consider university counselling services. Monitor for bipolar switch (enquire about past hypomanic episodes).",
    clinicalPearls: ["MDD requires ≥5 symptoms for ≥2 weeks including depressed mood OR anhedonia (one of these must be present).", "Always enquire about past hypomanic episodes before starting an antidepressant.", "SSRIs take 4–6 weeks for full effect; review at 2 weeks for tolerability and at 6–8 weeks for efficacy."]
  },
  {
    id: 402, category: "depressive", difficulty: "Advanced",
    title: "The Psychotic Pensioner",
    scenario: "A 72-year-old retired teacher presents with a 3-month history of profound low mood, complete anorexia (6kg weight loss), early morning wakening, psychomotor retardation, and a fixed belief that her internal organs have 'rotted away' and she has 'destroyed her family financially' (both objectively false). She refuses food and fluids. PHQ-9 score: 24.",
    guidedQuestions: ["What subtype of MDD does this represent?", "What is the safest and most effective treatment?", "What medico-legal considerations arise if she refuses treatment?", "How do nihilistic delusions differ from persecutory delusions?"],
    differentialDiagnosis: ["Psychotic depression (MDD with psychotic features) — most likely", "Dementia with depression", "Bipolar I — depressive episode with psychosis", "Delusional disorder (nihilistic type)", "Organic cause: CNS lesion, hypothyroidism"],
    mseFinding: "Appearance: frail, very unkempt. Psychomotor retardation marked. Speech: very slow, whispered. Mood: severely depressed. Thought: nihilistic and Cotard-like delusions ('my intestines are dead'). Cognition: MMSE 22/30 (attention deficit). Insight: absent.",
    mostLikelyDiagnosis: "Major Depressive Disorder — Severe with Psychotic Features",
    initialManagement: "Urgent inpatient admission. ANTIDEPRESSANT + ANTIPSYCHOTIC combination (not antipsychotic alone). ECT is first-line if life-threatening (food/fluid refusal, rapid deterioration). Assess capacity. Mental health legislation if required. Nutritional support.",
    clinicalPearls: ["ECT is first-line for psychotic depression with life-threatening features — faster response than medication.", "Cotard syndrome (nihilistic delusions of non-existence) is pathognomonic of severe psychotic depression.", "Never treat psychotic depression with antidepressant monotherapy — risk of symptom exacerbation."]
  },
{
    id: 501, category: "anxiety", difficulty: "Beginner",
    title: "The Insomniac Accountant",
    scenario: "A 38-year-old accountant presents to her GP with an 8-month history of constant, uncontrollable worry spanning multiple domains: her performance at work despite consistent positive reviews, her children's health despite both being well, financial security despite no debts, and her own health after each minor symptom. She finds it impossible to switch off, feels restless and on edge most days, has chronic muscle tension across her shoulders and neck, wakes at 3am ruminating, and finds concentration increasingly difficult. She has attended A&E twice with chest tightness — cardiac workup was normal both times. She drinks two glasses of wine nightly to take the edge off. GAD-7 score: 19.",
    guidedQuestions: ["What are the 6 somatic and cognitive symptoms of GAD and how many does this patient meet?", "How does GAD differ clinically from panic disorder, health anxiety, and MDD with anxious distress?", "What is the cognitive model of GAD — specifically the role of intolerance of uncertainty and metacognitive beliefs?", "What are the risks of the patient's nightly alcohol use in the context of anxiety treatment?"],
    differentialDiagnosis: ["Generalised Anxiety Disorder (GAD) — most likely", "MDD with anxious distress (screen for anhedonia and persistent low mood)", "Illness Anxiety Disorder (repeated A&E attendance, somatic preoccupation — overlapping)", "Panic Disorder (chest tightness presentations, but no discrete unexpected panic attacks described)", "Alcohol Use Disorder (secondary anxiety or maintaining factor — explore carefully)", "Thyrotoxicosis (exclude with TFTs — palpitations, weight loss, heat intolerance)"],
    mseFinding: "Appearance: well-dressed, tense posture, knuckles white gripping handbag. Behaviour: fidgety, repeatedly checks phone during interview. Speech: normal rate and tone, slightly rapid when describing worries. Mood: anxious, always on edge. Affect: tense, congruent. Thought: excessive uncontrollable worry across multiple themes; no obsessions; no phobias. Perception: nil abnormal. Cognition: intact; mild concentration difficulty. Insight: good — recognises problem and is help-seeking.",
    mostLikelyDiagnosis: "Generalised Anxiety Disorder (GAD) — Moderate-Severe (GAD-7: 19)",
    initialManagement: "Psychoeducation about the GAD cognitive model (intolerance of uncertainty, worry as perceived coping strategy). First-line psychological: CBT (12-15 sessions — worry postponement, cognitive restructuring, behavioural experiments, applied relaxation). First-line pharmacological: SSRI (sertraline 50mg titrated to 100mg) or SNRI (venlafaxine 75mg to 150mg). Avoid benzodiazepines (dependence, rebound anxiety). Address alcohol use — motivational interviewing, alcohol diary, and psychoeducation that alcohol maintains the anxiety cycle. GAD-7 to monitor. Review at 2 weeks (tolerability) and 6-8 weeks (efficacy).",
    clinicalPearls: ["GAD requires worry on most days for at least 6 months about multiple topics plus 3 or more somatic or cognitive symptoms: restlessness, fatigue, concentration difficulty, irritability, muscle tension, and sleep disturbance.", "The key cognitive features of GAD are intolerance of uncertainty (something might go wrong) combined with positive metacognitive beliefs that worrying is useful (worrying keeps me prepared). CBT directly targets both of these.", "Alcohol is a GABA-A agonist — it provides short-term anxiolysis but causes rebound anxiety during withdrawal, maintaining the anxiety cycle. Always ask about alcohol use in anxiety disorders."]
  },
  {
    id: 502, category: "anxiety", difficulty: "Intermediate",
    title: "The Panicking Pilot",
    scenario: "A 29-year-old commercial pilot presents after his third episode of sudden-onset palpitations, shortness of breath, chest tightness, dizziness, and a fear he was 'going to die' — each lasting 10–15 minutes and resolving spontaneously. Cardiac investigations and 24-hour Holter monitor are normal. Between episodes he is persistently worried about having another attack and has started avoiding flights and crowded areas.",
    guidedQuestions: ["What criteria distinguish panic disorder from panic attacks?", "What medical conditions must be excluded?", "What is the significance of agoraphobic avoidance developing?", "What evidence-based treatment has the best long-term outcomes?"],
    differentialDiagnosis: ["Panic Disorder — most likely", "Panic Disorder with Agoraphobia", "Cardiac arrhythmia (Holter normal)", "Hyperthyroidism / phaeochromocytoma", "Social Anxiety Disorder"],
    mseFinding: "Appearance: well-dressed, anxious. Speech: normal. Mood: anxious between attacks. Thought: catastrophic misinterpretation of bodily sensations ('heart attack'). Perception: normal. Insight: good (recognises anxiety component).",
    mostLikelyDiagnosis: "Panic Disorder with developing Agoraphobia",
    initialManagement: "CBT with interoceptive exposure (first-line). SSRI (sertraline or paroxetine). Psychoeducation about the panic cycle. No benzodiazepines (worsen avoidance). Occupational health referral regarding flying duties. DARE assessment.",
    clinicalPearls: ["Panic disorder = recurrent unexpected attacks + ≥1 month of anticipatory anxiety or behavioural change.", "Agoraphobia develops in ~30% of panic disorder — avoidance perpetuates the disorder.", "Interoceptive exposure (deliberately inducing feared body sensations) is a key CBT technique."]
  },
  {
    id: 601, category: "ocd", difficulty: "Intermediate",
    title: "The Contaminated Chef",
    scenario: "A 27-year-old chef presents distressed by intrusive thoughts that he has contaminated food and will poison his customers. He washes his hands up to 60 times per shift, checks the oven repeatedly before leaving work, and spends 3+ hours on rituals daily. He knows the thoughts are 'irrational' but cannot resist them. He has lost his job. He has no psychotic symptoms.",
    guidedQuestions: ["What distinguishes OCD obsessions from psychotic delusions?", "What is the ERP component of CBT?", "What is the first-line pharmacotherapy for OCD?", "When would you consider augmentation?"],
    differentialDiagnosis: ["OCD — most likely", "OCD with poor insight", "Anxiety Disorder NOS", "Psychosis (ego-dystonic nature argues against)", "OCPD (trait, not episodic)"],
    mseFinding: "Appearance: red, excoriated hands. Behaviour: repeatedly checks phone during interview. Speech: normal. Mood: anxious, not depressed. Thought: ego-dystonic intrusive thoughts about contamination; compulsive checking rituals. Cognition: intact. Insight: good.",
    mostLikelyDiagnosis: "Obsessive-Compulsive Disorder",
    initialManagement: "CBT with Exposure and Response Prevention (ERP) — first-line. SSRI at high doses (fluoxetine 60mg, sertraline 200mg — higher than depression doses). Combination ERP + SSRI most effective. Y-BOCS to monitor severity. Occupational support.",
    clinicalPearls: ["OCD obsessions are ego-dystonic (the person resists them) — unlike psychotic beliefs which are ego-syntonic.", "OCD requires higher SSRI doses than depression and takes 8–12 weeks for response.", "ERP works by breaking the obsession-compulsion-relief cycle; short-term anxiety increase is expected and therapeutic."]
  },
  {
    id: 602, category: "ocd", difficulty: "Advanced",
    title: "The Mirror-Gazing Manager",
    scenario: "A 24-year-old male manager presents at the request of his partner. He spends 4–5 hours daily checking his nose in mirrors, believes it is 'grotesquely large and asymmetrical', has had two rhinoplasties (both deemed successful by surgeons), and continues to request surgery. He avoids social situations and has quit his job. He does not believe his concern is excessive.",
    guidedQuestions: ["What is the difference between BDD and narcissism?", "Why is surgery not therapeutic in BDD?", "What specific CBT techniques target BDD?", "How does insight affect prognosis?"],
    differentialDiagnosis: ["Body Dysmorphic Disorder (BDD) — most likely", "OCD", "Delusional Disorder — somatic type", "Social Anxiety Disorder", "Anorexia Nervosa (body image distortion)"],
    mseFinding: "Appearance: well-groomed, repeatedly touches nose. Behaviour: mirror checking, camouflaging. Speech: preoccupied with appearance. Mood: dysphoric, low self-esteem. Thought: overvalued idea (poor insight) regarding defect. Cognition: intact. Insight: poor.",
    mostLikelyDiagnosis: "Body Dysmorphic Disorder (Muscle Dysmorphia variant — absent here, but check)",
    initialManagement: "Psychoeducation (BDD is brain-based, not surgical). High-dose SSRI. CBT for BDD (mirror retraining, attention retraining). Strong guidance against further cosmetic procedures. Treat comorbid depression. Safety assessment (BDD has high suicide risk).",
    clinicalPearls: ["BDD has a ~25% lifetime suicidal ideation rate — always assess risk.", "Surgery NEVER improves BDD — patients either focus on new 'defects' or remain preoccupied with the original one.", "BDD with absent insight is classified as 'with absent insight/delusional beliefs' in DSM-5."]
  },
  {
    id: 701, category: "trauma", difficulty: "Intermediate",
    title: "The Veteran's Vigil",
    scenario: "A 34-year-old male ex-soldier, discharged 2 years ago, presents with his wife who insists 'he's not the same.' He has recurrent nightmares of a roadside bombing he witnessed, avoids television news and loud noises, startles easily, feels emotionally numb, has detached from his family, and reports feeling 'as if the future doesn't exist.' He has been drinking heavily to sleep. Symptoms began shortly after discharge.",
    guidedQuestions: ["What four symptom clusters define PTSD in DSM-5?", "How does complex PTSD (ICD-11) differ from DSM-5 PTSD?", "What is the evidence-based psychological treatment for PTSD?", "How does comorbid alcohol use affect treatment sequencing?"],
    differentialDiagnosis: ["PTSD — most likely", "Complex PTSD (ICD-11 — prominent emotional dysregulation and self-concept changes)", "Adjustment Disorder (onset >1 month post-trauma = not adjustment disorder)", "Alcohol Use Disorder (comorbid)", "Major Depressive Disorder"],
    mseFinding: "Appearance: hypervigilant, scanning environment. Behaviour: startles twice during interview. Speech: guarded, economy of words. Mood: flat, emotionally numb. Thought: intrusive memories, distorted blame ('I should have acted'). Perception: flashbacks reported. Insight: partial.",
    mostLikelyDiagnosis: "Post-Traumatic Stress Disorder (PTSD) with comorbid Alcohol Use Disorder",
    initialManagement: "Trauma-Focused CBT (TF-CBT) or EMDR — first-line. Address alcohol use (may need detox first). SSRI (sertraline/paroxetine). Avoid benzodiazepines. Veteran-specific services (e.g. Combat Stress). Safety planning. Sleep hygiene.",
    clinicalPearls: ["PTSD has 4 clusters: Re-experiencing, Avoidance, Negative cognitions/mood, Hyperarousal.", "EMDR (Eye Movement Desensitisation and Reprocessing) has strong evidence for PTSD — equivalent to TF-CBT.", "Do not use benzodiazepines in PTSD — they impair fear extinction and worsen outcomes."]
  },
  {
    id: 702, category: "trauma", difficulty: "Beginner",
    title: "The Bereaved Banker",
    scenario: "A 45-year-old bank manager presents 6 weeks after his wife's sudden death. He is tearful, has difficulty sleeping, has reduced appetite, and finds it hard to concentrate at work. He reports seeing her briefly in crowds (brief, correctable). He denies low mood between episodes of grief. He is functioning at work but with difficulty. He asks 'Is this depression?'",
    guidedQuestions: ["How do you distinguish normal grief from Major Depressive Disorder?", "What features would suggest Prolonged Grief Disorder?", "What is the role of pharmacotherapy in bereavement?", "What brief supportive intervention would you offer?"],
    differentialDiagnosis: ["Normal grief response — most likely", "Adjustment Disorder", "Major Depressive Disorder (if pervasive low mood, guilt, worthlessness emerge)", "Prolonged Grief Disorder (if >12 months with impaired functioning)", "Brief illusions (visual, in grief) — not psychosis"],
    mseFinding: "Appearance: dishevelled. Speech: tearful but normal rate. Mood: sad in waves, not persistently. Affect: appropriate to circumstances. Thought: grief-related rumination; brief perceptual illusion (correctable). Cognition: mild inattention. Insight: excellent.",
    mostLikelyDiagnosis: "Normal Grief Reaction (uncomplicated bereavement)",
    initialManagement: "Psychoeducation and normalisation. Active monitoring ('watchful waiting'). Brief supportive counselling. Bereavement support group signposting. Review in 4–6 weeks. Initiate antidepressant only if full MDD criteria develop.",
    clinicalPearls: ["In grief, mood fluctuates; in MDD, low mood is persistent. Grief involves yearning for the deceased; MDD involves pervasive worthlessness.", "Brief visual illusions of the deceased are normal in acute grief — not hallucinations.", "Prolonged Grief Disorder (DSM-5-TR): intense yearning/grief daily >12 months (>6 months in children)."]
  },
{
    id: 801, category: "somatic", difficulty: "Intermediate",
    title: "The Pain That Won't Be Explained",
    scenario: "A 44-year-old secondary school teacher has been referred from gastroenterology after 3 years of debilitating abdominal pain, bloating, nausea, and fatigue. She has had a colonoscopy, CT abdomen/pelvis, coeliac screen, and upper GI endoscopy — all normal. She has also attended rheumatology for joint pain (negative ANA and rheumatoid factor), and neurology for headaches (normal MRI). She has visited A&E 9 times. She carries a folder of her results and becomes visibly distressed when doctors suggest nothing is wrong, interpreting this as dismissal. She has reduced her working hours, avoids social activities, catastrophises each new symptom, and researches symptoms online for 2-3 hours daily. PHQ-9: 14 (moderate depression). She states explicitly: I know something serious is being missed.",
    guidedQuestions: ["How does DSM-5 define Somatic Symptom Disorder, and why is it not simply a diagnosis of exclusion?", "What is the psychological model driving symptom amplification and body-checking behaviours in SSD?", "How do you therapeutically communicate an SSD diagnosis to a patient who feels repeatedly dismissed by medicine?", "Why does reassurance paradoxically worsen symptoms in SSD, and what should you offer instead?"],
    differentialDiagnosis: ["Somatic Symptom Disorder (SSD) — most likely (chronic symptoms with disproportionate psychological response: excessive worry, time devoted over 1 hour per day, catastrophising)", "Illness Anxiety Disorder (if somatic symptoms are minimal and health preoccupation predominates — overlapping presentation)", "Functional Gastrointestinal Disorder / IBS (co-diagnostic, not mutually exclusive with SSD)", "MDD with prominent somatic features (PHQ-9 14 — treat concurrently)", "Fibromyalgia (overlapping chronic pain syndrome — not mutually exclusive with SSD)", "Factitious Disorder (deliberate production of symptoms — no evidence here)"],
    mseFinding: "Appearance: well-groomed, pale, carrying thick folder of medical notes. Behaviour: references notes repeatedly; tearful when investigations discussed; becomes defensive when psychological contribution is raised. Speech: extensive somatic narrative; redirects psychological framing back to physical symptoms. Mood: anxious, frustrated, and sad. Affect: distressed, congruent. Thought: overvalued belief in serious undiagnosed organic illness — not delusional, can briefly consider psychological contribution if approached carefully. Cognition: intact. Insight: poor regarding psychological component; good regarding functional impairment.",
    mostLikelyDiagnosis: "Somatic Symptom Disorder (SSD) with predominant pain and comorbid moderate MDD",
    initialManagement: "Therapeutic alliance is the treatment foundation — validate suffering without reinforcing illness behaviour. Use accessible language: Your pain is real AND caused by how your nervous system processes signals — not something being missed. Assign a single coordinating clinician to prevent further fragmented specialist referrals. Move to scheduled appointments rather than symptom-triggered visits to decouple healthcare contact from symptom escalation. CBT for SSD: target catastrophising, body-scanning behaviours, and health-seeking cycles. SSRI (sertraline) for comorbid depression and somatic amplification. Graded functional rehabilitation. Avoid further investigations unless new red flag symptoms emerge — each negative result provides brief reassurance followed by escalating anxiety.",
    clinicalPearls: ["SSD is defined by DISPROPORTIONATE and PERSISTENT psychological responses to symptoms — excessive worry, time devoted over 1 hour daily, catastrophising — and does NOT require medically unexplained symptoms. Organic disease and SSD can coexist.", "Reassurance has a paradoxical effect in SSD: brief relief followed by return to symptom-checking and escalating health anxiety. The therapeutic goal is building distress tolerance, not eliminating symptoms.", "Language matters enormously in SSD consultations. Your brain and body are miscommunicating is far more therapeutically effective than it is psychological — the latter triggers defensive rejection and damages the alliance."]
  },
  {
    id: 901, category: "eating", difficulty: "Intermediate",
    title: "The Shrinking Student",
    scenario: "A 17-year-old girl is brought by her mother. Over 8 months she has progressively restricted her food intake, fasting on alternate days, exercising 3 hours daily, and now weighs 39kg (BMI 14.8). She believes she is 'fat' despite appearing severely underweight. She denies low mood. Amenorrhoea for 4 months. Bradycardia (HR 48). Electrolytes: K+ 3.0 mmol/L.",
    guidedQuestions: ["What medical complications require urgent attention?", "What are MARSIPAN criteria for medical admission?", "How do you approach weight restoration?", "Why is insight often absent in anorexia?"],
    differentialDiagnosis: ["Anorexia Nervosa (Restricting type) — most likely", "Atypical Anorexia (normal weight — not applicable)", "Avoidant/Restrictive Food Intake Disorder (ARFID — no body image distortion)", "Depressive Disorder with poor appetite", "Organic cause: malabsorption, malignancy"],
    mseFinding: "Appearance: severely underweight, lanugo hair, cold peripheries. Speech: defensive about eating. Mood: euthymic subjectively; egosyntonic about weight. Thought: overvalued idea of fatness; denial of low weight. Cognition: intact. Insight: absent.",
    mostLikelyDiagnosis: "Anorexia Nervosa — Restricting Type (Severe: BMI <15)",
    initialManagement: "URGENT: medical stabilisation. Cardiac monitoring. Electrolyte correction. MARSIPAN assessment. Supervised refeeding (avoid refeeding syndrome — thiamine, phosphate monitoring). Family-Based Treatment (FBT/Maudsley) — first-line under 18. Inpatient if medically unstable or BMI <13.",
    clinicalPearls: ["Anorexia nervosa has the highest mortality of any psychiatric disorder — take medical complications seriously.", "Refeeding syndrome (hypophosphataemia causing cardiac arrhythmia) can occur in the first 2 weeks of refeeding.", "Egosyntonic nature of AN (patient does not want to change) makes engagement and motivation key therapeutic challenges."]
  },
  {
    id: 902, category: "eating", difficulty: "Intermediate",
    title: "The Binge-Purge Cycle",
    scenario: "A 22-year-old female student self-refers after reading an article about bulimia. She describes 3–4 binge episodes per week for the past year, eating thousands of calories in under an hour, followed by self-induced vomiting. She feels 'out of control' during binges, describes intense shame afterwards, but maintains a normal body weight. Dentist noted enamel erosion. Serum K+ 3.1 mmol/L.",
    guidedQuestions: ["How do binge eating disorder and bulimia nervosa differ?", "What are the medical consequences of purging?", "What is the evidence-based psychological treatment?", "What SSRI has a specific indication in bulimia?"],
    differentialDiagnosis: ["Bulimia Nervosa — most likely", "Binge Eating Disorder (no compensatory behaviour)", "Anorexia Nervosa — Binge-Purge type (BMI normal here)", "Purging Disorder (purging without binges)"],
    mseFinding: "Appearance: normal weight, slightly swollen parotid glands. Mood: ashamed, anxious. Thought: binge-purge rituals, negative body image, dietary rules. Cognition: intact. Insight: excellent (help-seeking).",
    mostLikelyDiagnosis: "Bulimia Nervosa",
    initialManagement: "CBT-ED (18-session protocol — first-line). Fluoxetine 60mg (only antidepressant with RCT evidence in BN — licensed indication). Monitor electrolytes. Dental referral. Nutritional counselling. Self-help resources (CBT-based). Treat comorbid depression.",
    clinicalPearls: ["Fluoxetine 60mg (not 20mg) is the only antidepressant licensed for bulimia nervosa.", "Russell's sign: calluses on dorsum of hand from self-induced vomiting — pathognomonic.", "CBT-ED targets the cognitive model: dietary restraint → negative affect → binge → purge → temporary relief → shame → repeat."]
  },
{
    id: 1001, category: "disruptive", difficulty: "Intermediate",
    title: "The Short Fuse",
    scenario: "A 33-year-old male security supervisor self-refers after losing his job following an incident where he overturned a colleague's desk and punched a wall during a disagreement about a rota change. He describes a pattern since his early 20s: 2-3 times monthly, without warning, he experiences a sudden surge of rage disproportionate to any provocation — shouting, throwing objects, and occasionally physical aggression towards objects but not people. Each episode lasts 5-10 minutes and is followed by significant remorse, shame, and fatigue, described as like a storm passing. Between episodes he is calm and sociable. He denies alcohol during episodes. He has no sustained elevated or depressed mood. He has no history of head injury. Neurological exam is normal. EEG and MRI brain are pending.",
    guidedQuestions: ["What DSM-5 criteria must be met to diagnose IED, and what thresholds distinguish it from trait irritability or anger?", "What organic conditions must be excluded, and why are EEG and neuroimaging mandatory before confirming an IED diagnosis?", "How do you differentiate IED from Bipolar Disorder with irritable episodes, Antisocial Personality Disorder, and ADHD?", "What is the evidence base for SSRI pharmacotherapy in IED, and what is the proposed neurobiological mechanism?"],
    differentialDiagnosis: ["Intermittent Explosive Disorder — most likely", "Bipolar Disorder with irritable episodes (no sustained mood elevation; episode duration fits IED not mania or hypomania)", "ADHD — impulsive presentation (clarify childhood inattention and hyperactivity history)", "Antisocial Personality Disorder (IED has genuine remorse and no pattern of callous disregard — key distinction)", "Temporal Lobe Epilepsy (automatisms, post-ictal confusion, possible EEG abnormalities — must be excluded)", "Frontal Lobe Lesion (disinhibition and poor impulse control — MRI mandatory)", "Alcohol-related disinhibition (denied during episodes — corroborate with collateral history)"],
    mseFinding: "Appearance: calm, well-groomed, appropriately dressed. Behaviour: cooperative, good eye contact, sits still throughout interview. Speech: normal rate, tone, and volume. Mood: embarrassed — I do not want to be like this. Affect: mild shame, congruent. Thought: no psychosis; intact insight into disproportionate nature of episodes; genuine distress at inability to control them. Cognition: intact (MoCA 28/30). Insight: good — help-seeking and motivated to change.",
    mostLikelyDiagnosis: "Intermittent Explosive Disorder (IED)",
    initialManagement: "Organic exclusion first: EEG (temporal lobe epilepsy), MRI brain (frontal and temporal lesions), bloods including glucose, TFTs, LFTs, and alcohol biomarkers (GGT, CDT). CBT focused on anger management: ABC model of anger (trigger, appraisal, response), impulse delay techniques, physiological de-arousal strategies, and problem-solving. SSRIs have the strongest pharmacological evidence — fluoxetine reduces aggression frequency and severity in RCTs, likely via serotonergic modulation of prefrontal inhibitory circuits. Mood stabilisers (valproate, lithium) if a significant affective component is identified. Avoid antipsychotics as first-line. Occupational rehabilitation support. Safety planning specifically addressing workplace aggression risk.",
    clinicalPearls: ["DSM-5 IED criteria require recurrent behavioural outbursts grossly disproportionate to provocation: either at least 2 episodes weekly of verbal or minor physical aggression over 3 months, OR at least 3 destructive or assaultive outbursts within 12 months. The aggression must not be premeditated and must cause genuine distress or impairment.", "Key distinction from Antisocial Personality Disorder: IED patients experience significant remorse after episodes; ASPD patients are indifferent to harm caused. Both may have histories of aggression — remorse is the critical differentiating feature.", "Fluoxetine has the best RCT evidence for IED. The proposed mechanism is serotonergic modulation of the prefrontal cortex and amygdala, reducing the threshold for impulse inhibition. Allow a minimum 6-8 week trial before assessing response."]
  },
  {
    id: 1101, category: "substance", difficulty: "Intermediate",
    title: "The Trembling Teacher",
    scenario: "A 52-year-old male teacher is brought to A&E. He reports drinking 'a bottle of wine daily' but on further history admits to a litre of vodka per day for 3 years. He last drank 18 hours ago. He has a coarse tremor, sweating, tachycardia (HR 108), and is anxious. He reports visual hallucinations of insects on the walls. CIWA-Ar score: 24. No jaundice. No focal neurology.",
    guidedQuestions: ["What is the mechanism of alcohol withdrawal?", "What is the risk of not treating this patient?", "What scoring tool guides treatment intensity?", "What vitamin deficiency must be urgently addressed?"],
    differentialDiagnosis: ["Alcohol withdrawal syndrome with hallucinosis — most likely", "Delirium Tremens (if more severe — disorientation, autonomic instability)", "Wernicke's Encephalopathy (check triad: confusion, ataxia, ophthalmoplegia)", "Alcohol-induced psychotic disorder", "Seizure disorder"],
    mseFinding: "Appearance: tremulous, diaphoretic. Behaviour: restless, agitated. Speech: slightly dysarthric. Mood: anxious, fearful. Perception: visual hallucinations (insects). Cognition: oriented but inattentive. Insight: limited.",
    mostLikelyDiagnosis: "Alcohol Withdrawal Syndrome with Hallucinosis (CIWA-Ar 24 — severe)",
    initialManagement: "URGENT: IV/oral chlordiazepoxide or diazepam (CIWA-Ar guided protocol). IV Pabrinex (thiamine — give BEFORE glucose). Seizure precautions. IV fluids. Cardiac monitoring. Refer to alcohol liaison team. Plan for relapse prevention (naltrexone/acamprosate) post-detox.",
    clinicalPearls: ["ALWAYS give IV thiamine (Pabrinex) BEFORE glucose in alcohol withdrawal — glucose without thiamine can precipitate Wernicke's encephalopathy.", "Delirium tremens (peak 48–72h after last drink) has 5–15% mortality if untreated.", "CIWA-Ar guides benzodiazepine dosing: <10 mild, 10–15 moderate, >15 severe withdrawal."]
  },
  {
    id: 1102, category: "substance", difficulty: "Advanced",
    title: "The Stimulant Spiral",
    scenario: "A 26-year-old male is brought to A&E by paramedics after being found in a park, agitated and paranoid. He believes people are following him and there are cameras in his teeth. He has been awake for 72 hours. His friend reports he has been using cocaine and MDMA heavily at clubs over the past 2 weeks. HR 128, BP 162/98, temperature 38.2°C. Pupils dilated. Urine drug screen: positive cocaine and amphetamines.",
    guidedQuestions: ["How do you distinguish stimulant psychosis from primary schizophrenia acutely?", "What is the management of acute stimulant intoxication?", "What timeframe does stimulant psychosis usually resolve within?", "What does persistence beyond 4 weeks suggest?"],
    differentialDiagnosis: ["Stimulant-induced psychotic disorder (cocaine/amphetamine) — most likely", "First-episode schizophrenia (precipitated by stimulant use)", "Bipolar I — manic episode with psychosis", "Serotonin syndrome (fever, rigidity — check)", "Amphetamine-induced hyperthermia"],
    mseFinding: "Appearance: agitated, diaphoretic, pupils dilated. Speech: pressured, incoherent. Mood: dysphoric, paranoid. Thought: persecutory delusions. Perception: possibly auditory hallucinations. Cognition: disoriented. Insight: absent.",
    mostLikelyDiagnosis: "Stimulant-Induced Psychotic Disorder (cocaine + amphetamine)",
    initialManagement: "Calm environment ('talk-down'). Oral/IM benzodiazepine for agitation. Short-term antipsychotic (haloperidol or olanzapine IM). Monitor: temperature, cardiac rhythm, BP. Hydration. Monitor for serotonin syndrome. Once settled: brief intervention re: substance use. Plan outpatient follow-up.",
    clinicalPearls: ["Stimulant psychosis is indistinguishable from acute schizophrenia — time and abstinence clarify the diagnosis.", "Stimulant psychosis typically resolves within days–weeks of abstinence; persistence >4 weeks suggests underlying primary psychosis.", "Serotonin syndrome triad: mental status change + autonomic instability + neuromuscular abnormalities — exclude urgently."]
  },
  {
    id: 1201, category: "neurocog", difficulty: "Intermediate",
    title: "The Forgetful Father",
    scenario: "A 68-year-old retired professor is brought by his son, who noticed increasing forgetfulness over 18 months. He gets lost driving familiar routes, repeats questions within minutes, misplaces items, and forgot his grandson's birthday for the first time. He remains physically well and manages basic ADLs with prompting. MMSE: 21/30 (loses orientation, registration, delayed recall). MOCA: 17/30.",
    guidedQuestions: ["What is the difference between dementia and normal ageing?", "What investigations form the standard dementia workup?", "How do you distinguish Alzheimer's from vascular dementia?", "What are the reversible causes of cognitive impairment?"],
    differentialDiagnosis: ["Alzheimer's Disease — most likely", "Vascular Dementia (stepwise decline + vascular risk factors)", "Lewy Body Dementia (fluctuating cognition, visual hallucinations, parkinsonism — absent here)", "Frontotemporal Dementia (personality/behaviour change > memory — absent here)", "Reversible: B12 deficiency, hypothyroidism, NPH"],
    mseFinding: "Appearance: well-groomed (wife helps). Behaviour: cooperative. Speech: word-finding pauses. Mood: mild anxiety about memory. Thought: no delusions. Cognition: MMSE 21/30 — deficits in orientation, registration, delayed recall. Insight: partial (acknowledges problems).",
    mostLikelyDiagnosis: "Alzheimer's Disease (Mild-Moderate stage)",
    initialManagement: "Blood tests: FBC, B12/folate, TFTs, glucose, LFTs, calcium, syphilis serology. MRI brain (medial temporal lobe atrophy). Initiate acetylcholinesterase inhibitor (donepezil). Carer support and education. DVLA notification discussion. LPA/advance care planning. Memory clinic referral.",
    clinicalPearls: ["Alzheimer's characteristically begins with anterograde episodic memory impairment — 'hippocampal amnesia'.", "Always exclude reversible causes: hypothyroidism, B12/folate deficiency, normal pressure hydrocephalus (NPH triad: wet, wobbly, wacky).", "Lewy body dementia: DO NOT use antipsychotics — risk of severe neuroleptic sensitivity reaction (50% mortality)."]
  },
  {
    id: 1301, category: "personality", difficulty: "Advanced",
    title: "The Chaotic Cutter",
    scenario: "A 23-year-old woman is referred after her 4th A&E presentation with self-harm (superficial lacerations) following relationship crises. She describes chronic emptiness, frantic efforts to avoid abandonment, intense and unstable relationships (idealising then devaluing), impulsive spending and substance use, and identity instability. She reports her mood shifts 'hourly'. No persistent psychosis. No manic episodes.",
    guidedQuestions: ["What nine criteria define BPD in DSM-5?", "How do you distinguish BPD from bipolar disorder?", "What is the evidence-based treatment for BPD?", "How do you approach risk in the context of chronic self-harm?"],
    differentialDiagnosis: ["Borderline Personality Disorder — most likely", "Bipolar II (mood instability is hours, not days — argues against)", "Complex PTSD (trauma history common in BPD)", "Emotionally Unstable Personality Disorder (ICD-11 term)", "MDD with chronic suicidality"],
    mseFinding: "Appearance: multiple self-harm scars on forearms. Behaviour: initially idealising, then testing limits. Speech: rapid when distressed. Mood: labile ('I feel empty right now'). Thought: transient paranoid ideation under stress. Cognition: intact. Insight: partial.",
    mostLikelyDiagnosis: "Borderline Personality Disorder (Emotionally Unstable PD — ICD-11)",
    initialManagement: "Dialectical Behaviour Therapy (DBT) — gold standard. Structured outpatient programme. Avoid polypharmacy (no medications specifically licensed; low-dose antipsychotic for transient psychosis PRN). Consistent therapeutic relationship. Crisis plan. Reduce unnecessary A&E attendance through good community care.",
    clinicalPearls: ["DBT (Marsha Linehan) has the strongest RCT evidence for BPD — focuses on distress tolerance, emotional regulation, interpersonal effectiveness, mindfulness.", "BPD mood swings last hours; bipolar mood episodes last days to weeks — this distinction is diagnostically critical.", "Chronic low-lethality self-harm in BPD represents emotional regulation — different risk profile from MDD suicidality; both require individual assessment."]
  },
{
    id: 1401, category: "history", difficulty: "Advanced",
    title: "The Reluctant Referral",
    scenario: "You are a foundation doctor on-call at 11pm. A 41-year-old man is referred to psychiatric liaison by the medical team after admission following a paracetamol overdose — 12 tablets, plasma level subtherapeutic. He told the nurse it was stupid, I just wanted to sleep. On approaching the bedside, he is lying with his back to you and says: I don't want to talk to a psychiatrist — I'm not mental. He smells of alcohol. The medical team note he has attended A&E 6 times in the past 18 months with similar presentations. His GP records show diagnoses of recurrent depressive disorder and alcohol dependence. He was last seen in community mental health 2 years ago and disengaged from services. The nurse reports he keeps asking to self-discharge.",
    guidedQuestions: ["How do you open the assessment to build therapeutic rapport with a patient who explicitly does not want to engage with psychiatry?", "What is a structured approach to suicide risk assessment — including static and dynamic risk factors, and the distinction between a risk checklist and a clinical risk formulation?", "What are the essential domains of a complete psychiatric history you must cover despite his reluctance, and what collateral sources should you access?", "What are the Mental Capacity Act considerations, and under what circumstances could you use a Section 5(2) or proceed to full MHA assessment?"],
    differentialDiagnosis: ["Recurrent Major Depressive Disorder — moderate episode (known diagnosis, current presentation consistent)", "Alcohol Use Disorder — dependence (known diagnosis; acute intoxication complicating assessment)", "Adjustment Disorder (identify precipitating stressor in history)", "Emotionally Unstable Personality Disorder (6 A&E presentations in 18 months, impulsivity — screen formally)", "Acute alcohol intoxication temporarily mimicking hopelessness (reassess mental state when sober)"],
    mseFinding: "Appearance: dishevelled, hospital gown, smell of alcohol. Behaviour: turned away, arms crossed on approach; gradually turns over after 5 minutes when approached without judgment. Speech: initially monosyllabic; more expansive after rapport established; mildly slurred from alcohol. Mood: fed up — everything is pointless. Affect: low and congruent; tearful briefly when asked about family. Thought: passive suicidal ideation currently; no active plan; expresses some ambivalence and reasons for living. Perception: nil abnormal. Cognition: oriented; formal cognitive testing limited by intoxication. Insight: limited — externalises difficulties; reluctant to accept psychiatric illness label.",
    mostLikelyDiagnosis: "Recurrent MDD — Moderate Episode with comorbid Alcohol Dependence; acute-on-chronic suicide risk following low-lethality impulsive overdose",
    initialManagement: "Immediate: confirm medical clearance — paracetamol levels, LFTs, INR. Engage with empathy and non-judgmental stance before any structured questioning. Risk formulation: low acute lethality (subtherapeutic overdose, impulsive act, ambivalent) but chronic elevated risk (repeated presentations, alcohol dependence, service disengagement). Do not discharge while intoxicated. Capacity: if sober, he likely has capacity to refuse treatment — document this carefully. If intoxicated, capacity is impaired. Informal admission preferred; if he refuses and risk is assessed as high, consider s.5(2) MHA (doctor's holding power, 72 hours) to allow sober reassessment and formal MHA assessment if needed. Immediate actions: safe prescribing with limited dispensing, crisis safety plan, CIWA-Ar for alcohol withdrawal monitoring, warm re-referral to CMHT with 72-hour follow-up. Restart antidepressant if previously effective once medically clear.",
    clinicalPearls: ["Risk formulation is a clinical narrative — not a checklist. It integrates static factors (past attempts, male sex, older age, alcohol dependence) with dynamic factors (current intent, degree of hopelessness, social support, reasons for living) to generate an individualised risk and management plan.", "The therapeutic approach to a reluctant patient is itself a clinical skill. Starting with empathy — You look exhausted, that makes sense after a night like this — achieves more clinically meaningful engagement than beginning with structured risk questions.", "Alcohol intoxication confounds psychiatric assessment. Formal mental state examination and suicide risk assessment should ideally be repeated when sober. Always document: assessment limited by alcohol intoxication — clinical judgment and collateral history used to guide immediate management decisions."]
  },
{
    id: 1501, category: "mse_cases", difficulty: "Intermediate",
    title: "Not Herself Since the Baby",
    scenario: "A 31-year-old woman is brought to the psychiatric emergency clinic by her husband 6 weeks after the birth of their first child. Her husband reports: She has not slept more than 2 hours in the past 3 days, she is saying the baby is not hers — that the real baby was taken in hospital, she believes the midwives put a tracking device in the pram, and yesterday she tried to take the baby to a police station to report a kidnapping. She is breastfeeding and insists she will not stop. She has no personal psychiatric history. Her mother was treated for bipolar disorder. She appears dishevelled, is speaking rapidly, and is deeply suspicious of the registrar. The baby is currently being cared for by the husband in the waiting room.",
    guidedQuestions: ["Construct a complete Mental Status Examination for this patient, working through each domain systematically using the clinical information provided.", "What is your differential diagnosis, and what clinical features point towards postpartum psychosis versus new-onset schizophrenia versus a primary manic episode?", "What are the immediate clinical priorities in order — before any pharmacological treatment is initiated?", "What are the specific prescribing considerations for a breastfeeding woman requiring antipsychotic and mood stabiliser treatment?"],
    differentialDiagnosis: ["Postpartum Psychosis — most likely (onset within 6 weeks, mixed psychotic and affective features, primiparous, positive family history of bipolar disorder)", "Bipolar I Disorder — Manic Episode with Psychotic Features (family history, reduced sleep without fatigue, pressured speech, grandiosity)", "Brief Psychotic Disorder with Peripartum Onset (if symptoms resolve fully within 1 month)", "Postpartum MDD with Psychotic Features (psychomotor retardation would typically be more prominent)", "Organic cause: postpartum thyroiditis (TFTs essential), autoimmune encephalitis (consider anti-NMDAR antibodies if atypical course)"],
    mseFinding: "APPEARANCE: Dishevelled, hair unwashed, wearing mismatched clothing. BEHAVIOUR: Hypervigilant, glances repeatedly towards door, tense throughout. PSYCHOMOTOR: Agitated — cannot remain seated for more than 30 seconds. SPEECH: Pressured, rapid, frequently interrupted by new thoughts, loud. MOOD (subjective): I am not unwell — I am trying to protect my baby. Nobody believes me. AFFECT (objective): Labile — oscillates between agitated suspicion and tearful distress; not purely euphoric. THOUGHT FORM: Racing, circumstantial, difficult to redirect. THOUGHT CONTENT: Persecutory delusions (hospital staff, tracking device in pram); Capgras delusion (baby is an impostor); no suicidal ideation; preoccupied with infant safety. PERCEPTION: Possible auditory hallucinations — guarded: I hear people talking about me through the walls. COGNITION: Oriented to person and place; disoriented to date; unable to complete serial 7s. INSIGHT: Absent — denies illness, refuses voluntary treatment and admission.",
    mostLikelyDiagnosis: "Postpartum Psychosis — Bipolar Spectrum (most likely)",
    initialManagement: "IMMEDIATE PRIORITIES IN ORDER: (1) INFANT SAFETY — safeguarding assessment; do not leave infant alone with mother until risk is formally assessed; paediatric liaison and social work referral mandatory. (2) CAPACITY ASSESSMENT — she currently lacks capacity to make treatment decisions due to cognitive disorganisation, absent insight, and inability to weigh information. (3) MENTAL HEALTH ACT ASSESSMENT — Section 2 MHA (assessment and treatment, 28 days) indicated given risk to infant and self, and refusal of voluntary admission. (4) MOTHER AND BABY UNIT — admission to specialist MBU where available to preserve bonding safely. (5) PHARMACOLOGY: Haloperidol or olanzapine IM acutely for agitation; breastfeeding compatibility: quetiapine (lowest milk transfer ratio) or olanzapine preferred; lithium is contraindicated in breastfeeding due to neonatal toxicity. (6) INVESTIGATIONS: TFTs (postpartum thyroiditis), FBC, CRP, glucose, and anti-NMDAR antibodies if atypical. (7) FAMILY SUPPORT: Husband requires immediate psychoeducation, emotional support, and a practical childcare plan.",
    clinicalPearls: ["Postpartum psychosis is a psychiatric emergency with approximately 5% risk of infanticide and 4% risk of maternal suicide. Onset is typically within 2 weeks of delivery — this case at 6 weeks is at the outer range but remains consistent. Never discharge without a comprehensive safety plan.", "The Capgras delusion — the belief that a familiar person or object has been replaced by an identical impostor — is strongly associated with postpartum psychosis and organic brain conditions. Its presence significantly increases diagnostic confidence.", "Breastfeeding and psychiatric pharmacotherapy are not mutually exclusive. Quetiapine and olanzapine have the lowest breast milk transfer ratios among commonly used antipsychotics. Lithium and clozapine are contraindicated in breastfeeding. Always involve a perinatal specialist or pharmacist."]
  },
];

/* ── category colour helper ── */
function catColor(catId) {
  return CASE_CATEGORIES.find(c => c.id === catId)?.color || ACCENT;
}

/* ── collapsible section in case detail ── */
function CaseSection({ title, color, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 10, border: `1px solid ${color}22`, borderRadius: 10, overflow: "hidden" }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: "100%", background: `${color}12`, border: "none", padding: "9px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", fontFamily: "inherit" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{title}</span>
        <span style={{ fontSize: 14, color }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div style={{ padding: "10px 14px", background: "#fff" }}>{children}</div>}
    </div>
  );
}

function ClinicalCases({ progress, setProgress, user }) {
  const [selectedCat, setSelectedCat] = useState(null);
  const [selectedCase, setSelectedCase] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [limitError, setCCLimitError] = useState("");
  const chatRef = useRef(null);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [chatHistory]);

  const casesInCat = selectedCat ? CASES.filter(c => c.category === selectedCat) : [];
  const color = catColor(selectedCat);

  async function openCase(c) {
    setSelectedCase(c);
    setLoading(true);
    const sys = `You are a psychiatry tutor. Case: "${c.scenario}". Diagnosis: ${c.mostLikelyDiagnosis}. Guide the student through reasoning. Be Socratic. Do NOT reveal the diagnosis immediately. Under 120 words per response.`;
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const result = await askAI(
        "mse",
        [{ role: "user", content: "I've read the case. Where should I start my clinical reasoning?" }],
        { domain: "Case discussion", description: sys },
        session
      );
      setChatHistory([{ role: "assistant", content: result.text }]);
    } catch (err) {
      setChatHistory([{ role: "assistant", content: "⚠️ " + err.message }]);
    }
    setLoading(false);
    if (!progress.cases.completed.includes(c.id)) {
      setProgress(p => ({ ...p, cases: { completed: [...p.cases.completed, c.id] } }));
    }
  }

  async function sendMsg() {
    if (!input.trim() || loading) return;
    const msg = input.trim(); setInput("");
    const newH = [...chatHistory, { role: "user", content: msg }];
    setChatHistory(newH); setLoading(true);
    const sys = `Psychiatry tutor for case: "${selectedCase?.scenario}". Diagnosis: ${selectedCase?.mostLikelyDiagnosis}. Pearls: ${selectedCase?.clinicalPearls?.join(" | ")}. Be Socratic, concise. Under 140 words.`;
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const result = await askAI("mse", newH, { domain: "Case discussion", description: sys }, session);
      setChatHistory([...newH, { role: "assistant", content: result.text }]);
    } catch (err) {
      setChatHistory([...newH, { role: "assistant", content: "⚠️ " + err.message }]);
    }
    setLoading(false);
  }

  /* ── CASE DETAIL VIEW ── */
  if (selectedCase) {
    const cc = catColor(selectedCase.category);
    const done = progress.cases.completed.includes(selectedCase.id);
    return (
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: "1rem", flexWrap: "wrap" }}>
          <button onClick={() => { setSelectedCase(null); setChatHistory([]); }} style={{ ...S.btn("outline"), fontSize: 13 }}>← Back to Cases</button>
          <button onClick={() => { setSelectedCase(null); setSelectedCat(null); setChatHistory([]); }} style={{ ...S.btn("ghost"), fontSize: 13, color: "#64748b" }}>← All Categories</button>
        </div>
        <div style={{ ...S.card, borderTop: `4px solid ${cc}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <div>
              <span style={{ ...S.badge(), background: `${cc}18`, color: cc }}>{selectedCase.difficulty}</span>
              <span style={{ ...S.badge("teal") }}>{CASE_CATEGORIES.find(c => c.id === selectedCase.category)?.label}</span>
            </div>
            {done && <span style={{ fontSize: 12, color: TEAL, fontWeight: 700 }}>✓ Completed</span>}
          </div>
          <h2 style={{ ...S.sectionTitle, color: cc, marginBottom: 10 }}>{selectedCase.title}</h2>

          {/* Scenario */}
          <div style={{ background: "#F8FAFC", borderRadius: 8, padding: "1rem", fontSize: 14, lineHeight: 1.85, color: "#334155", borderLeft: `4px solid ${cc}`, marginBottom: 12 }}>
            {selectedCase.scenario}
          </div>

          {/* Collapsible sections */}
          <CaseSection title="🔍 Guided Questions" color={cc} defaultOpen={true}>
            {selectedCase.guidedQuestions.map((q, i) => (
              <div key={i} style={{ fontSize: 13, color: "#334155", marginBottom: 7, display: "flex", gap: 8 }}>
                <span style={{ color: cc, fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                <span>{q}</span>
              </div>
            ))}
          </CaseSection>

          <CaseSection title="⚖️ Differential Diagnosis" color="#DC2626">
            {selectedCase.differentialDiagnosis.map((d, i) => (
              <div key={i} style={{ fontSize: 13, color: "#334155", marginBottom: 5, paddingLeft: 8, borderLeft: i === 0 ? "3px solid #DC2626" : "3px solid #E2E8F0" }}>
                {i === 0 ? <strong>{d}</strong> : d}
              </div>
            ))}
          </CaseSection>

          <CaseSection title="🧠 MSE Findings" color={TEAL}>
            <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.75 }}>{selectedCase.mseFinding}</div>
          </CaseSection>

          <CaseSection title="✅ Most Likely Diagnosis" color={TEAL} defaultOpen={true}>
            <div style={{ fontSize: 14, fontWeight: 700, color: TEAL, background: TEAL_LIGHT, borderRadius: 8, padding: "8px 12px" }}>{selectedCase.mostLikelyDiagnosis}</div>
          </CaseSection>

          <CaseSection title="💊 Initial Management" color={ACCENT}>
            <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.75 }}>{selectedCase.initialManagement}</div>
          </CaseSection>

          <CaseSection title="💡 Clinical Pearls" color={AMBER}>
            {selectedCase.clinicalPearls.map((p, i) => (
              <div key={i} style={{ fontSize: 13, color: "#1e293b", marginBottom: 7, background: "#FFFBEB", borderRadius: 6, padding: "6px 10px", borderLeft: `3px solid ${AMBER}` }}>
                💡 {p}
              </div>
            ))}
          </CaseSection>
        </div>

        {/* AI Discussion */}
        <div style={S.card}>
          <div style={{ fontWeight: 700, color: ACCENT, marginBottom: 8, fontSize: 14 }}>🤖 Discuss with PsychAI Tutor</div>
          <div ref={chatRef} style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 300, overflowY: "auto", marginBottom: "1rem" }}>
            {chatHistory.map((m, i) => <div key={i} style={S.bubble(m.role)}>{m.role === "assistant" && <span style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 3 }}>🤖 PsychAI Tutor</span>}{m.content}</div>)}
            {loading && <div style={S.bubble("assistant")}><span style={{ color: "#94a3b8" }}>Thinking…</span></div>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={S.input} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMsg()} placeholder="Ask about this case or share your reasoning…" />
            <button style={S.btn()} onClick={sendMsg} disabled={loading}>Send Message</button>
          </div>
        </div>
      </div>
    );
  }

  /* ── CASES IN CATEGORY VIEW ── */
  if (selectedCat) {
    return (
      <div>
        <button onClick={() => setSelectedCat(null)} style={{ ...S.btn("outline"), marginBottom: "1rem", fontSize: 13 }}>← All Categories</button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "0.5rem" }}>
          <span style={{ fontSize: 24 }}>{CASE_CATEGORIES.find(c => c.id === selectedCat)?.icon}</span>
          <h2 style={{ ...S.sectionTitle, marginBottom: 0, color }}>{CASE_CATEGORIES.find(c => c.id === selectedCat)?.label}</h2>
        </div>
        <p style={S.sectionSub}>{casesInCat.length} case{casesInCat.length !== 1 ? "s" : ""} · Click to open</p>
        {casesInCat.map(c => {
          const done = progress.cases.completed.includes(c.id);
          return (
            <div key={c.id} style={{ ...S.card, cursor: "pointer", borderLeft: `4px solid ${done ? TEAL : color}` }} onClick={() => openCase(c)}
              onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.10)"}
              onMouseLeave={e => e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)"}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                <span style={{ ...S.badge(), background: `${color}18`, color }}>{c.difficulty}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: done ? TEAL : color }}>{done ? "✓ Completed" : "Open Case →"}</span>
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1e293b", marginBottom: 4 }}>{c.title}</div>
              <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>{c.scenario.slice(0, 160)}…</div>
              <div style={{ marginTop: 8, display: "flex", gap: 12, fontSize: 12, color: "#94a3b8" }}>
                <span>🔍 {c.differentialDiagnosis.length} differentials</span>
                <span>💡 {c.clinicalPearls.length} pearls</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  /* ── CATEGORY BROWSER (home) ── */
  const completedIds = progress.cases.completed;
  const filteredCats = searchQ
    ? CASE_CATEGORIES.filter(cat => {
        const term = searchQ.toLowerCase();
        return cat.label.toLowerCase().includes(term) || CASES.filter(c => c.category === cat.id).some(c => c.title.toLowerCase().includes(term) || c.scenario.toLowerCase().includes(term));
      })
    : CASE_CATEGORIES;

  return (
    <div>
      <h2 style={S.sectionTitle}>🩺 Clinical Cases</h2>
      <p style={S.sectionSub}>15 DSM-5 category modules · {CASES.length} cases total · {completedIds.length} completed</p>

      <div style={{ marginBottom: "1.25rem" }}>
        <input style={S.input} value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="🔍  Search categories or cases…" />
      </div>

      {/* Overall progress */}
      <div style={{ ...S.card, padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>Overall Progress</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: TEAL }}>{completedIds.length} / {CASES.length} cases</span>
        </div>
        <ProgressBar value={completedIds.length} max={CASES.length} color={TEAL} height={10} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "0.875rem" }}>
        {filteredCats.map(cat => {
          const catCases = CASES.filter(c => c.category === cat.id);
          const catDone = catCases.filter(c => completedIds.includes(c.id)).length;
          return (
            <button key={cat.id} onClick={() => setSelectedCat(cat.id)}
              style={{ ...S.card, cursor: "pointer", textAlign: "left", marginBottom: 0, padding: "1rem 1.125rem", borderTop: `3px solid ${cat.color}`, transition: "box-shadow 0.15s, transform 0.12s" }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.10)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)"; e.currentTarget.style.transform = "translateY(0)"; }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <span style={{ fontSize: 22 }}>{cat.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: catDone === catCases.length && catCases.length > 0 ? TEAL : "#94a3b8" }}>
                  {catDone}/{catCases.length}
                </span>
              </div>
              <div style={{ fontWeight: 700, fontSize: 13, color: cat.color, margin: "6px 0 3px", lineHeight: 1.3 }}>{cat.label}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>{catCases.length} case{catCases.length !== 1 ? "s" : ""}</div>
              {catCases.length > 0 && <ProgressBar value={catDone} max={catCases.length} color={cat.color} height={4} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   OSCE SIMULATOR — FULL REBUILD
══════════════════════════════════════════ */

const OSCE_STATIONS = [
  {
    id: 1,
    category: "Psychosis",
    categoryColor: PURPLE,
    title: "First-Episode Psychosis",
    duration: 8,
    difficulty: "Intermediate",
    patientName: "Jamie",
    patientAge: "22-year-old",
    setting: "Outpatient psychiatry clinic",
    presenting: "Referred by GP after family reported odd behaviour for several months",
    briefing: "You are a medical student. Take a focused psychiatric history from this patient. You have 8 minutes. Explore their presenting complaints, elicit symptoms, and assess insight.",
    patientPersona: `You are Jamie, a 22-year-old university student. You are guarded and suspicious. You speak slowly and cautiously. You believe your neighbours have been installing microphones in your flat to spy on you. You've been hearing a voice commenting on your actions in the third person ("He's making tea now"). You stopped going to lectures 3 months ago because it feels unsafe. You haven't told your family the real reason. You think the doctors might be part of the conspiracy but you've come because your mum insisted. When directly asked, you reluctantly share: you hear one male voice outside your head, started about 4 months ago. You haven't slept well in weeks. You have no thoughts of self-harm. You have never used drugs. You do NOT volunteer information — wait to be asked specific questions. If asked about mood: "I feel scared most of the time." If asked about hallucinations without using that word: deny. Only admit if asked directly "do you hear voices?" Respond in character. Keep responses under 90 words.`,
    keyAreas: ["Rapport and opening", "Hallucinations — type, frequency, onset", "Delusions — nature, fixity, insight", "Risk (self-harm, harm to others)", "Sleep, appetite, function", "Social history and triggers", "Past psychiatric and medical history", "Insight and treatment attitude"],
    missedQuestionPenalties: [
      { question: "Direct ask about hearing voices", weight: 3 },
      { question: "Risk assessment — self-harm", weight: 3 },
      { question: "Duration and onset of symptoms", weight: 2 },
      { question: "Impact on functioning (university, social)", weight: 2 },
      { question: "Insight — does patient think they are unwell?", weight: 2 },
      { question: "Drug and alcohol history", weight: 2 },
      { question: "Family psychiatric history", weight: 1 },
    ],
    diagnosis: "Schizophrenia (first episode) — positive symptoms: third-person auditory hallucinations, persecutory delusions",
    markingScheme: { communication: "Rapport building, empathy, non-leading questions, active listening", safety: "Explicitly assessed self-harm and harm to others", clinical: "Elicited hallucination type, delusional content, onset, insight, functioning" },
  },
  {
    id: 2,
    category: "Depression",
    categoryColor: ACCENT,
    title: "Major Depressive Disorder",
    duration: 8,
    difficulty: "Beginner",
    patientName: "Sarah",
    patientAge: "34-year-old",
    setting: "GP surgery consultation room",
    presenting: "Came at partner's insistence. Describes feeling 'a bit low' for the past 2 months.",
    briefing: "You are a medical student on GP placement. Take a focused history to assess the patient's mood. Assess severity, safety, and impact on functioning. You have 8 minutes.",
    patientPersona: `You are Sarah, a 34-year-old teacher. You are initially reluctant to talk and minimise your symptoms. You say things like "I'm probably just tired" and "I don't want to waste the doctor's time." If the student is warm and asks follow-up questions, you gradually open up. Your real situation: you've felt persistently low for 8 weeks. You can't enjoy anything (you used to love gardening — not interested now). You are sleeping 10–11 hours but still exhausted. You have poor appetite and have lost 4kg. You have difficulty concentrating at work. You have thoughts of "wishing you wouldn't wake up" but deny active plans or intent to harm yourself. You feel worthless and guilty about being a burden. You have no previous episodes. No family history. No substance use. Respond in character. Under 90 words. Show emotion — pause, get slightly tearful when asked about enjoyment.`,
    keyAreas: ["Warm opening, rapport", "Core mood symptoms (low mood, anhedonia)", "Biological symptoms (sleep, appetite, energy)", "Cognitive symptoms (concentration, worthlessness, guilt)", "Safety assessment — suicidal ideation", "Duration and onset", "Impact on work and relationships", "Exclude bipolar (past episodes of elevated mood)", "Past history and family history"],
    missedQuestionPenalties: [
      { question: "Directly asking about anhedonia (enjoyment/pleasure)", weight: 3 },
      { question: "Explicit safety assessment (thoughts of death/suicide)", weight: 3 },
      { question: "Biological symptoms — sleep and appetite", weight: 2 },
      { question: "Duration of symptoms", weight: 2 },
      { question: "Past episodes of elevated mood (bipolar screen)", weight: 2 },
      { question: "Impact on work/daily functioning", weight: 2 },
      { question: "Drug and alcohol use", weight: 1 },
    ],
    diagnosis: "Major Depressive Disorder — Moderate severity, with passive suicidal ideation",
    markingScheme: { communication: "Warm tone, normalising language, non-judgmental, allows silence", safety: "Explored suicidal thoughts, plans, intent, and protective factors", clinical: "Covered core + biological + cognitive symptoms, excluded bipolar, assessed duration" },
  },
  {
    id: 3,
    category: "Mania",
    categoryColor: "#D97706",
    title: "Acute Manic Episode",
    duration: 8,
    difficulty: "Intermediate",
    patientName: "Marcus",
    patientAge: "28-year-old",
    setting: "Psychiatric emergency department",
    presenting: "Brought in by partner. Has not slept in 3 days. Partner reports dramatic change in behaviour.",
    briefing: "You are the FY2 doctor assessing this patient in the ED. Take a psychiatric history. The patient is alert and cooperative but very energetic. Focus on manic symptoms, risk, and safety. 8 minutes.",
    patientPersona: `You are Marcus, a 28-year-old marketing manager. You are VERY energetic, speak rapidly, and feel INCREDIBLE. You interrupt a lot. You think you've just had a breakthrough business idea worth millions and stayed up 3 nights planning it. You have no idea why your partner is worried. Key symptoms to reveal if asked: No sleep for 3 days (don't feel tired AT ALL), spending £5,000 on equipment for new business, texting everyone at 3am, feel like your thoughts are racing and you can't keep up, very irritable when challenged. You have had one previous similar episode 2 years ago that resolved after "a couple of weeks." You've been drinking more (2 bottles of wine last night "to celebrate"). No drug use. When asked about mood: "I feel AMAZING, better than I've EVER felt." Deny any depressive symptoms. No suicidal thoughts. No psychotic symptoms unless directly asked — in which case say "sometimes it feels like I don't need sleep because I'm special." Under 90 words per response. Be enthusiastic and slightly over-familiar.`,
    keyAreas: ["Elevated/irritable mood", "Decreased sleep without fatigue", "Grandiosity", "Pressured speech / flight of ideas", "Impulsive behaviour (spending, risky decisions)", "Risk assessment", "Past episodes and family history", "Substance use", "Insight and voluntary treatment attitude"],
    missedQuestionPenalties: [
      { question: "Sleep — decreased need without fatigue", weight: 3 },
      { question: "Grandiosity or inflated self-esteem", weight: 2 },
      { question: "Risk — financial, sexual, or physical harm", weight: 3 },
      { question: "Past episodes of mania or depression", weight: 2 },
      { question: "Insight — does patient recognise they are unwell?", weight: 2 },
      { question: "Substance use (alcohol/drugs)", weight: 2 },
      { question: "Family history of bipolar disorder", weight: 1 },
    ],
    diagnosis: "Bipolar I Disorder — Current manic episode (first presentation vs. recurrence)",
    markingScheme: { communication: "Manages rapid speech, redirects without dismissing, maintains rapport under pressure", safety: "Assessed financial/sexual/physical impulsivity risks", clinical: "Covered DIGFAST criteria, past history, insight, bipolar screen" },
  },
  {
    id: 4,
    category: "OCD",
    categoryColor: "#059669",
    title: "Obsessive-Compulsive Disorder",
    duration: 8,
    difficulty: "Intermediate",
    patientName: "Priya",
    patientAge: "26-year-old",
    setting: "Outpatient psychiatry clinic",
    presenting: "Self-referred after researching her symptoms online. Distressed and embarrassed.",
    briefing: "Take a psychiatric history exploring the patient's main concerns. Sensitively elicit the nature of any obsessions and compulsions, assess severity and impact. 8 minutes.",
    patientPersona: `You are Priya, a 26-year-old nurse. You are very embarrassed and initially reluctant to share the details of your thoughts. You say: "You'll think I'm crazy." You need the student to be warm and non-judgmental before you open up. Your real symptoms: you have intrusive thoughts that you might harm a patient by giving the wrong medication — even though you've never made an error. These thoughts are completely against your values (ego-dystonic). To neutralise them you check drug charts repeatedly (5–10 times per drug), wash your hands excessively (over 60 times per shift), and re-read patient notes repeatedly. You spend 3+ hours per shift on rituals. You KNOW the thoughts are irrational but you can't stop them. You are considering quitting nursing. Low mood as a secondary feature. No suicidal thoughts. When asked about "intrusive thoughts": reveal them only if the student asks specifically and empathetically. Respond under 90 words. Show shame initially, then relief when understood.`,
    keyAreas: ["Warm empathic rapport", "Nature of intrusive thoughts (ego-dystonic)", "Compulsive behaviours and rituals", "Time spent on rituals", "Insight — ego-dystonic nature", "Functional impact (work, relationships)", "Mood (secondary depression)", "Safety assessment", "Past history and family history of OCD"],
    missedQuestionPenalties: [
      { question: "Directly asking about intrusive thoughts", weight: 3 },
      { question: "Ego-dystonic nature — does patient resist thoughts?", weight: 3 },
      { question: "Time spent on rituals per day", weight: 2 },
      { question: "Impact on occupation and daily life", weight: 2 },
      { question: "Mood — secondary depression", weight: 2 },
      { question: "Safety assessment", weight: 2 },
      { question: "Past history or family history", weight: 1 },
    ],
    diagnosis: "OCD — Contamination obsessions with checking and washing compulsions (occupational impairment)",
    markingScheme: { communication: "Non-judgmental language, normalisation ('many people experience…'), allows patient to disclose at own pace", safety: "Assessed mood and suicidal ideation", clinical: "Distinguished obsessions from delusions, assessed ego-dystonic nature, quantified severity" },
  },
  {
    id: 5,
    category: "Anxiety",
    categoryColor: "#0891B2",
    title: "Generalised Anxiety Disorder",
    duration: 8,
    difficulty: "Beginner",
    patientName: "Tom",
    patientAge: "41-year-old",
    setting: "GP surgery",
    presenting: "Presents with headaches and insomnia. GP suspects an underlying anxiety disorder.",
    briefing: "You are a medical student. The GP has asked you to take a history to explore possible anxiety. The patient has been investigated medically — all tests normal. Explore the anxiety, associated symptoms, and impact. 8 minutes.",
    patientPersona: `You are Tom, a 41-year-old accountant. You present with physical complaints — headaches and inability to sleep — and initially attribute everything to work stress. You don't consider yourself an "anxious person." Your real symptoms: you worry constantly about everything — work deadlines, your children's health, finances, whether you've locked the front door — for the past 9 months. It's very hard to control the worry. Associated symptoms: restlessness (fidgeting all the time), muscle tension (neck and shoulders), fatigue, difficulty concentrating (missing details at work), irritability (snapping at partner). Sleep: takes 2+ hours to fall asleep because "my mind won't switch off." No panic attacks. No specific phobias. No obsessions or compulsions. No low mood. No suicidal thoughts. If asked about worry: "I know it's irrational but I can't stop — I run through worst-case scenarios all day." Respond under 90 words. Seem slightly exasperated, like you've been dealing with this alone for ages.`,
    keyAreas: ["Opening and rapport", "Nature and content of worries", "Difficulty controlling worry", "GAD associated symptoms (restlessness, fatigue, tension, concentration, irritability, sleep)", "Duration (≥6 months required)", "Rule out panic disorder, phobias, OCD", "Rule out depression", "Impact on functioning", "Physical health and medication screen"],
    missedQuestionPenalties: [
      { question: "Asking about specific worries and their content", weight: 2 },
      { question: "Difficulty controlling worry", weight: 3 },
      { question: "Duration — longer than 6 months?", weight: 2 },
      { question: "At least 3 associated somatic symptoms (GAD criteria)", weight: 3 },
      { question: "Rule out panic attacks / phobias / OCD", weight: 2 },
      { question: "Screen for depression", weight: 2 },
      { question: "Impact on daily functioning", weight: 1 },
    ],
    diagnosis: "Generalised Anxiety Disorder (GAD) — Duration ≥9 months, 5/6 associated symptoms, significant functional impairment",
    markingScheme: { communication: "Validated somatic symptoms before exploring psychological, used open questions, explored patient's explanatory model", safety: "Screened for depression and suicidal ideation", clinical: "Covered GAD criteria systematically, ruled out other anxiety disorders, assessed duration and severity" },
  },
];

/* ── Score a conversation against a station's key areas ── */
/* ── OSCE scoring ─────────────────────────────────────────────────────────────
   scoreConversation: fast keyword-based fallback (runs synchronously first)
   scoreConversationSemantic: AI semantic scoring (runs async, upgrades the result)
────────────────────────────────────────────────────────────────────────────── */

// Broad keyword map — intentionally generous to reduce false negatives in fallback
const OSCE_KEYWORD_MAP = {
  "hearing voices":                        ["voice", "hear", "sound", "auditory", "perception"],
  "risk assessment — self-harm":           ["self-harm", "harm", "suicid", "hurt", "die", "death", "end your life", "wishing you wouldn"],
  "duration and onset of symptoms":        ["how long", "when", "start", "began", "first", "weeks", "months", "ago"],
  "impact on functioning":                 ["work", "university", "job", "study", "daily", "function", "life", "relationships", "social", "affect"],
  "insight":                               ["think", "unwell", "something wrong", "help", "awareness", "understand", "illness"],
  "drug and alcohol history":              ["drug", "alcohol", "drink", "substance", "cannabis", "smoke", "use"],
  "family psychiatric history":            ["family", "relative", "parent", "sibling", "mother", "father", "brother", "sister"],
  "directly asking about anhedonia":       ["enjoy", "pleasure", "interest", "used to like", "hobbies", "fun", "motivated", "anhedonia"],
  "explicit safety assessment":            ["suicid", "self-harm", "harm yourself", "thoughts of death", "want to die", "end your life", "hurt yourself"],
  "biological symptoms — sleep and appetite": ["sleep", "appetite", "eating", "weight", "energy", "tired", "fatigue", "exhausted"],
  "duration of symptoms":                  ["how long", "when", "months", "weeks", "began", "started", "ago"],
  "past episodes of elevated mood":        ["elevated", "high", "manic", "bipolar", "previous", "before", "energy", "amazing", "incredible"],
  "sleep — decreased need without fatigue":["sleep", "hours", "rest", "tired", "fatigue", "awake"],
  "grandiosity":                           ["special", "better", "abilities", "powers", "genius", "business", "million", "important", "famous"],
  "risk — financial, sexual, or physical harm": ["money", "spend", "financial", "sexual", "risky", "dangerous", "impulsive", "harm"],
  "insight — does patient recognise they are unwell": ["think", "unwell", "wrong", "help", "treatment", "hospital", "ill"],
  "substance use":                         ["alcohol", "drug", "drink", "cannabis", "cocaine", "smoking", "use", "substances"],
  "directly asking about intrusive thoughts": ["intrusive", "unwanted", "thoughts", "control", "bother", "disturbing", "can't stop thinking"],
  "ego-dystonic nature":                   ["values", "character", "want", "resist", "stop", "sense", "wrong", "out of character"],
  "time spent on rituals per day":         ["how long", "how many", "hours", "times", "per day", "frequency", "often"],
  "mood — secondary depression":           ["low", "depressed", "down", "sad", "hopeless", "enjoy", "pleasure", "feel"],
  "nature and content of worries":         ["worry", "concern", "anxious", "about", "specific", "main", "type"],
  "difficulty controlling worry":          ["control", "stop", "turn off", "switch off", "can't", "hard", "difficult"],
  "duration — longer than 6 months":       ["how long", "months", "started", "when", "ago"],
  "at least 3 associated somatic symptoms":["restless", "tired", "fatigue", "concentrate", "tense", "irritable", "muscle", "sleep", "edge"],
  "rule out panic attacks":                ["panic", "sudden", "heart", "palpitation", "phobia", "fear", "specific"],
  "screen for depression":                 ["low mood", "depressed", "enjoy", "pleasure", "hopeless", "sad", "down"],
  "past history or family history":        ["before", "family", "relative", "history", "previous", "ever had"],
  "safety assessment":                     ["suicid", "self-harm", "hurt", "harm", "safe", "thoughts of death"],
};

function scoreConversation(messages, station) {
  const studentLines = messages
    .filter(m => m.role === "user")
    .map(m => m.content)
    .join(" ")
    .toLowerCase();
  const fullTranscript = messages.map(m => m.content).join(" ").toLowerCase();

  const penalties = station.missedQuestionPenalties;
  let covered = 0;
  let total = penalties.reduce((s, p) => s + p.weight, 0);
  let results = penalties.map(p => {
    const key = p.question.toLowerCase();
    // Look for matching keywords in both student lines and full transcript
    const kwList = OSCE_KEYWORD_MAP[key] || [key.split(" ")[0], key.split(" ").slice(-1)[0]];
    // Check student questions primarily, fall back to full transcript
    const foundInStudent = kwList.some(kw => studentLines.includes(kw));
    const foundInFull    = kwList.some(kw => fullTranscript.includes(kw));
    const found = foundInStudent || foundInFull;
    if (found) covered += p.weight;
    return { ...p, covered: found };
  });
  return { results, score: Math.round((covered / total) * 100), covered, total };
}

// Async semantic scorer — upgrades keyword results using AI intent matching
async function scoreConversationSemantic(messages, station, session) {
  const transcript = messages
    .map(m => `${m.role === "user" ? "STUDENT" : "PATIENT"}: ${m.content}`)
    .join("\n");
  try {
    const result = await askAI(
      "osce_score",
      [{ role: "user", content: "Evaluate this transcript." }],
      {
        stationTitle:  station.title,
        diagnosis:     station.diagnosis,
        checklist:     station.missedQuestionPenalties,
        transcript,
      },
      session
    );
    // Parse the boolean array
    const arr = safeParseJSON(result.text);
    if (!Array.isArray(arr) || arr.length !== station.missedQuestionPenalties.length) return null;

    const penalties = station.missedQuestionPenalties;
    let covered = 0;
    let total = penalties.reduce((s, p) => s + p.weight, 0);
    const results = penalties.map((p, i) => {
      const found = !!arr[i];
      if (found) covered += p.weight;
      return { ...p, covered: found };
    });
    return { results, score: Math.round((covered / total) * 100), covered, total, semantic: true };
  } catch {
    return null; // fall back to keyword scoring
  }
}

function OSCESimulator({ progress, setProgress, user }) {
  const [view, setView]           = useState("list");   // list | briefing | active | feedback
  const [station, setStation]     = useState(null);
  const [messages, setMessages]   = useState([]);
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [timer, setTimer]         = useState(480);
  const [running, setRunning]     = useState(false);
  const [feedback, setFeedback]   = useState(null);
  const [fbLoading, setFbLoading] = useState(false);
  const [filterCat, setFilterCat]   = useState("All");
  const [remaining, setRemaining]   = useState(null); // daily limit remaining
  const [limitError, setLimitError] = useState("");
  const [listening, setListening]   = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const recognitionRef = useRef(null);
  const chatRef  = useRef(null);
  const timerRef = useRef(null);
  const inputRef = useRef(null);

  // ── Voice input ─────────────────────────────────────────────
  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceSupported(false); return; }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onstart  = () => setListening(true);
    rec.onend    = () => setListening(false);
    rec.onerror  = () => setListening(false);
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput(prev => (prev ? prev + " " + transcript : transcript));
      setTimeout(() => inputRef.current?.focus(), 50);
    };
    recognitionRef.current = rec;
    rec.start();
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  // Stop recognition if view changes away from active
  useEffect(() => {
    if (view !== "active") stopVoice();
  }, [view]); // eslint-disable-line

  useEffect(() => {
    if (running) {
      timerRef.current = setInterval(() => setTimer(t => {
        if (t <= 1) { clearInterval(timerRef.current); setRunning(false); return 0; }
        return t - 1;
      }), 1000);
    } else clearInterval(timerRef.current);
    return () => clearInterval(timerRef.current);
  }, [running]);

  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [messages]);

  const mins = String(Math.floor(timer / 60)).padStart(2, "0");
  const secs = String(timer % 60).padStart(2, "0");
  const timerPct = station ? (timer / (station.duration * 60)) * 100 : 100;
  const timerColor = timer < 60 ? "#DC2626" : timer < 120 ? AMBER : TEAL;

  function selectStation(s) { setStation(s); setView("briefing"); }

  async function startStation() {
    if (!user) { setLimitError("Please log in to use AI features."); return; }
    setLimitError("");
    const { data: { session } } = await supabase.auth.getSession();

    // Check station-completion limit BEFORE starting (not per-message)
    try {
      const limitRes = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}` },
        body: JSON.stringify({ feature: "osce_completed_station", checkOnly: true, messages: [], meta: {} }),
      });
      const limitData = await limitRes.json();
      if (limitRes.status === 429) {
        setLimitError(limitData.error || "You have reached today's OSCE station limit. Please try again tomorrow.");
        return;
      }
      if (limitData.remaining !== undefined) setRemaining(limitData.remaining);
    } catch { /* allow start if limit check fails */ }

    setView("active"); setTimer(station.duration * 60); setRunning(true);
    setLoading(true);

    // Opening patient message — NOT counted against station limit
    try {
      const result = await askAI(
        "osce_msg",
        [{ role: "user", content: "Hello, I'm the medical student here to have a chat with you today. Is that okay?" }],
        { patientName: station.patientName, patientAge: station.patientAge, stationTitle: station.title, diagnosis: station.diagnosis, persona: station.patientPersona },
        session
      );
      setMessages([{ role: "assistant", content: result.text, ts: Date.now() }]);
    } catch (err) {
      setMessages([{ role: "assistant", content: "Hello, I understand you're here to have a chat — please, go ahead.", ts: Date.now() }]);
    }
    setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 100);
    if (!progress.osce.completed.includes(station.id)) {
      setProgress(p => ({ ...p, osce: { completed: [...p.osce.completed, station.id] } }));
    }
  }

  async function sendMsg() {
    if (!input.trim() || loading) return;
    if (!user) { setLimitError("Please log in to use AI features."); return; }
    const msg = input.trim(); setInput("");
    const newM = [...messages, { role: "user", content: msg, ts: Date.now() }];
    setMessages(newM); setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    try {
      // osce_msg = unlimited patient messages within an active station
      const result = await askAI(
        "osce_msg",
        newM.map(m => ({ role: m.role, content: m.content })),
        { patientName: station.patientName, stationTitle: station.title, diagnosis: station.diagnosis, persona: station.patientPersona },
        session
      );
      setMessages([...newM, { role: "assistant", content: result.text, ts: Date.now() }]);
    } catch (err) {
      setMessages([...newM, { role: "assistant", content: "⚠️ " + err.message, ts: Date.now() }]);
    }
    setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function endAndGetFeedback() {
    setRunning(false); setView("feedback"); setFbLoading(true);
    const transcript = messages.map(m => `${m.role === "user" ? "STUDENT" : "PATIENT"}: ${m.content}`).join("\n");

    // Run keyword scoring immediately (fast, synchronous fallback)
    const keywordScoring = scoreConversation(messages, station);
    // Show keyword results right away while semantic scoring runs
    setFeedback(prev => ({ ...(prev || {}), scoring: keywordScoring, scoringPending: true }));

    const { data: { session } } = await supabase.auth.getSession();

    // Run examiner feedback and semantic checklist scoring in parallel
    const feedbackPrompt = `You are a senior psychiatry OSCE examiner assessing a medical student's performance.

STATION: "${station.title}" — ${station.category}
DIAGNOSIS: ${station.diagnosis}
MARKING CRITERIA:
- Communication: ${station.markingScheme.communication}
- Safety: ${station.markingScheme.safety}
- Clinical: ${station.markingScheme.clinical}

TRANSCRIPT:
${transcript}

Provide structured JSON feedback ONLY (no markdown, no preamble):
{
  "communicationScore": <1-5>,
  "communicationFeedback": "<2-3 sentences on rapport, empathy, questioning style>",
  "safetyScore": <1-5>,
  "safetyFeedback": "<2-3 sentences on safety assessment quality>",
  "clinicalScore": <1-5>,
  "clinicalFeedback": "<2-3 sentences on clinical reasoning and symptom coverage>",
  "diagnosticReasoning": "<3-4 sentences: what diagnosis was suggested, what the student got right/wrong in their reasoning>",
  "missedAreas": ["<area 1>", "<area 2>", "<area 3>"],
  "strengths": ["<strength 1>", "<strength 2>"],
  "improvements": ["<improvement 1>", "<improvement 2>", "<improvement 3>"],
  "overallPass": <true/false>,
  "summaryComment": "<1-2 sentences overall impression>"
}`;
    try {
      // Run examiner AI feedback and semantic checklist scoring in parallel
      const [examinerResult, semanticScoring] = await Promise.all([
        // osce_completed_station is charged once per station completion (not per message)
        askAI(
          "osce_completed_station",
          [{ role: "user", content: feedbackPrompt }],
          { patientName: station.patientName, stationTitle: station.title, diagnosis: station.diagnosis, persona: "You are an OSCE examiner. Return ONLY valid JSON." },
          session
        ),
        // osce_score is free — no usage limit charge
        scoreConversationSemantic(messages, station, session),
      ]);

      if (examinerResult.remaining !== null) setRemaining(examinerResult.remaining);

      // Use semantic scoring if available, fall back to keyword scoring
      const finalScoring = semanticScoring ?? keywordScoring;
      const parsed = safeParseJSON(examinerResult.text);
      setFeedback(parsed
        ? { ...parsed, scoring: finalScoring, semanticScoring: !!semanticScoring }
        : { error: examinerResult.text, scoring: finalScoring });
    } catch (err) {
      if (err.code === "DAILY_LIMIT_REACHED") {
        setFeedback({ error: "You have reached today's OSCE station limit. Your consultation has been saved but AI feedback is unavailable until tomorrow.", scoring: keywordScoring });
      } else {
        setFeedback({ error: err.message, scoring: keywordScoring });
      }
    }
    setFbLoading(false);
  }

  function resetStation() { setView("list"); setStation(null); setMessages([]); setFeedback(null); setInput(""); setRunning(false); setLimitError(""); setRemaining(null); }

  const categories = ["All", ...new Set(OSCE_STATIONS.map(s => s.category))];
  const visibleStations = filterCat === "All" ? OSCE_STATIONS : OSCE_STATIONS.filter(s => s.category === filterCat);

  /* ── FEEDBACK VIEW ── */
  if (view === "feedback") {
    const ScoreCircle = ({ score, label, color }) => {
      const pct = (score / 5) * 100;
      const r = 26, circ = 2 * Math.PI * r;
      return (
        <div style={{ textAlign: "center", flex: 1, minWidth: 100 }}>
          <svg width={70} height={70} style={{ display: "block", margin: "0 auto 6px" }}>
            <circle cx={35} cy={35} r={r} fill="none" stroke="#EEF2F7" strokeWidth={6} />
            <circle cx={35} cy={35} r={r} fill="none" stroke={color} strokeWidth={6}
              strokeDasharray={`${(pct / 100) * circ} ${circ}`} strokeLinecap="round"
              transform="rotate(-90 35 35)" style={{ transition: "stroke-dasharray 1s ease" }} />
            <text x={35} y={40} textAnchor="middle" fontSize={18} fontWeight={700} fill={color}>{score}</text>
          </svg>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "#475569" }}>{label}</div>
        </div>
      );
    };

    return (
      <div className="fade-in">
        <div style={{ display: "flex", gap: 8, marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={resetStation} style={{ ...S.btn("outline"), fontSize: 13 }}>← All Stations</button>
          <button onClick={() => { setView("active"); setMessages([]); setFeedback(null); startStation(); }} style={{ ...S.btn("ghost"), fontSize: 13 }}>🔄 Retry Station</button>
        </div>

        {/* Header */}
        <div style={{ ...S.card, borderTop: `4px solid ${station.categoryColor}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
            <div>
              <span style={{ ...S.badge(), background: `${station.categoryColor}18`, color: station.categoryColor }}>{station.category}</span>
              <span style={S.badge()}>{station.difficulty}</span>
            </div>
            {feedback && !feedback.error && (
              <span style={{ fontWeight: 700, fontSize: 14, color: feedback.overallPass ? TEAL : "#DC2626", background: feedback.overallPass ? TEAL_LIGHT : "#FEF2F2", borderRadius: 20, padding: "4px 14px" }}>
                {feedback.overallPass ? "✓ PASS" : "✗ NEEDS IMPROVEMENT"}
              </span>
            )}
          </div>
          <h2 style={{ ...S.sectionTitle, color: station.categoryColor, fontSize: 18, marginBottom: 4 }}>{station.title} — Feedback</h2>
          <div style={{ fontSize: 13, color: "#64748b" }}>Diagnosis: <strong style={{ color: "#1e293b" }}>{station.diagnosis}</strong></div>
        </div>

        {fbLoading && (
          <div style={{ ...S.card, textAlign: "center", padding: "2.5rem" }}>
            <div className="pulse" style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
            <div style={{ fontWeight: 600, color: "#475569" }}>Examiner is reviewing your consultation…</div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>Analysing communication, safety assessment, and clinical reasoning</div>
          </div>
        )}

        {feedback && !feedback.error && (
          <>
            {/* Score circles */}
            <div style={{ ...S.card }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Domain Scores (out of 5)</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "space-around", flexWrap: "wrap", marginBottom: 16 }}>
                <ScoreCircle score={feedback.communicationScore} label="Communication" color={ACCENT} />
                <ScoreCircle score={feedback.safetyScore}        label="Safety"         color="#DC2626" />
                <ScoreCircle score={feedback.clinicalScore}      label="Clinical"       color={TEAL} />
              </div>
              {feedback.summaryComment && (
                <div style={{ fontSize: 14, color: "#334155", background: "#F8FAFC", borderRadius: 9, padding: "10px 14px", lineHeight: 1.7, borderLeft: `4px solid ${ACCENT}` }}>
                  💬 {feedback.summaryComment}
                </div>
              )}
            </div>

            {/* Checklist coverage */}
            <div style={S.card}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                Checklist Coverage — {feedback.scoring.score}%
                {feedback.semanticScoring && (
                  <span style={{ marginLeft:8, fontSize:10, fontWeight:700, background:"#EDE9FE", color:"#5B21B6", borderRadius:99, padding:"2px 8px", letterSpacing:.3 }}>
                    ✦ AI-scored
                  </span>
                )}
              </div>
              <ProgressBar value={feedback.scoring.score} max={100} color={feedback.scoring.score >= 70 ? TEAL : feedback.scoring.score >= 50 ? AMBER : "#DC2626"} height={10} />
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 7 }}>
                {feedback.scoring.results.map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                    <span style={{ width: 20, height: 20, borderRadius: "50%", background: r.covered ? TEAL_LIGHT : "#FEF2F2", color: r.covered ? TEAL : "#DC2626", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                      {r.covered ? "✓" : "✗"}
                    </span>
                    <span style={{ color: r.covered ? "#334155" : "#94a3b8", flex: 1 }}>{r.question}</span>
                    <span style={{ fontSize: 11, color: "#94a3b8", background: "#F1F5F9", borderRadius: 20, padding: "2px 8px" }}>{r.weight}pt</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Detailed feedback */}
            {[
              { label: "🗣️ Communication", text: feedback.communicationFeedback, color: ACCENT },
              { label: "🛡️ Safety Assessment", text: feedback.safetyFeedback, color: "#DC2626" },
              { label: "🔬 Clinical Reasoning", text: feedback.clinicalFeedback, color: TEAL },
              { label: "🧩 Diagnostic Reasoning", text: feedback.diagnosticReasoning, color: PURPLE },
            ].map((item, i) => (
              <div key={i} style={{ ...S.card, borderLeft: `4px solid ${item.color}` }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: item.color, marginBottom: 6 }}>{item.label}</div>
                <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.75 }}>{item.text}</div>
              </div>
            ))}

            {/* Strengths */}
            {feedback.strengths?.length > 0 && (
              <div style={{ ...S.card, background: "#F0FDF4", border: "1px solid #86EFAC" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: TEAL, marginBottom: 8 }}>✅ Strengths</div>
                {feedback.strengths.map((s, i) => <div key={i} style={{ fontSize: 13, color: "#166534", marginBottom: 5 }}>• {s}</div>)}
              </div>
            )}

            {/* Missed areas */}
            {feedback.missedAreas?.length > 0 && (
              <div style={{ ...S.card, background: "#FEF2F2", border: "1px solid #FCA5A5" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#DC2626", marginBottom: 8 }}>❌ Missed Areas</div>
                {feedback.missedAreas.map((a, i) => <div key={i} style={{ fontSize: 13, color: "#991B1B", marginBottom: 5 }}>• {a}</div>)}
              </div>
            )}

            {/* Improvements */}
            {feedback.improvements?.length > 0 && (
              <div style={{ ...S.card, background: "#FFFBEB", border: "1px solid #FDE68A" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: AMBER, marginBottom: 8 }}>💡 Suggested Improvements</div>
                {feedback.improvements.map((imp, i) => (
                  <div key={i} style={{ fontSize: 13, color: "#92400E", marginBottom: 6, paddingLeft: 10, borderLeft: `3px solid ${AMBER}` }}>{i + 1}. {imp}</div>
                ))}
              </div>
            )}
          </>
        )}

        {feedback?.error && (
          <div style={{ ...S.card, background: "#FEF2F2" }}>
            <div style={{ fontWeight: 700, color: "#DC2626", marginBottom: 6 }}>Feedback parsing error</div>
            <div style={{ fontSize: 13, color: "#334155", whiteSpace: "pre-wrap" }}>{feedback.error}</div>
          </div>
        )}
      </div>
    );
  }

  /* ── ACTIVE SESSION VIEW ── */
  if (view === "active") {
    return (
      <div className="fade-in" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 160px)", minHeight: 500 }}>
        {/* Station header bar */}
        <div style={{ ...S.card, padding: "12px 16px", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ ...S.badge(), background: `${station.categoryColor}18`, color: station.categoryColor }}>{station.category}</span>
              <span style={{ fontWeight: 700, fontSize: 14, color: "#1e293b" }}>{station.title}</span>
            </div>
          </div>
          {/* Timer */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 120 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Time</span>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: timerColor }}>{mins}:{secs}</span>
              </div>
              <div style={{ background: "#EEF2F7", borderRadius: 99, height: 6, overflow: "hidden" }}>
                <div style={{ width: `${timerPct}%`, background: timerColor, height: "100%", borderRadius: 99, transition: "width 1s linear, background .5s" }} />
              </div>
            </div>
            <button onClick={endAndGetFeedback} style={{ ...S.btn("danger"), fontSize: 12, padding: "7px 14px" }}>
              End & Get Feedback
            </button>
          </div>
        </div>

        {/* Patient info strip */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: "#F8FAFC", borderRadius: 9, marginBottom: "0.75rem", border: "1px solid #EEF2F7", fontSize: 13 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: `${station.categoryColor}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🧑</div>
          <div>
            <div style={{ fontWeight: 600, color: "#1e293b", fontSize: 13 }}>{station.patientName} · {station.patientAge}</div>
            <div style={{ color: "#64748b", fontSize: 12 }}>{station.presenting}</div>
          </div>
        </div>

        {/* Chat window */}
        <div ref={chatRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, padding: "0 2px", marginBottom: "0.75rem", minHeight: 200 }}>
          {messages.length === 0 && !loading && (
            <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 13, marginTop: 40 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🎭</div>
              Starting consultation…
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
              {m.role === "assistant" && (
                <span style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2, marginLeft: 4 }}>👤 {station.patientName}</span>
              )}
              <div style={S.bubble(m.role)}>{m.content}</div>
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
              <span style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2, marginLeft: 4 }}>👤 {station.patientName}</span>
              <div style={{ ...S.bubble("assistant"), display: "flex", gap: 4, alignItems: "center" }}>
                {[0,1,2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#94a3b8", animation: `pulse 1.2s ${i * 0.2}s infinite` }} />)}
              </div>
            </div>
          )}
        </div>

        {/* Input bar */}
        <div style={{ paddingTop: 8, borderTop: "1px solid #EEF2F7" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Mic button */}
            <button
              onClick={listening ? stopVoice : startVoice}
              disabled={loading}
              title={listening ? "Stop listening" : "Start voice input"}
              style={{
                width: 42, height: 42, borderRadius: "50%", flexShrink: 0, border: "none",
                cursor: loading ? "not-allowed" : "pointer",
                background: listening ? "#FEE2E2" : "#EFF6FF",
                color:      listening ? "#DC2626"  : "#1E5FAD",
                fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: listening ? "0 0 0 3px rgba(220,38,38,.25)" : "none",
                transition: "all .2s",
              }}>
              {listening ? "⏹" : "🎙️"}
            </button>

            {/* Text input */}
            <input
              ref={inputRef}
              style={{ ...S.input, flex: 1, borderRadius: 99 }}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMsg()}
              placeholder={listening ? "Listening…" : `Ask ${station.patientName} a question…`}
              disabled={listening}
            />

            {/* Send button */}
            <button
              style={{ ...S.btn(), borderRadius: 99, padding: "9px 20px", flexShrink: 0 }}
              onClick={sendMsg}
              disabled={loading || !input.trim()}>
              Send
            </button>
          </div>

          {/* Status / privacy note */}
          {listening && (
            <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#DC2626" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#DC2626", display: "inline-block", animation: "pulse 1s infinite" }} />
              Listening… speak your question, then click Stop.
            </div>
          )}
          {!listening && !voiceSupported && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#94a3b8" }}>
              ⚠️ Voice input is not supported on this browser. Please type your question.
            </div>
          )}
          {!listening && voiceSupported && (
            <div style={{ marginTop: 5, fontSize: 11, color: "#94a3b8" }}>
              🎙️ Audio is transcribed locally by your browser. Do not share real patient information.
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── BRIEFING VIEW ── */
  if (view === "briefing") {
    return (
      <div className="fade-in">
        <button onClick={() => setView("list")} style={{ ...S.btn("outline"), marginBottom: "1rem", fontSize: 13 }}>← All Stations</button>
        <div style={{ ...S.card, borderTop: `4px solid ${station.categoryColor}` }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={{ ...S.badge(), background: `${station.categoryColor}18`, color: station.categoryColor }}>{station.category}</span>
            <span style={S.badge()}>{station.difficulty}</span>
            <span style={{ ...S.badge("amber") }}>⏱ {station.duration} minutes</span>
          </div>
          <h2 style={{ ...S.sectionTitle, color: station.categoryColor, marginBottom: 4 }}>{station.title}</h2>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: "1rem" }}>
            <strong>Setting:</strong> {station.setting} · <strong>Patient:</strong> {station.patientName}, {station.patientAge}
          </div>

          {/* Candidate instructions */}
          <div style={{ background: ACCENT_LIGHT, borderRadius: 10, padding: "1rem 1.125rem", marginBottom: "1rem", borderLeft: `4px solid ${ACCENT}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: ACCENT_DARK, marginBottom: 6, textTransform: "uppercase", letterSpacing: .5 }}>📋 Candidate Instructions</div>
            <div style={{ fontSize: 14, color: "#1e293b", lineHeight: 1.75 }}>{station.briefing}</div>
          </div>

          {/* Presenting complaint */}
          <div style={{ background: "#F8FAFC", borderRadius: 9, padding: "10px 14px", marginBottom: "1rem", border: "1px solid #E8EEF4", fontSize: 13 }}>
            <strong style={{ color: "#475569" }}>Presenting complaint:</strong> <span style={{ color: "#64748b" }}>{station.presenting}</span>
          </div>

          {/* Key areas */}
          <div style={{ marginBottom: "1.25rem" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Key Areas to Explore</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px,1fr))", gap: 6 }}>
              {station.keyAreas.map((area, i) => (
                <div key={i} style={{ fontSize: 12.5, color: "#334155", background: "#F8FAFC", borderRadius: 7, padding: "6px 10px", border: "1px solid #EEF2F7" }}>
                  <span style={{ color: station.categoryColor, fontWeight: 700, marginRight: 4 }}>{i + 1}.</span>{area}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => setView("list")} style={{ ...S.btn("outline") }}>Cancel</button>
            <button onClick={startStation} style={{ ...S.btn(), background: station.categoryColor, padding: "10px 28px", fontSize: 15 }}>
              ▶ Start Consultation
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── STATION LIST VIEW ── */
  return (
    <div className="fade-in">
      <h2 style={S.sectionTitle}>🎭 OSCE Simulator</h2>
      <p style={S.sectionSub}>AI-powered psychiatric patient simulations with real-time feedback. Practice 8-minute OSCE consultations.</p>
      {/* ── AI Usage Banner ── */}
      {limitError && (
        <div style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:9, padding:"10px 14px", marginBottom:"1rem", fontSize:13, color:"#DC2626", display:"flex", alignItems:"flex-start", gap:8 }}>
          <span style={{ flexShrink:0 }}>⚠️</span>
          <span>{limitError}</span>
        </div>
      )}
      {remaining !== null && remaining >= 0 && (
        <div style={{ background:"#F0F9FF", border:"1px solid #BAE6FD", borderRadius:9, padding:"8px 14px", marginBottom:"1rem", fontSize:12.5, color:"#0369A1", display:"flex", alignItems:"center", gap:8 }}>
          <span>💡</span>
          <span>{remaining} OSCE station{remaining !== 1 ? "s" : ""} remaining today (resets at midnight UTC) · Unlimited messages per station</span>
        </div>
      )}

      {/* How it works */}
      <div style={{ ...S.card, background: `linear-gradient(135deg, ${ACCENT_DARK}, #1E5FAD)`, color: "#fff", marginBottom: "1.25rem" }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, opacity: .75, textTransform: "uppercase", letterSpacing: .5 }}>How it works</div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          {[
            { icon: "📋", step: "1. Read briefing", desc: "Get the clinical scenario and instructions" },
            { icon: "🎭", step: "2. Consult patient", desc: "The AI plays a realistic psychiatric patient" },
            { icon: "⏱️", step: "3. 8 minutes", desc: "Timed just like a real OSCE station" },
            { icon: "📊", step: "4. Instant feedback", desc: "Scores, checklist, and improvement tips" },
          ].map((s, i) => (
            <div key={i} style={{ flex: 1, minWidth: 130, background: "rgba(255,255,255,.1)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 12 }}>{s.step}</div>
              <div style={{ fontSize: 11, opacity: .75 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Category filter */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "1.25rem" }}>
        {categories.map(cat => {
          const catStation = OSCE_STATIONS.find(s => s.category === cat);
          const color = catStation ? catStation.categoryColor : ACCENT;
          const active = filterCat === cat;
          return (
            <button key={cat} onClick={() => setFilterCat(cat)}
              style={{ border: `1.5px solid ${active ? color : "#E8EEF4"}`, background: active ? `${color}18` : "#fff", color: active ? color : "#64748b", borderRadius: 99, padding: "5px 14px", cursor: "pointer", fontSize: 12.5, fontWeight: active ? 700 : 400, fontFamily: "inherit", transition: "all .15s" }}>
              {cat}
            </button>
          );
        })}
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <div style={{ background: "#fff", border: "1px solid #E8EEF4", borderRadius: 12, padding: ".875rem 1.125rem", flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: TEAL }}>{progress.osce.completed.length}</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Stations completed</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #E8EEF4", borderRadius: 12, padding: ".875rem 1.125rem", flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: ACCENT }}>{OSCE_STATIONS.length - progress.osce.completed.length}</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Stations remaining</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #E8EEF4", borderRadius: 12, padding: ".875rem 1.125rem", flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: AMBER }}>{OSCE_STATIONS.length}</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Total stations</div>
        </div>
      </div>

      {/* Station cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
        {visibleStations.map(s => {
          const done = progress.osce.completed.includes(s.id);
          return (
            <div key={s.id} className="ch" style={{ ...S.card, cursor: "pointer", borderLeft: `5px solid ${s.categoryColor}`, padding: "1.125rem 1.25rem" }} onClick={() => selectStation(s)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{ ...S.badge(), background: `${s.categoryColor}18`, color: s.categoryColor }}>{s.category}</span>
                    <span style={S.badge()}>{s.difficulty}</span>
                    <span style={{ ...S.badge("amber") }}>⏱ {s.duration} min</span>
                    {done && <span style={{ ...S.badge("teal") }}>✓ Completed</span>}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b", marginBottom: 4 }}>{s.title}</div>
                  <div style={{ fontSize: 13, color: "#64748b", marginBottom: 8, lineHeight: 1.55 }}>
                    <strong style={{ color: "#475569" }}>{s.patientName}</strong> · {s.patientAge} · {s.setting}
                  </div>
                  <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>{s.presenting}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
                  <button style={{ ...S.btn(), background: s.categoryColor, padding: "8px 18px", fontSize: 13 }} onClick={e => { e.stopPropagation(); selectStation(s); }}>
                    {done ? "Retry →" : "Start →"}
                  </button>
                </div>
              </div>
              {/* Key areas preview */}
              <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {s.keyAreas.slice(0, 4).map((area, i) => (
                  <span key={i} style={{ fontSize: 11, background: "#F1F5F9", color: "#64748b", borderRadius: 6, padding: "3px 8px" }}>{area}</span>
                ))}
                {s.keyAreas.length > 4 && <span style={{ fontSize: 11, color: "#94a3b8" }}>+{s.keyAreas.length - 4} more</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   MSE TRAINER — FULL REBUILD
══════════════════════════════════════════ */

const MSE_FIELDS = [
  {
    key: "appearance",
    label: "Appearance",
    icon: "👁️",
    color: "#7C3AED",
    description: "Physical presentation: grooming, dress, hygiene, age-appropriateness, distinguishing features",
    prompts: ["Well-groomed / dishevelled / unkempt", "Appropriately / inappropriately dressed", "Appears stated age / older / younger", "Nutritional status", "Notable features (e.g. lanugo, scars, jaundice)"],
    redFlags: ["Severely unkempt → self-neglect, psychosis", "Bizarrely dressed → mania, psychosis", "Visible self-harm marks → risk", "Cachexia → eating disorder"],
    commonPhrases: ["Well-groomed and casually dressed, appearing stated age", "Dishevelled with poor hygiene and unkempt clothing", "Neatly dressed but appears older than stated age", "Multiple self-harm scars noted on bilateral forearms"],
  },
  {
    key: "behavior",
    label: "Behaviour & Psychomotor",
    icon: "🚶",
    color: "#0891B2",
    description: "Psychomotor activity, eye contact, rapport, cooperation, abnormal movements",
    prompts: ["Eye contact: good / poor / intense / avoidant", "Psychomotor: agitated / retarded / normal", "Cooperation: cooperative / guarded / hostile", "Abnormal movements: tremor, akathisia, stereotypies", "Rapport: easily established / difficult"],
    redFlags: ["Psychomotor retardation → severe depression, catatonia", "Marked agitation → mania, anxiety, akathisia", "Guarded / suspicious → psychosis, paranoia", "Catatonia (waxy flexibility, posturing)"],
    commonPhrases: ["Cooperative and engaged, good eye contact throughout", "Psychomotor retardation noted; slow to initiate responses", "Visibly agitated, unable to remain seated, poor eye contact", "Guarded and suspicious, scanning environment repeatedly"],
  },
  {
    key: "speech",
    label: "Speech",
    icon: "🗣️",
    color: "#059669",
    description: "Rate, rhythm, volume, tone, quantity, spontaneity, fluency",
    prompts: ["Rate: normal / pressured / slow / halting", "Volume: normal / loud / whispered", "Quantity: normal / reduced / excessive", "Spontaneity: spontaneous / only in response", "Fluency: fluent / dysarthric / stuttering"],
    redFlags: ["Pressured speech → mania", "Poverty of speech → depression, negative symptoms schizophrenia", "Thought blocking → schizophrenia", "Dysarthria → organic, intoxication"],
    commonPhrases: ["Normal rate, rhythm and volume; spontaneous and fluent", "Pressured speech, rapid, difficult to interrupt", "Reduced volume and rate; long latency before responding", "Monotonous tone with limited prosody and reduced spontaneity"],
  },
  {
    key: "mood",
    label: "Mood (Subjective)",
    icon: "💬",
    color: "#1E5FAD",
    description: "Patient's own description of their emotional state — use direct quotes",
    prompts: ["Always use direct quote: 'How would you describe your mood?'", "Euthymic / depressed / elevated / anxious / irritable / empty", "Labile vs. stable", "Duration and fluctuation pattern"],
    redFlags: ["'Empty' or 'numb' → dissociation, severe depression, BPD", "'Amazing / fantastic' → mania (incongruent)", "'Terrified' with no context → psychosis, trauma"],
    commonPhrases: ["Euthymic: \"I'm feeling okay, not great but not bad\"", "Depressed: \"I feel completely empty and hopeless\"", "Elevated: \"I feel absolutely incredible, the best I've ever felt\"", "Anxious: \"I'm constantly worried, I just can't relax\""],
  },
  {
    key: "affect",
    label: "Affect (Objective)",
    icon: "😶",
    color: "#9D174D",
    description: "Clinician's observation of emotional expression — range, reactivity, congruence with mood",
    prompts: ["Range: full / restricted / blunted / flat", "Reactivity: reactive / non-reactive", "Congruence: congruent / incongruent with mood", "Quality: labile / stable / dysphoric / euphoric / irritable"],
    redFlags: ["Flat affect → schizophrenia (negative symptom)", "Blunted affect → depression, medication side effect", "Incongruent affect (laughing about sad content) → psychosis", "Labile affect → mania, BPD, organic"],
    commonPhrases: ["Full range, reactive affect, congruent with reported mood", "Blunted affect with reduced facial expressivity", "Flat affect; no observable emotional response", "Labile affect with rapid shifts between tearfulness and laughter"],
  },
  {
    key: "thought_process",
    label: "Thought Process (Form)",
    icon: "🔄",
    color: "#B45309",
    description: "How thoughts are organised and connected — logical flow, associations, coherence",
    prompts: ["Goal-directed / logical / coherent", "Circumstantial (returns to goal after detour)", "Tangential (never returns to goal)", "Flight of ideas (rapid, connected leaps)", "Loose associations / thought disorder", "Thought blocking (sudden cessation)"],
    redFlags: ["Loose associations → schizophrenia", "Flight of ideas → mania", "Thought blocking → schizophrenia", "Perseveration → OCD, organic, autism"],
    commonPhrases: ["Goal-directed and coherent thought process", "Circumstantial thinking with eventual return to the topic", "Tangential thought process, unable to maintain topic", "Flight of ideas with rapid, pressure-driven thought connections"],
  },
  {
    key: "thought_content",
    label: "Thought Content",
    icon: "💭",
    color: "#5B21B6",
    description: "What the patient is thinking about — delusions, obsessions, phobias, suicidal ideation",
    prompts: ["Delusions: persecutory / grandiose / referential / somatic / nihilistic", "Obsessions / intrusive thoughts", "Suicidal ideation: passive / active / plan / intent / means", "Homicidal ideation", "Phobias, magical thinking, overvalued ideas"],
    redFlags: ["Active suicidal ideation with plan → emergency assessment", "Command hallucinations → high-risk", "Delusions of control or passivity → schizophrenia", "Nihilistic delusions → psychotic depression (Cotard's)"],
    commonPhrases: ["No delusions, obsessions, or suicidal ideation elicited", "Persecutory delusion that neighbours are monitoring him via CCTV", "Passive suicidal ideation without plan or intent", "Obsessional thoughts about contamination, ego-dystonic in nature"],
  },
  {
    key: "perception",
    label: "Perception",
    icon: "👂",
    color: "#0F6E56",
    description: "Hallucinations, illusions, depersonalisation, derealisation — modality and context",
    prompts: ["Auditory hallucinations: type (voices / sounds), person (1st/2nd/3rd), command?", "Visual hallucinations", "Tactile / olfactory / gustatory hallucinations", "Illusions (misperceptions of real stimuli)", "Depersonalisation / derealisation"],
    redFlags: ["Command auditory hallucinations → high risk", "3rd-person running commentary → first-rank symptom (schizophrenia)", "Visual > auditory hallucinations → organic / substance / DLB", "Tactile hallucinations → cocaine, alcohol withdrawal"],
    commonPhrases: ["No hallucinations or illusions reported", "Third-person auditory hallucinations; two voices discussing his actions", "Second-person command hallucinations instructing self-harm", "Visual hallucinations of small insects; denies auditory hallucinations"],
  },
  {
    key: "cognition",
    label: "Cognition",
    icon: "🧩",
    color: "#163F73",
    description: "Orientation, attention, memory, concentration — bedside tests and screening scores",
    prompts: ["Orientation: time / place / person", "Attention: WORLD backwards, serial 7s, digit span", "Short-term memory: 3-word recall at 5 minutes", "Long-term memory: recent events, remote recall", "MMSE / MoCA score if administered"],
    redFlags: ["Disorientation to time/place → delirium, dementia", "Impaired 3-word recall → dementia, depression", "Poor serial 7s → depression, dementia, low IQ", "Fluctuating cognition → delirium, DLB"],
    commonPhrases: ["Oriented to time, place and person", "Alert and oriented x3; MMSE 28/30 (loses 2 points on recall)", "Disoriented to time and place; 3-word recall 0/3 at 5 minutes", "Attention impaired; unable to perform serial 7s beyond 93"],
  },
  {
    key: "insight",
    label: "Insight",
    icon: "🔍",
    color: "#DC2626",
    description: "Awareness of illness, attribution of symptoms, and attitude to treatment",
    prompts: ["Absent / partial / full insight", "Recognises they are unwell?", "Attributes symptoms to psychiatric illness?", "Willing to accept treatment?", "Understanding of need for medications?"],
    redFlags: ["Absent insight → psychosis, mania, anosognosia", "Insight may be present but delusional system is fixed", "Insight ≠ compliance (patient may understand but refuse treatment)"],
    commonPhrases: ["Full insight: recognises illness, accepts diagnosis and treatment", "Partial insight: acknowledges distress but attributes to external factors", "Absent insight: denies any illness, refuses treatment", "Intellectual insight without emotional insight"],
  },
  {
    key: "judgment",
    label: "Judgment",
    icon: "⚖️",
    color: "#92400E",
    description: "Ability to make sound decisions, weigh consequences, and act appropriately",
    prompts: ["Intact / impaired / severely impaired", "Based on behaviour: financial, social, safety decisions", "Abstract reasoning if tested", "Capacity to make treatment decisions?", "Evidence of poor judgment: risky behaviours, impulsive acts"],
    redFlags: ["Impaired judgment → mania (spending, risky sex), psychosis, intoxication", "Poor impulse control → ADHD, BPD, IED, mania", "Capacity assessment may be needed if judgment severely impaired"],
    commonPhrases: ["Judgment intact; able to make sound decisions", "Judgment impaired, evidenced by significant financial risk-taking during manic episode", "Severely impaired judgment with inability to anticipate consequences of actions", "Judgment intact for routine decisions; impaired in context of delusional beliefs"],
  },
];

/* ── SAMPLE COMPLETED MSEs ── */
const SAMPLE_MSES = [
  {
    id: 1,
    title: "Acute Manic Episode",
    diagnosis: "Bipolar I Disorder — Current Manic Episode",
    category: "Bipolar",
    color: "#D97706",
    difficulty: "Intermediate",
    clinicalContext: "28-year-old male brought to ED by partner. Not slept in 3 days. Spending thousands online. Speaking rapidly.",
    mse: {
      appearance: "Flamboyantly dressed in mismatched, brightly coloured clothing inappropriate for the season. Appears stated age. Well-nourished. Wearing multiple rings and sunglasses indoors.",
      behavior: "Markedly agitated and restless; unable to remain seated. Intrusive and over-familiar with staff. Strong rapport established quickly but boundaries repeatedly tested. No abnormal involuntary movements.",
      speech: "Markedly pressured speech, very rapid and loud. Difficult to interrupt. Excessive in quantity. Spontaneous. Fluent without dysarthria.",
      mood: "Elevated and euphoric: \"I've never felt so alive — this is the best I've ever felt in my entire life.\"",
      affect: "Elevated and euphoric affect, full range, congruent with reported mood. Labile — shifts to irritability when interrupted. Infectious quality.",
      thought_process: "Flight of ideas: rapid topic changes with discernible connections. Tangential at times. Goal-directed when focused. No thought blocking.",
      thought_content: "Grandiose delusions: believes he has invented a revolutionary app worth millions. No persecutory ideation. No suicidal or homicidal ideation. Denies thought insertion or broadcast.",
      perception: "No hallucinations elicited. No illusions. No depersonalisation or derealisation.",
      cognition: "Alert and oriented x3. Attention grossly impaired — unable to complete serial 7s. 3-word recall 3/3 immediate, 1/3 at 5 minutes. Distractible throughout.",
      insight: "Absent insight. Denies any illness: \"There's nothing wrong with me — I'm just finally seeing clearly.\" Refuses admission.",
      judgment: "Severely impaired. Has spent £8,000 online in past 48 hours. Drove at high speed without recollection. Unable to recognise risks.",
    },
    keyTeachingPoints: [
      "Pressured speech, flight of ideas, grandiosity, and absent insight are hallmarks of mania",
      "Elevated mood + elevated affect = congruent; distinguish from incongruent affect in psychosis",
      "Absent insight in mania often requires involuntary admission under Mental Health Act",
      "Document impaired judgment with specific examples (financial decisions, risk-taking)",
    ],
  },
  {
    id: 2,
    title: "Severe Major Depressive Episode",
    diagnosis: "Major Depressive Disorder — Severe, with Psychotic Features",
    category: "Depression",
    color: "#1E5FAD",
    difficulty: "Beginner",
    clinicalContext: "72-year-old retired teacher, 3-month decline. Refusing food. Believes her organs have 'rotted away'. PHQ-9: 24.",
    mse: {
      appearance: "Elderly woman appearing significantly older than stated age. Severely underweight with temporal wasting. Dishevelled; hair uncombed, wearing same clothing as previous day. Pale and thin.",
      behavior: "Marked psychomotor retardation; slow to initiate movements and responses. Stooped posture. Minimal eye contact. Cooperative but effortful. Sitting with hands folded, head bowed.",
      speech: "Very slow rate and reduced volume; almost whispered. Markedly reduced spontaneity; responds only when directly questioned. Long latency before each response. Monosyllabic at times.",
      mood: "Severely depressed: \"I feel completely empty. I don't deserve to be alive. Everything is hopeless.\"",
      affect: "Severely blunted affect with restricted range. Tearful intermittently. Congruent with profoundly depressed mood. Non-reactive — no brightening even with discussion of family.",
      thought_process: "Slow but coherent thought process. Goal-directed. No formal thought disorder. Poverty of thought evident — long silences.",
      thought_content: "Nihilistic delusions: convinced her intestines have 'rotted away' and she has 'destroyed the family financially' (objectively false). Passive suicidal ideation: \"I wish I wouldn't wake up.\" Denies active plans. Marked guilt and worthlessness.",
      perception: "Denies hallucinations. No illusions reported. Possible hypnagogic hallucinations at sleep onset — not elaborated.",
      cognition: "Oriented to person; partially to place; disoriented to date. MMSE 21/30: loses points on orientation (3), registration (1), attention (3), recall (2). Impairment likely functional rather than degenerative.",
      insight: "Absent with respect to nihilistic beliefs (delusional). Partial insight into depressive symptoms — acknowledges feeling unwell but attributes it to physical disease.",
      judgment: "Severely impaired. Refuses food and fluids. Unable to weigh risks of non-treatment. Capacity assessment required.",
    },
    keyTeachingPoints: [
      "Nihilistic delusions (Cotard-like) in psychotic depression: 'organs rotted', 'financially ruined family'",
      "Psychomotor retardation: slow speech, long latency, reduced spontaneity — document specifically",
      "Blunted non-reactive affect with severe depression; distinguish from flat affect of schizophrenia",
      "Partial/absent insight in psychotic depression: capacity assessment and MHA consideration required",
    ],
  },
  {
    id: 3,
    title: "First-Episode Psychosis",
    diagnosis: "Schizophrenia — First Episode, Paranoid Subtype",
    category: "Psychosis",
    color: "#5B21B6",
    difficulty: "Intermediate",
    clinicalContext: "22-year-old student, 8-month deterioration. Social withdrawal, believes neighbours spy on him. Hears voices.",
    mse: {
      appearance: "Young male appearing stated age. Unkempt with poor hygiene; body odour evident. Wearing same clothes as reported last week. Thin; not eating regularly. Lanugo absent.",
      behavior: "Guarded and suspicious throughout. Repeatedly glanced at door. Limited eye contact. Slow to establish rapport. Cooperative minimally. No abnormal involuntary movements. Mild psychomotor slowing.",
      speech: "Normal rate and volume. Reduced spontaneity — only speaks when directly questioned. Decreased quantity. Occasional poverty of content. Fluent.",
      mood: "Frightened and apprehensive: \"I just feel scared all the time. Something isn't right.\"",
      affect: "Blunted affect with restricted range. Not congruent with content of frightening beliefs. No tearfulness. Non-reactive to rapport attempts.",
      thought_process: "Coherent but goal-directed only intermittently. Tangential on several occasions. No formal loosening of associations. Circumstantial on topic of neighbours.",
      thought_content: "Persecutory delusion: fixed belief that neighbours are recording him via microphones installed in his flat to 'collect evidence.' Ideas of reference: believes radio and TV news anchors address him directly. Denies suicidal or homicidal ideation. No obsessions.",
      perception: "Third-person auditory hallucinations: male voice outside his head commenting on his actions ('He's making tea'). Started approximately 4 months ago, daily. No visual, tactile or olfactory hallucinations. No illusions.",
      cognition: "Alert and oriented x3. Attention adequate — serial 7s to 72 completed. 3-word recall 3/3 immediate, 2/3 at 5 minutes. MoCA not formally administered.",
      insight: "Absent. Does not believe he is mentally unwell: \"There's nothing wrong with my mind — it's the neighbours who are doing this to me.\" Reluctant to accept psychiatric treatment.",
      judgment: "Impaired in context of delusional system. Has stopped attending university. Refuses to leave flat alone. Isolated from all social supports. Intact for immediate personal safety.",
    },
    keyTeachingPoints: [
      "Third-person auditory hallucinations are a Schneiderian first-rank symptom of schizophrenia",
      "Blunted affect ≠ flat affect: some emotional response preserved; flat = absent entirely",
      "Absent insight is extremely common in first-episode psychosis — drives engagement challenge",
      "Ideas of reference (TV/radio directed at patient) = psychotic symptom; distinguish from social self-consciousness",
    ],
  },
  {
    id: 4,
    title: "Obsessive-Compulsive Disorder",
    diagnosis: "OCD — Contamination Obsessions with Checking and Washing Compulsions",
    category: "OCD",
    color: "#059669",
    difficulty: "Intermediate",
    clinicalContext: "26-year-old nurse. Intrusive thoughts about contaminating patients. 60+ handwashes/shift. 3+ hours on rituals daily.",
    mse: {
      appearance: "Neatly dressed in uniform. Visibly distressed. Excoriated, raw skin on bilateral hands from excessive washing. Appears stated age. Good general hygiene paradoxically.",
      behavior: "Cooperative and engaged. Good eye contact. Noticeably tenses when discussing work-related content. Repeatedly straightens items on desk during interview. Rapport established with reassurance.",
      speech: "Normal rate, rhythm and volume. Initially hesitant and guarded; becomes more spontaneous as rapport builds. Fluent. No formal speech abnormalities.",
      mood: "Anxious and ashamed: \"I'm embarrassed even saying it out loud. You'll think I'm crazy.\"",
      affect: "Anxious and dysphoric affect. Visible relief when normalised. Congruent with reported shame and anxiety. Reactive — brightens when empathy offered.",
      thought_process: "Coherent and goal-directed. Logical. No formal thought disorder. Perseverative themes around contamination and harm to others.",
      thought_content: "Ego-dystonic intrusive thoughts: fears she has administered wrong medication and will harm patients despite no actual errors. Compulsive urges to check drug charts, re-read notes, and wash hands. Distinguishes clearly that thoughts are irrational. No suicidal ideation. No delusions. Secondary low mood with passive worthlessness.",
      perception: "No hallucinations or illusions. No depersonalisation.",
      cognition: "Alert and fully oriented. Attention and concentration intact. Memory intact. Cognitive function not formally assessed.",
      insight: "Full insight: clearly recognises obsessions as products of her own mind, ego-dystonic and irrational. Insight into impact on occupational functioning. Motivated for treatment.",
      judgment: "Intact for routine decisions. Impaired specifically in occupational context due to compulsive rituals consuming clinical time. Judgment about treatment-seeking intact and appropriate.",
    },
    keyTeachingPoints: [
      "Ego-dystonic = patient recognises thoughts as alien/against values; ego-syntonic = feels natural (as in OCPD)",
      "Full insight in OCD is common and clinically important — differentiates from psychosis",
      "Affect can be reactive despite anxiety — OCD is not associated with blunted or flat affect",
      "Document physical manifestations of compulsions: excoriated hands indicate severity",
    ],
  },
  {
    id: 5,
    title: "Generalised Anxiety Disorder",
    diagnosis: "Generalised Anxiety Disorder — Moderate Severity",
    category: "Anxiety",
    color: "#0891B2",
    difficulty: "Beginner",
    clinicalContext: "41-year-old accountant. 9 months of constant worry about everything. Headaches, insomnia, muscle tension.",
    mse: {
      appearance: "Middle-aged male appearing stated age, slightly older. Well-groomed and smartly dressed. Slightly dishevelled hair. Fidgeting with watch and ring throughout interview.",
      behavior: "Cooperative and engaged. Fidgety — crosses/uncrosses legs repeatedly. Tense body posture. Good eye contact. Rapport easily established. Psychomotor activity mildly increased.",
      speech: "Normal rate, rhythm and volume. Slightly increased spontaneity. Fluent. Talks at length when prompted about worries. No formal speech abnormalities.",
      mood: "Anxious and frustrated: \"I'm exhausted by it. I've been running on empty for months, I just can't switch my brain off.\"",
      affect: "Anxious affect throughout. Full range preserved. Congruent with reported anxiety. Reactive — able to smile briefly. No tearfulness. Some exasperation.",
      thought_process: "Coherent and goal-directed. Logical. Ruminative quality — returns repeatedly to worry themes. Circumstantial about work stressors. No formal thought disorder.",
      thought_content: "Multiple worry domains: work performance, family health, finances, global events, domestic safety (e.g. forgetting to lock doors). Difficulty controlling worry — identifies as pervasive. No obsessions or compulsions. No delusions. Passive low mood secondary to anxiety. No suicidal ideation.",
      perception: "No hallucinations, illusions, or perceptual disturbances reported.",
      cognition: "Alert and fully oriented. Concentration mildly impaired — reports difficulty focusing at work. Formal cognitive testing not administered.",
      insight: "Full insight: recognises worry is excessive and irrational: \"I know most of this is unlikely — it's like my brain can't accept that.\" Motivated and help-seeking.",
      judgment: "Largely intact. Some avoidance behaviours (checking doors repeatedly, delegating decisions). No high-risk behaviours. Appropriate help-seeking demonstrates sound judgment.",
    },
    keyTeachingPoints: [
      "GAD affect: anxious but reactive with full range — not restricted/blunted (that would suggest depression)",
      "Thought content: multiple worry domains, ego-syntonic quality (vs. OCD obsessions which are ego-dystonic)",
      "Insight is almost always full in GAD — patients are distressed by their worry, not unaware",
      "Somatic manifestations (fidgeting, tension) should be documented in behaviour and speech sections",
    ],
  },
];

/* ── MSE field scoring helper ── */
function scoreMSEField(text, fieldKey) {
  if (!text || text.trim().length < 10) return 0;
  const t = text.toLowerCase();
  const fieldChecks = {
    appearance: ["groom", "dress", "hygien", "age", "cloth", "appear", "weight", "nourish"],
    behavior: ["eye contact", "rapport", "cooperat", "psychomotor", "agitat", "retard", "movement"],
    speech: ["rate", "volume", "spontan", "fluent", "pressur", "slow", "quantity"],
    mood: ["feel", "mood", "depress", "elevat", "anxious", "\"", "'"],
    affect: ["range", "reactiv", "congruen", "blunt", "flat", "labil", "restrict"],
    thought_process: ["goal-direct", "coherent", "tangential", "circumstan", "flight", "loose", "block"],
    thought_content: ["delusion", "suicid", "obsess", "ideation", "persecutor", "grandiose", "homicid"],
    perception: ["hallucin", "illusion", "voice", "visual", "auditory", "deperso"],
    cognition: ["orient", "memory", "attention", "recall", "mmse", "moca", "serial"],
    insight: ["insight", "recogni", "aware", "accept", "treatment", "unwell"],
    judgment: ["judgment", "judgement", "intact", "impair", "decision", "risk"],
  };
  const checks = fieldChecks[fieldKey] || [];
  const hits = checks.filter(kw => t.includes(kw)).length;
  const lengthScore = Math.min(text.trim().length / 60, 1);
  return Math.round(((hits / Math.max(checks.length, 1)) * 0.7 + lengthScore * 0.3) * 100);
}

function MSETrainer({ progress, setProgress, user }) {
  const [view, setView] = useState("home"); // home | practice | sample | review
  const [practiceCase, setPracticeCase] = useState(null);
  const [sampleCase, setSampleCase] = useState(null);
  const [mseInput, setMseInput] = useState({});
  const [activeField, setActiveField] = useState("appearance");
  const [evalResult, setEvalResult] = useState(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [remaining, setRemaining]     = useState(null);
  const [limitError, setLimitError]   = useState("");
  const [learnMode, setLearnMode] = useState(null); // field key for learn panel
  const [learnChat, setLearnChat] = useState([]);
  const [learnInput, setLearnInput] = useState("");
  const [learnLoading, setLearnLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("mse"); // for sample MSE view tabs
  const chatRef = useRef(null);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [learnChat]);

  const PRACTICE_CASES = [
    { id: "p1", title: "The Withdrawn Student", difficulty: "Beginner", color: ACCENT, hint: "20-year-old male, 6 weeks low mood, social withdrawal, sleep and appetite changes. Denies suicidal ideation. Slow in interview.", expected: "MDD — moderate severity" },
    { id: "p2", title: "The Restless Executive", difficulty: "Intermediate", color: "#D97706", hint: "35-year-old female, 4 days no sleep, grandiose plans, pressured speech, buying sprees. Brought in by husband. First psychiatric contact.", expected: "Bipolar I — Manic Episode" },
    { id: "p3", title: "The Fearful Farmer", difficulty: "Intermediate", color: PURPLE, hint: "24-year-old male, 8 months. Believes neighbours spy on him via radio waves. Hears voice narrating actions. Self-neglect. Social withdrawal.", expected: "Schizophrenia — first episode" },
    { id: "p4", title: "The Anxious Nurse", difficulty: "Intermediate", color: "#059669", hint: "26-year-old nurse. Intrusive thoughts about harming patients. Compulsive handwashing 60+ times/shift. Ego-dystonic. Distressed. Seeking help.", expected: "OCD" },
    { id: "p5", title: "The Forgetful Professor", difficulty: "Advanced", color: TEAL, hint: "68-year-old retired professor. 18-month cognitive decline. Gets lost, repeats questions, word-finding difficulties. Managed ADLs with prompting. MMSE 21/30.", expected: "Alzheimer's Disease — mild-moderate" },
  ];

  async function evaluateMSE() {
    setEvalLoading(true);
    const inputSummary = MSE_FIELDS.map(f => `${f.label.toUpperCase()}:\n${mseInput[f.key] || "(blank)"}`).join("\n\n");
    const scores = MSE_FIELDS.reduce((acc, f) => { acc[f.key] = scoreMSEField(mseInput[f.key], f.key); return acc; }, {});
    const avgScore = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / MSE_FIELDS.length);
    const sys = `You are a psychiatry clinical tutor evaluating a medical student's Mental Status Examination write-up for this case: "${practiceCase?.hint}". Expected diagnosis: ${practiceCase?.expected}.

The student wrote:
${inputSummary}

Return ONLY valid JSON (no markdown):
{
  "overallScore": <0-100>,
  "pass": <true/false>,
  "summaryComment": "<2-3 sentence overall impression>",
  "fieldFeedback": {
    "appearance": "<specific feedback on this field>",
    "behavior": "<feedback>",
    "speech": "<feedback>",
    "mood": "<feedback>",
    "affect": "<feedback>",
    "thought_process": "<feedback>",
    "thought_content": "<feedback>",
    "perception": "<feedback>",
    "cognition": "<feedback>",
    "insight": "<feedback>",
    "judgment": "<feedback>"
  },
  "missedElements": ["<missed clinical finding 1>", "<missed clinical finding 2>"],
  "exemplarPhrase": "<one example of how a key finding could be better expressed>",
  "clinicalReasoningFeedback": "<2-3 sentences on whether the MSE findings support the expected diagnosis>",
  "improvements": ["<improvement 1>", "<improvement 2>", "<improvement 3>"]
}`;
    if (!user) { setLimitError("Please log in to use AI features."); setEvalLoading(false); return; }
    setLimitError("");
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const result = await askAI("mse", [{ role: "user", content: sys }], {}, session);
      const parsed = safeParseJSON(result.text);
      setEvalResult(parsed ? { ...parsed, fieldScores: scores, avgScore } : { error: result.text, fieldScores: scores, avgScore });
      if (result.remaining !== null) setRemaining(result.remaining);
    } catch (err) {
      setLimitError(err.message);
      setEvalResult({ error: err.message, fieldScores: scores, avgScore });
    }
    setEvalLoading(false);
    setView("review");
    if (!progress.mse.explored.includes("practice")) {
      setProgress(p => ({ ...p, mse: { explored: [...p.mse.explored, "practice"] } }));
    }
  }

  async function sendLearnMsg() {
    if (!learnInput.trim() || learnLoading) return;
    const msg = learnInput.trim(); setLearnInput("");
    const field = MSE_FIELDS.find(f => f.key === learnMode);
    const newM = [...learnChat, { role: "user", content: msg }];
    setLearnChat(newM); setLearnLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const result = await askAI(
        "mse",
        newM,
        { domain: field?.label, description: field?.description, prompts: field?.prompts?.join(", ") },
        session
      );
      setLearnChat([...newM, { role: "assistant", content: result.text }]);
      if (result.remaining !== null) setRemaining(result.remaining);
    } catch (err) {
      setLearnChat([...newM, { role: "assistant", content: "⚠️ " + err.message }]);
    }
    setLearnLoading(false);
    if (!progress.mse.explored.includes(learnMode)) {
      setProgress(p => ({ ...p, mse: { explored: [...p.mse.explored, learnMode] } }));
    }
  }

  /* ─── REVIEW VIEW ─── */
  if (view === "review" && evalResult) {
    const fields = MSE_FIELDS;
    const ScoreBar = ({ score, label }) => (
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
          <span style={{ fontSize: 12, color: "#475569", fontWeight: 500 }}>{label}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: score >= 70 ? TEAL : score >= 40 ? AMBER : "#DC2626" }}>{score}%</span>
        </div>
        <div style={{ background: "#EEF2F7", borderRadius: 99, height: 6, overflow: "hidden" }}>
          <div style={{ width: `${score}%`, background: score >= 70 ? TEAL : score >= 40 ? AMBER : "#DC2626", height: "100%", borderRadius: 99, transition: "width .8s ease" }} />
        </div>
      </div>
    );
    return (
      <div className="fade-in">
        <div style={{ display: "flex", gap: 8, marginBottom: "1.25rem", flexWrap: "wrap" }}>
          <button onClick={() => { setView("practice"); setEvalResult(null); }} style={{ ...S.btn("outline"), fontSize: 13 }}>← Revise MSE</button>
          <button onClick={() => { setView("home"); setEvalResult(null); setMseInput({}); setPracticeCase(null); }} style={{ ...S.btn("ghost"), fontSize: 13 }}>← MSE Home</button>
        </div>

        {/* Header */}
        <div style={{ ...S.card, borderTop: `4px solid ${practiceCase?.color}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <div>
              <span style={S.badge()}>{practiceCase?.difficulty}</span>
              <h2 style={{ ...S.sectionTitle, fontSize: 18, marginTop: 6, marginBottom: 2 }}>{practiceCase?.title} — Feedback</h2>
              <div style={{ fontSize: 13, color: "#64748b" }}>Expected: <strong>{practiceCase?.expected}</strong></div>
            </div>
            {!evalResult.error && (
              <div style={{ textAlign: "center", background: evalResult.pass ? TEAL_LIGHT : "#FEF2F2", borderRadius: 12, padding: "10px 20px", border: `2px solid ${evalResult.pass ? TEAL : "#DC2626"}` }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: evalResult.pass ? TEAL : "#DC2626" }}>{evalResult.overallScore ?? evalResult.avgScore}%</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: evalResult.pass ? TEAL : "#DC2626" }}>{evalResult.pass ? "✓ PASS" : "✗ NEEDS WORK"}</div>
              </div>
            )}
          </div>
          {!evalResult.error && evalResult.summaryComment && (
            <div style={{ marginTop: 12, background: "#F8FAFC", borderRadius: 9, padding: "10px 14px", fontSize: 13, color: "#334155", lineHeight: 1.75, borderLeft: `4px solid ${ACCENT}` }}>
              💬 {evalResult.summaryComment}
            </div>
          )}
        </div>

        {!evalResult.error && (
          <>
            {/* Field scores */}
            <div style={S.card}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>Field-by-Field Coverage</div>
              {fields.map(f => <ScoreBar key={f.key} score={evalResult.fieldScores?.[f.key] ?? 0} label={f.label} />)}
            </div>

            {/* Detailed feedback per field */}
            <div style={S.card}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>Detailed Field Feedback</div>
              {fields.map(f => {
                const score = evalResult.fieldScores?.[f.key] ?? 0;
                const fb = evalResult.fieldFeedback?.[f.key];
                return (
                  <div key={f.key} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #EEF2F7" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 15 }}>{f.icon}</span>
                      <span style={{ fontWeight: 700, fontSize: 13, color: f.color }}>{f.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: score >= 70 ? TEAL : score >= 40 ? AMBER : "#DC2626", marginLeft: "auto", background: score >= 70 ? TEAL_LIGHT : score >= 40 ? "#FEF3C7" : "#FEF2F2", borderRadius: 20, padding: "2px 8px" }}>{score}%</span>
                    </div>
                    {fb && <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.7, paddingLeft: 23 }}>{fb}</div>}
                  </div>
                );
              })}
            </div>

            {/* Clinical reasoning */}
            {evalResult.clinicalReasoningFeedback && (
              <div style={{ ...S.card, borderLeft: `4px solid ${PURPLE}` }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: PURPLE, marginBottom: 6 }}>🧩 Clinical Reasoning</div>
                <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.75 }}>{evalResult.clinicalReasoningFeedback}</div>
              </div>
            )}

            {/* Missed + Improvements */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px,1fr))", gap: "0.875rem" }}>
              {evalResult.missedElements?.length > 0 && (
                <div style={{ ...S.card, background: "#FEF2F2", border: "1px solid #FCA5A5" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#DC2626", marginBottom: 8 }}>❌ Missed Elements</div>
                  {evalResult.missedElements.map((m, i) => <div key={i} style={{ fontSize: 13, color: "#991B1B", marginBottom: 5 }}>• {m}</div>)}
                </div>
              )}
              {evalResult.improvements?.length > 0 && (
                <div style={{ ...S.card, background: "#FFFBEB", border: "1px solid #FDE68A" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: AMBER, marginBottom: 8 }}>💡 Improvements</div>
                  {evalResult.improvements.map((imp, i) => <div key={i} style={{ fontSize: 13, color: "#92400E", marginBottom: 6, paddingLeft: 10, borderLeft: `3px solid ${AMBER}` }}>{i + 1}. {imp}</div>)}
                </div>
              )}
            </div>

            {evalResult.exemplarPhrase && (
              <div style={{ ...S.card, background: TEAL_LIGHT, border: `1px solid ${TEAL}33` }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: TEAL, marginBottom: 6 }}>✍️ Exemplar Phrasing</div>
                <div style={{ fontSize: 13, color: "#134E4A", fontStyle: "italic", lineHeight: 1.7 }}>"{evalResult.exemplarPhrase}"</div>
              </div>
            )}
          </>
        )}
        {evalResult.error && (
          <div style={{ ...S.card, background: "#FEF2F2" }}>
            <div style={{ fontWeight: 700, color: "#DC2626" }}>Evaluation error — raw response:</div>
            <div style={{ fontSize: 12, color: "#334155", marginTop: 8, whiteSpace: "pre-wrap" }}>{evalResult.error}</div>
          </div>
        )}
      </div>
    );
  }

  /* ─── PRACTICE VIEW ─── */
  if (view === "practice" && practiceCase) {
    const currentField = MSE_FIELDS.find(f => f.key === activeField);
    const filledCount = MSE_FIELDS.filter(f => mseInput[f.key]?.trim()).length;
    return (
      <div className="fade-in">
        <button onClick={() => setView("home")} style={{ ...S.btn("outline"), marginBottom: "1rem", fontSize: 13 }}>← Back</button>
        <div style={{ ...S.card, borderTop: `4px solid ${practiceCase.color}`, marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <span style={S.badge()}>{practiceCase.difficulty}</span>
              <h2 style={{ ...S.sectionTitle, fontSize: 18, marginTop: 6, marginBottom: 4 }}>{practiceCase.title}</h2>
              <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, maxWidth: 520 }}>{practiceCase.hint}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: filledCount === MSE_FIELDS.length ? TEAL : ACCENT }}>{filledCount}/{MSE_FIELDS.length}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>fields filled</div>
              <div style={{ marginTop: 4, width: 60 }}><ProgressBar value={filledCount} max={MSE_FIELDS.length} color={filledCount === MSE_FIELDS.length ? TEAL : ACCENT} height={5} /></div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "1rem", flexDirection: "row", flexWrap: "wrap" }}>
          {/* Field navigator */}
          <div style={{ width: "100%", maxWidth: 200, flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>MSE Fields</div>
            {MSE_FIELDS.map(f => {
              const filled = !!(mseInput[f.key]?.trim());
              const active = activeField === f.key;
              return (
                <button key={f.key} onClick={() => setActiveField(f.key)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: active ? `${f.color}15` : "transparent", border: active ? `1.5px solid ${f.color}` : "1px solid transparent", borderRadius: 8, cursor: "pointer", textAlign: "left", marginBottom: 3, fontFamily: "inherit", color: active ? f.color : "#475569", fontWeight: active ? 700 : 400, fontSize: 12.5 }}>
                  <span style={{ fontSize: 14 }}>{f.icon}</span>
                  <span style={{ flex: 1 }}>{f.label}</span>
                  {filled && <span style={{ color: TEAL, fontSize: 11 }}>✓</span>}
                </button>
              );
            })}
            <button onClick={evaluateMSE} disabled={filledCount < 6 || evalLoading}
              style={{ ...S.btn(), width: "100%", marginTop: 12, fontSize: 13, opacity: filledCount < 6 ? 0.5 : 1 }}>
              {evalLoading ? "Evaluating…" : "Submit for Feedback"}
            </button>
            {filledCount < 6 && <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "center", marginTop: 6 }}>Fill at least 6 fields</div>}
          </div>

          {/* Writing area */}
          <div style={{ flex: 1, minWidth: 260 }}>
            {currentField && (
              <div style={{ ...S.card, borderTop: `3px solid ${currentField.color}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 20 }}>{currentField.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: 16, color: currentField.color }}>{currentField.label}</span>
                </div>
                <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 10, lineHeight: 1.6 }}>{currentField.description}</div>

                {/* Prompts */}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Key descriptors</div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {currentField.prompts.map((p, i) => (
                      <button key={i} onClick={() => setMseInput(prev => ({ ...prev, [activeField]: (prev[activeField] ? prev[activeField] + " " : "") + p + "." }))}
                        style={{ background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 6, padding: "3px 9px", fontSize: 11.5, color: "#475569", cursor: "pointer", fontFamily: "inherit" }}>
                        + {p}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  style={{ ...S.textarea, minHeight: 120, borderColor: currentField.color + "55" }}
                  value={mseInput[activeField] || ""}
                  onChange={e => setMseInput(prev => ({ ...prev, [activeField]: e.target.value }))}
                  placeholder={`Write your ${currentField.label} findings here…\n\nE.g.: ${currentField.commonPhrases?.[0] || ""}`}
                />

                {/* Common phrases */}
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Common phrases (click to insert)</div>
                  {currentField.commonPhrases?.map((ph, i) => (
                    <button key={i} onClick={() => setMseInput(prev => ({ ...prev, [activeField]: ph }))}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "#F8FAFC", border: "1px solid #EEF2F7", borderRadius: 6, padding: "5px 10px", fontSize: 12, color: "#334155", cursor: "pointer", marginBottom: 4, fontFamily: "inherit", fontStyle: "italic" }}>
                      "{ph}"
                    </button>
                  ))}
                </div>

                {/* Red flags */}
                {currentField.redFlags?.length > 0 && (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ fontSize: 12, color: "#DC2626", cursor: "pointer", fontWeight: 600 }}>🚩 Red flag findings to know</summary>
                    <div style={{ marginTop: 6 }}>
                      {currentField.redFlags.map((rf, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#991B1B", marginBottom: 4, background: "#FEF2F2", borderRadius: 5, padding: "4px 8px" }}>⚠️ {rf}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ─── SAMPLE MSE VIEW ─── */
  if (view === "sample" && sampleCase) {
    return (
      <div className="fade-in">
        <button onClick={() => setView("home")} style={{ ...S.btn("outline"), marginBottom: "1rem", fontSize: 13 }}>← Back</button>
        <div style={{ ...S.card, borderTop: `4px solid ${sampleCase.color}` }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ ...S.badge(), background: `${sampleCase.color}18`, color: sampleCase.color }}>{sampleCase.category}</span>
            <span style={S.badge()}>{sampleCase.difficulty}</span>
          </div>
          <h2 style={{ ...S.sectionTitle, color: sampleCase.color, fontSize: 18, marginBottom: 4 }}>{sampleCase.title}</h2>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }}>Diagnosis: <strong style={{ color: "#1e293b" }}>{sampleCase.diagnosis}</strong></div>
          <div style={{ background: "#F8FAFC", borderRadius: 9, padding: "10px 14px", fontSize: 13, color: "#334155", lineHeight: 1.7, borderLeft: `4px solid ${sampleCase.color}` }}>
            📋 {sampleCase.clinicalContext}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", background: "#F1F5F9", borderRadius: 10, padding: 4, marginBottom: "1rem", gap: 4 }}>
          {[["mse", "📋 Full MSE"], ["teaching", "💡 Teaching Points"]].map(([id, label]) => (
            <button key={id} onClick={() => setActiveTab(id)}
              style={{ flex: 1, background: activeTab === id ? "#fff" : "transparent", border: "none", borderRadius: 7, padding: "8px 0", fontSize: 13, fontWeight: activeTab === id ? 700 : 400, color: activeTab === id ? ACCENT_DARK : "#64748b", cursor: "pointer", fontFamily: "inherit", boxShadow: activeTab === id ? "0 1px 4px rgba(0,0,0,.08)" : "none" }}>
              {label}
            </button>
          ))}
        </div>

        {activeTab === "mse" && (
          <div>
            {MSE_FIELDS.map(f => (
              <div key={f.key} style={{ ...S.card, borderLeft: `4px solid ${f.color}`, padding: "1rem 1.25rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                  <span style={{ fontSize: 16 }}>{f.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: 13, color: f.color }}>{f.label}</span>
                </div>
                <div style={{ fontSize: 13.5, color: "#334155", lineHeight: 1.8 }}>{sampleCase.mse[f.key]}</div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "teaching" && (
          <div style={S.card}>
            <div style={{ fontWeight: 700, color: AMBER, marginBottom: 12, fontSize: 14 }}>💡 Key Teaching Points</div>
            {sampleCase.keyTeachingPoints.map((pt, i) => (
              <div key={i} style={{ fontSize: 13, color: "#1e293b", marginBottom: 10, background: "#FFFBEB", borderRadius: 8, padding: "8px 12px", borderLeft: `3px solid ${AMBER}`, lineHeight: 1.7 }}>
                <strong style={{ color: AMBER }}>#{i + 1}</strong> {pt}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ─── HOME VIEW ─── */
  const exploredCount = progress.mse.explored.length;
  return (
    <div className="fade-in">
      <h2 style={S.sectionTitle}>🧠 MSE Trainer</h2>
      <p style={S.sectionSub}>Practice writing Mental Status Examinations, study sample MSEs, and learn each domain with AI coaching.</p>
      {/* ── AI Usage Banner ── */}
      {limitError && (
        <div style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:9, padding:"10px 14px", marginBottom:"1rem", fontSize:13, color:"#DC2626", display:"flex", alignItems:"flex-start", gap:8 }}>
          <span style={{ flexShrink:0 }}>⚠️</span>
          <span>{limitError}</span>
        </div>
      )}
      {remaining !== null && remaining >= 0 && (
        <div style={{ background:"#F0F9FF", border:"1px solid #BAE6FD", borderRadius:9, padding:"8px 14px", marginBottom:"1rem", fontSize:12.5, color:"#0369A1", display:"flex", alignItems:"center", gap:8 }}>
          <span>💡</span>
          <span>{remaining} AI generation{remaining !== 1 ? "s" : ""} remaining today (resets at midnight UTC)</span>
        </div>
      )}

      {/* Hero */}
      <div style={{ ...S.card, background: `linear-gradient(135deg, ${ACCENT_DARK}, #1E5FAD)`, color: "#fff", marginBottom: "1.25rem" }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, opacity: .65, marginBottom: 6 }}>11 Domains · AI Evaluation · Sample MSEs</div>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Master the Mental Status Examination</div>
        <div style={{ fontSize: 13, opacity: .85, lineHeight: 1.6, maxWidth: 480 }}>The MSE is the cornerstone of every psychiatric assessment. Practice writing complete, precise MSEs across 5 psychiatric diagnoses and receive instant AI feedback.</div>
        <div style={{ display: "flex", gap: "1rem", marginTop: "1rem", flexWrap: "wrap" }}>
          <div style={{ background: "rgba(255,255,255,.12)", borderRadius: 10, padding: "8px 14px" }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{exploredCount}</div>
            <div style={{ fontSize: 11, opacity: .75 }}>domains explored</div>
          </div>
          <div style={{ background: "rgba(255,255,255,.12)", borderRadius: 10, padding: "8px 14px" }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>11</div>
            <div style={{ fontSize: 11, opacity: .75 }}>MSE domains</div>
          </div>
          <div style={{ background: "rgba(255,255,255,.12)", borderRadius: 10, padding: "8px 14px" }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>5</div>
            <div style={{ fontSize: 11, opacity: .75 }}>sample MSEs</div>
          </div>
        </div>
      </div>

      {/* Domain Explorer */}
      <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Learn Each Domain</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {MSE_FIELDS.map(f => {
          const explored = progress.mse.explored.includes(f.key);
          const active = learnMode === f.key;
          return (
            <button key={f.key} onClick={() => { setLearnMode(active ? null : f.key); if (!active) { setLearnChat([]); } }}
              style={{ ...S.card, cursor: "pointer", textAlign: "left", marginBottom: 0, padding: "0.875rem", border: active ? `2px solid ${f.color}` : explored ? `1.5px solid ${f.color}44` : "1px solid #E8EEF4", borderTop: `3px solid ${f.color}`, transition: "all .15s" }}>
              <div style={{ fontSize: 20, marginBottom: 5 }}>{f.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 12.5, color: f.color, marginBottom: 2, lineHeight: 1.2 }}>{f.label}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>{explored ? "✓ Explored" : "Click to learn"}</div>
            </button>
          );
        })}
      </div>

      {/* Learn panel */}
      {learnMode && (() => {
        const field = MSE_FIELDS.find(f => f.key === learnMode);
        return (
          <div style={{ ...S.card, borderLeft: `4px solid ${field.color}`, marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 20 }}>{field.icon}</span>
              <span style={{ fontWeight: 700, fontSize: 15, color: field.color }}>{field.label}</span>
              <button onClick={() => setLearnMode(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 18 }}>✕</button>
            </div>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10, lineHeight: 1.6 }}>{field.description}</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
              {field.prompts?.map((p, i) => <span key={i} style={{ background: `${field.color}12`, color: field.color, borderRadius: 6, padding: "3px 9px", fontSize: 11.5, fontWeight: 500 }}>{p}</span>)}
            </div>
            <div ref={chatRef} style={{ display: "flex", flexDirection: "column", maxHeight: 240, overflowY: "auto", marginBottom: "0.75rem", gap: 4 }}>
              {learnChat.length === 0 && (
                <div style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", padding: "20px 0" }}>Ask a question about {field.label} to start the lesson</div>
              )}
              {learnChat.map((m, i) => (
                <div key={i} style={S.bubble(m.role)}>
                  {m.role === "assistant" && <span style={{ fontSize: 10, color: "#94a3b8", display: "block", marginBottom: 3 }}>🤖 PsychAI Tutor</span>}
                  {m.content}
                </div>
              ))}
              {learnLoading && <div style={S.bubble("assistant")}><span style={{ color: "#94a3b8" }}>Thinking…</span></div>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={S.input} value={learnInput} onChange={e => setLearnInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendLearnMsg()} placeholder={`Ask about ${field.label}…`} />
              <button style={S.btn()} onClick={sendLearnMsg} disabled={learnLoading || !learnInput.trim()}>Ask AI</button>
            </div>
          </div>
        );
      })()}

      {/* Practice Cases */}
      <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Practice Writing an MSE</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {PRACTICE_CASES.map(pc => (
          <div key={pc.id} className="ch" style={{ ...S.card, cursor: "pointer", borderLeft: `5px solid ${pc.color}`, padding: "1rem 1.25rem" }}
            onClick={() => { setPracticeCase(pc); setMseInput({}); setActiveField("appearance"); setView("practice"); }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <span style={S.badge()}>{pc.difficulty}</span>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#1e293b", marginTop: 5, marginBottom: 3 }}>{pc.title}</div>
                <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.55 }}>{pc.hint}</div>
              </div>
              <button style={{ ...S.btn(), background: pc.color, fontSize: 13, padding: "8px 16px", alignSelf: "flex-start" }}>
                Write MSE →
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Sample MSEs */}
      <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Study Sample Completed MSEs</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: "0.875rem" }}>
        {SAMPLE_MSES.map(sm => (
          <button key={sm.id} className="ch" style={{ ...S.card, cursor: "pointer", textAlign: "left", marginBottom: 0, borderTop: `3px solid ${sm.color}`, padding: "1rem 1.125rem" }}
            onClick={() => { setSampleCase(sm); setView("sample"); }}>
            <span style={{ ...S.badge(), background: `${sm.color}18`, color: sm.color }}>{sm.category}</span>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b", margin: "6px 0 4px" }}>{sm.title}</div>
            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5, marginBottom: 8 }}>{sm.diagnosis}</div>
            <div style={{ fontSize: 11.5, color: sm.color, fontWeight: 600 }}>View full MSE + teaching points →</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   DDx BUILDER — FULL REBUILD
══════════════════════════════════════════ */

/* ── Symptom cluster quick-select data ── */
const SYMPTOM_CLUSTERS = [
  {
    category: "Mood Symptoms",
    color: ACCENT,
    icon: "😔",
    clusters: [
      { label: "Depressive Episode", symptoms: "Persistent low mood, anhedonia, poor sleep, reduced appetite, fatigue, poor concentration, feelings of worthlessness, passive suicidal ideation" },
      { label: "Manic Episode", symptoms: "Elevated or irritable mood, decreased need for sleep, grandiosity, pressured speech, flight of ideas, impulsive risky behaviour, increased goal-directed activity" },
      { label: "Mixed Features", symptoms: "Depressed mood with racing thoughts, insomnia, agitation, impulsivity and risk-taking behaviour occurring simultaneously" },
      { label: "Persistent Low Mood", symptoms: "Low-grade depressed mood most days for over 2 years, low energy, poor self-esteem, difficulty concentrating, without full MDD episode criteria" },
    ],
  },
  {
    category: "Psychotic Symptoms",
    color: PURPLE,
    icon: "🌀",
    clusters: [
      { label: "First-Episode Psychosis", symptoms: "Auditory hallucinations (third-person commentary), persecutory delusions, social withdrawal, self-neglect, flattened affect, 6+ months duration, no mood episode" },
      { label: "Acute Psychosis with Mood", symptoms: "Elevated mood with grandiose delusions, pressured speech, reduced sleep, psychomotor agitation, concurrent manic features" },
      { label: "Brief Psychosis", symptoms: "Sudden onset hallucinations and delusions following identifiable stressor, full resolution within 1 month, return to premorbid function" },
      { label: "Paranoid Presentation", symptoms: "Fixed non-bizarre persecutory belief without prominent hallucinations, otherwise preserved function, no mood episode, no negative symptoms" },
    ],
  },
  {
    category: "Anxiety & Fear",
    color: "#0891B2",
    icon: "😰",
    clusters: [
      { label: "Generalised Anxiety", symptoms: "Excessive uncontrollable worry about multiple domains (work, health, family, finances), restlessness, fatigue, poor concentration, muscle tension, insomnia, 6+ months" },
      { label: "Panic Attacks", symptoms: "Recurrent sudden palpitations, shortness of breath, chest tightness, dizziness, derealisation, fear of dying, with anticipatory anxiety and avoidance between attacks" },
      { label: "Social Anxiety", symptoms: "Intense fear of scrutiny or embarrassment in social situations, avoidance of social activities, physical symptoms on exposure, significant functional impairment" },
      { label: "Phobia / Avoidance", symptoms: "Intense disproportionate fear of specific object or situation, immediate anxiety response, avoidance behaviour, insight into irrationality" },
    ],
  },
  {
    category: "Obsessive & Compulsive",
    color: "#059669",
    icon: "🔄",
    clusters: [
      { label: "OCD — Contamination", symptoms: "Intrusive ego-dystonic thoughts about contamination or harm, compulsive handwashing, cleaning rituals, checking, hours spent on rituals, impaired work function" },
      { label: "OCD — Checking/Harm", symptoms: "Intrusive fears of causing harm through negligence (leaving gas on, locking doors), repeated checking rituals, clear distress, ego-dystonic, insight preserved" },
      { label: "Body Dysmorphic", symptoms: "Preoccupation with perceived physical defect invisible to others, mirror checking, camouflaging, social avoidance, significant distress, prior cosmetic procedures" },
      { label: "Hoarding", symptoms: "Persistent difficulty discarding possessions regardless of value, excessive acquisition, cluttered living space, significant distress or impairment, ego-syntonic" },
    ],
  },
  {
    category: "Trauma & Dissociation",
    color: "#DC2626",
    icon: "⚠️",
    clusters: [
      { label: "PTSD", symptoms: "Re-experiencing (nightmares, flashbacks), hypervigilance, avoidance of trauma reminders, emotional numbing, negative cognitions, hyperarousal, 1+ month after identified trauma" },
      { label: "Acute Stress Reaction", symptoms: "Dissociation, reduced awareness, derealisation within hours of severe trauma, resolves within 4 weeks, functional impairment" },
      { label: "Dissociative Symptoms", symptoms: "Episodes of depersonalisation (watching oneself from outside), derealisation (world feels unreal), amnesia gaps, identity confusion, often linked to trauma history" },
    ],
  },
  {
    category: "Cognitive & Organic",
    color: TEAL,
    icon: "🧠",
    clusters: [
      { label: "Dementia Presentation", symptoms: "Progressive memory decline over months-years, word-finding difficulties, getting lost, personality change, poor self-care, intact consciousness, age 65+" },
      { label: "Delirium", symptoms: "Acute confusion with fluctuating consciousness, disorientation, inattention, visual hallucinations, worse at night, identifiable medical precipitant" },
      { label: "Cognitive Decline (Younger)", symptoms: "Memory impairment, personality change, disinhibition, language difficulties under age 65, consider frontotemporal, HIV, autoimmune, prion disease" },
    ],
  },
  {
    category: "Substance Related",
    color: "#92400E",
    icon: "⚗️",
    clusters: [
      { label: "Alcohol Withdrawal", symptoms: "Tremor, sweating, tachycardia, anxiety, nausea 6-48 hours after last drink, visual hallucinations, risk of seizures and delirium tremens" },
      { label: "Stimulant Psychosis", symptoms: "Paranoid delusions, auditory hallucinations, agitation following cocaine or amphetamine use, resolves with abstinence, tachycardia, dilated pupils" },
      { label: "Substance Dependence", symptoms: "Tolerance, withdrawal symptoms, loss of control over use, persistent desire to cut down, continued use despite harm, social and occupational impairment" },
    ],
  },
  {
    category: "Personality & Behaviour",
    color: "#6D28D9",
    icon: "🪞",
    clusters: [
      { label: "Emotionally Unstable (BPD)", symptoms: "Intense unstable relationships (idealising/devaluing), fear of abandonment, identity instability, impulsivity, self-harm, labile mood lasting hours, chronic emptiness" },
      { label: "Antisocial Patterns", symptoms: "Pattern since age 15 of disregard for others' rights, deceitfulness, impulsivity, aggression, irresponsibility, lack of remorse, now adult" },
      { label: "Narcissistic Features", symptoms: "Grandiose sense of self-importance, preoccupation with success and power, lack of empathy, exploitation of others, entitlement, fragile self-esteem" },
    ],
  },
];

/* ── Organic/Emergency red-flag rules ── */
const ORGANIC_RED_FLAGS = [
  {
    flag: "Fever + altered consciousness + psychiatric symptoms",
    implication: "Rule out autoimmune encephalitis (anti-NMDA receptor), viral encephalitis, meningitis",
    urgency: "EMERGENCY",
    action: "Immediate neurology referral, LP, MRI brain, anti-NMDA antibodies",
  },
  {
    flag: "New-onset psychosis after age 40 with no family history",
    implication: "Higher suspicion for organic cause: space-occupying lesion, vascular, paraneoplastic",
    urgency: "URGENT",
    action: "MRI brain, full bloods including CRP, autoimmune screen, CT chest/abdomen/pelvis",
  },
  {
    flag: "Visual hallucinations predominating over auditory",
    implication: "Visual > auditory hallucinations = organic until proven otherwise (DLB, delirium, drugs)",
    urgency: "URGENT",
    action: "MRI brain, urine drug screen, FBC, metabolic panel, EEG",
  },
  {
    flag: "Acute confusion with fluctuating consciousness",
    implication: "Delirium — medical emergency. Common causes: infection, metabolic, medications, hypoxia",
    urgency: "EMERGENCY",
    action: "Urgent medical assessment, septic screen, ABG, glucose, electrolytes, bladder scan",
  },
  {
    flag: "Neurological signs (focal deficit, ataxia, diplopia, papilloedema)",
    implication: "Structural CNS lesion, Wernicke's encephalopathy (triad: confusion + ataxia + ophthalmoplegia)",
    urgency: "EMERGENCY",
    action: "Immediate IV thiamine (Pabrinex), CT/MRI brain, urgent neurology review",
  },
  {
    flag: "Cognitive decline with rapid progression (<2 years) especially in younger patient",
    implication: "Frontotemporal dementia, CJD, HIV dementia, autoimmune encephalitis, paraneoplastic",
    urgency: "URGENT",
    action: "MRI brain (DWI sequences), LP (14-3-3 protein for CJD), HIV test, autoimmune screen",
  },
  {
    flag: "First episode psychosis + new headache + papilloedema",
    implication: "Raised intracranial pressure — space-occupying lesion, subdural haematoma",
    urgency: "EMERGENCY",
    action: "Immediate CT head before LP, urgent neurosurgery if SOL found",
  },
  {
    flag: "Psychiatric symptoms + thyroid abnormality signs (tremor, weight loss, heat intolerance)",
    implication: "Thyrotoxicosis can cause anxiety, agitation, psychosis; myxoedema can cause depression, psychosis",
    urgency: "URGENT",
    action: "TFTs (TSH, free T4, T3), thyroid antibodies, endocrinology referral",
  },
  {
    flag: "Mood / cognitive symptoms + excessive thirst + polyuria + constipation",
    implication: "Hypercalcaemia (primary hyperparathyroidism, malignancy) — 'bones, stones, groans, psychic moans'",
    urgency: "URGENT",
    action: "Serum calcium, PTH, alkaline phosphatase, CXR",
  },
  {
    flag: "Psychosis + liver disease + Kayser-Fleischer rings + movement disorder in young patient",
    implication: "Wilson's disease — copper metabolism disorder presenting in teens/young adults",
    urgency: "URGENT",
    action: "Serum caeruloplasmin, 24h urine copper, slit-lamp exam, liver biopsy",
  },
  {
    flag: "Acute psychiatric presentation + known or suspected substance use",
    implication: "Always exclude substance-induced disorder before diagnosing primary psychiatric condition",
    urgency: "ROUTINE",
    action: "Urine drug screen, alcohol CAGE/AUDIT questionnaire, breathalyser, blood alcohol level",
  },
  {
    flag: "Depression + cognitive decline + gait disturbance + urinary incontinence (triad)",
    implication: "Normal Pressure Hydrocephalus (NPH) — 'wet, wobbly, wacky' — reversible cause of dementia",
    urgency: "URGENT",
    action: "MRI brain (periventricular lucency, enlarged ventricles), neurosurgery referral for LP trial",
  },
];

/* ── Rank color palette ── */
const RANK_COLORS = ["#15803D", "#1E5FAD", "#B45309", "#5B21B6", "#9D174D", "#0891B2"];

function DDxBuilder({ progress, setProgress, user }) {
  const [symptoms, setSymptoms]         = useState("");
  const [ddxResult, setDdxResult]       = useState(null);
  const [loading, setLoading]           = useState(false);
  const [refineQ, setRefineQ]           = useState("");
  const [refineResult, setRefineResult] = useState(null);
  const [refineLoading, setRefineLoading] = useState(false);
  const [activeClusterCat, setActiveClusterCat] = useState(null);
  const [expandedRed, setExpandedRed]   = useState(null);
  const [expandedDx, setExpandedDx]     = useState(null);
  const [urgencyFilter, setUrgencyFilter] = useState("ALL");
  const [showRedFlags, setShowRedFlags] = useState(false);
  const [remaining, setRemaining]       = useState(null);
  const [limitError, setLimitError]     = useState("");

  async function buildDDx() {
    if (!symptoms.trim() || loading) return;
    setLoading(true); setDdxResult(null); setRefineResult(null);

    const sys = `You are an expert psychiatry educator building a differential diagnosis for medical students.

Given this clinical presentation: "${symptoms}"

Return ONLY valid JSON (no markdown, no preamble):
{
  "summary": "<2-sentence clinical summary>",
  "differentials": [
    {
      "rank": 1,
      "diagnosis": "<diagnosis name>",
      "category": "<DSM-5 category>",
      "likelihood": "<High|Moderate|Low>",
      "reasoning": "<3-4 sentences explaining why this fits the presentation>",
      "supporting": ["<feature 1>", "<feature 2>", "<feature 3>"],
      "against": ["<feature arguing against>", "<feature arguing against>"],
      "key_discriminating_question": "<the single most useful question to ask>",
      "dsm5_criteria_met": "<which criteria from the presentation support this>",
      "initial_management": "<first-line management if this is confirmed>"
    }
  ],
  "organic_concerns": ["<any organic/medical cause to exclude>"],
  "emergency_flags": ["<any immediate safety concern>"],
  "recommended_investigations": ["<investigation 1>", "<investigation 2>"],
  "safety_assessment": "<brief comment on risk in this presentation>"
}

Include 4-6 differentials ranked by likelihood. Be specific to the presentation.`;

    if (!user) { setLimitError("Please log in to use AI features."); setLoading(false); return; }
    setLimitError("");
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const result = await askAI("ddx", [{ role: "user", content: symptoms }], {}, session);
      const parsed = safeParseJSON(result.text);
      setDdxResult(parsed ?? { error: result.text });
      if (result.remaining !== null) setRemaining(result.remaining);
      setProgress(p => ({ ...p, ddx: { built: p.ddx.built + 1 } }));
    } catch (err) {
      setLimitError(err.message);
    }
    setLoading(false);
  }

  async function refine() {
    if (!refineQ.trim() || refineLoading) return;
    if (!user) { setLimitError("Please log in to use AI features."); return; }
    setRefineLoading(true);
    setLimitError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const result = await askAI(
        "ddx_refine",
        [{ role: "user", content: refineQ }],
        {
          originalPresentation: symptoms,
          currentDifferentials: (ddxResult?.differentials || []).map(d => d.diagnosis),
          newInformation: refineQ,
        },
        session
      );
      if (result.remaining !== null) setRemaining(result.remaining);
      const parsed = safeParseJSON(result.text);
      if (parsed) {
        setRefineResult(parsed);
      } else {
        // If JSON parsing failed, show the raw text as a readable result
        setRefineResult({ text: result.text });
      }
    } catch (err) {
      setLimitError(err.message || "Could not update the differential. Please try again.");
    } finally {
      setRefineLoading(false);
    }
  }

  const filteredRedFlags = urgencyFilter === "ALL"
    ? ORGANIC_RED_FLAGS
    : ORGANIC_RED_FLAGS.filter(f => f.urgency === urgencyFilter);

  /* ── RESULTS VIEW ── */
  if (ddxResult && !ddxResult.error) {
    const diffs = ddxResult.differentials || [];
    const hasEmergency = ddxResult.emergency_flags?.length > 0;
    const hasOrganic = ddxResult.organic_concerns?.length > 0;

    return (
      <div className="fade-in">
        {/* Header / reset */}
        <div style={{ display: "flex", gap: 8, marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => { setDdxResult(null); setRefineResult(null); setRefineQ(""); }} style={{ ...S.btn("outline"), fontSize: 13 }}>← New Presentation</button>
          <span style={{ fontSize: 13, color: "#64748b" }}>{progress.ddx.built} differential{progress.ddx.built !== 1 ? "s" : ""} built this session</span>
        </div>

        {/* Emergency banner */}
        {hasEmergency && (
          <div style={{ background: "#FEF2F2", border: "2px solid #DC2626", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "1rem" }}>
            <div style={{ fontWeight: 700, color: "#DC2626", fontSize: 14, marginBottom: 8 }}>🚨 EMERGENCY FLAGS — Immediate Action Required</div>
            {ddxResult.emergency_flags.map((f, i) => (
              <div key={i} style={{ fontSize: 13, color: "#991B1B", marginBottom: 5, display: "flex", gap: 8 }}>
                <span>⚠️</span><span>{f}</span>
              </div>
            ))}
          </div>
        )}

        {/* Clinical summary */}
        <div style={{ ...S.card, borderLeft: `4px solid ${ACCENT}`, background: ACCENT_LIGHT }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: ACCENT_DARK, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Clinical Summary</div>
          <div style={{ fontSize: 14, color: ACCENT_DARK, lineHeight: 1.75 }}>{ddxResult.summary}</div>
        </div>

        {/* Differential cards */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
          Differential Diagnoses — {diffs.length} considered
        </div>
        {diffs.map((d, i) => {
          const color = RANK_COLORS[i] || "#888";
          const isExpanded = expandedDx === i;
          const likelihoodBg = d.likelihood === "High" ? "#F0FDF4" : d.likelihood === "Moderate" ? "#FFFBEB" : "#F8FAFC";
          const likelihoodColor = d.likelihood === "High" ? "#15803D" : d.likelihood === "Moderate" ? AMBER : "#64748b";
          return (
            <div key={i} style={{ ...S.card, borderLeft: `5px solid ${color}`, padding: 0, overflow: "hidden", marginBottom: "0.875rem" }}>
              {/* Card header — always visible */}
              <div style={{ padding: "1rem 1.25rem", cursor: "pointer" }} onClick={() => setExpandedDx(isExpanded ? null : i)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontWeight: 800, fontSize: 16, color }}># {d.rank}</span>
                      <span style={{ fontWeight: 700, fontSize: 15, color: "#1e293b" }}>{d.diagnosis}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ ...S.badge(), background: `${color}18`, color }}>{d.category}</span>
                      <span style={{ background: likelihoodBg, color: likelihoodColor, borderRadius: 20, padding: "3px 10px", fontSize: 11.5, fontWeight: 700 }}>
                        {d.likelihood === "High" ? "🟢" : d.likelihood === "Moderate" ? "🟡" : "⚪"} {d.likelihood} likelihood
                      </span>
                    </div>
                  </div>
                  <span style={{ color: "#94a3b8", fontSize: 18, flexShrink: 0 }}>{isExpanded ? "▲" : "▼"}</span>
                </div>
                {/* Reasoning always shown */}
                <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.75, marginTop: 8 }}>{d.reasoning}</div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div style={{ borderTop: "1px solid #EEF2F7", padding: "1rem 1.25rem" }}>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#15803D", textTransform: "uppercase", letterSpacing: .5, marginBottom: 6 }}>✓ Supporting Features</div>
                      {d.supporting?.map((s, j) => <div key={j} style={{ fontSize: 13, color: "#166534", marginBottom: 4, paddingLeft: 8, borderLeft: "3px solid #86EFAC" }}>{s}</div>)}
                    </div>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#DC2626", textTransform: "uppercase", letterSpacing: .5, marginBottom: 6 }}>✗ Arguments Against</div>
                      {d.against?.map((s, j) => <div key={j} style={{ fontSize: 13, color: "#991B1B", marginBottom: 4, paddingLeft: 8, borderLeft: "3px solid #FCA5A5" }}>{s}</div>)}
                    </div>
                  </div>
                  {d.dsm5_criteria_met && (
                    <div style={{ background: `${color}0D`, borderRadius: 8, padding: "8px 12px", marginBottom: 8, fontSize: 13, color: "#334155", lineHeight: 1.65 }}>
                      <strong style={{ color }}>DSM-5 criteria met:</strong> {d.dsm5_criteria_met}
                    </div>
                  )}
                  <div style={{ background: ACCENT_LIGHT, borderRadius: 8, padding: "8px 12px", marginBottom: 8, fontSize: 13, color: ACCENT_DARK }}>
                    <strong>🔑 Key discriminating question:</strong> {d.key_discriminating_question}
                  </div>
                  {d.initial_management && (
                    <div style={{ background: TEAL_LIGHT, borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#134E4A" }}>
                      <strong style={{ color: TEAL }}>💊 If confirmed — Initial management:</strong> {d.initial_management}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Investigations + Safety */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))", gap: "0.875rem", marginBottom: "1rem" }}>
          {ddxResult.recommended_investigations?.length > 0 && (
            <div style={{ ...S.card, borderLeft: `4px solid ${TEAL}` }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: TEAL, marginBottom: 8 }}>🔬 Recommended Investigations</div>
              {ddxResult.recommended_investigations.map((inv, i) => (
                <div key={i} style={{ fontSize: 13, color: "#334155", marginBottom: 5, paddingLeft: 8, borderLeft: "3px solid " + TEAL_LIGHT }}>→ {inv}</div>
              ))}
            </div>
          )}
          {ddxResult.safety_assessment && (
            <div style={{ ...S.card, borderLeft: `4px solid #DC2626`, background: "#FFFBEB" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#DC2626", marginBottom: 8 }}>🛡️ Safety Assessment</div>
              <div style={{ fontSize: 13, color: "#92400E", lineHeight: 1.7 }}>{ddxResult.safety_assessment}</div>
            </div>
          )}
        </div>

        {/* Organic concerns */}
        {hasOrganic && (
          <div style={{ ...S.card, background: "#FFFBEB", border: "1px solid #FDE68A" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: AMBER, marginBottom: 8 }}>⚕️ Organic Causes to Exclude</div>
            {ddxResult.organic_concerns.map((oc, i) => (
              <div key={i} style={{ fontSize: 13, color: "#92400E", marginBottom: 5 }}>• {oc}</div>
            ))}
          </div>
        )}

        {/* Refine panel */}
        <div style={S.card}>
          <div style={{ fontWeight: 700, fontSize: 14, color: ACCENT_DARK, marginBottom: 4 }}>🔄 Refine with New Information</div>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>Add a new clinical finding, investigation result, or history detail to see how the differential changes.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input style={{ ...S.input, flex: 1 }} value={refineQ}
              onChange={e => setRefineQ(e.target.value)}
              onKeyDown={e => e.key === "Enter" && refine()}
              placeholder="e.g. Urine drug screen negative. Mother has schizophrenia. Symptoms started after bereavement…" />
            <button style={S.btn()} onClick={refine} disabled={refineLoading || !refineQ.trim()}>
              {refineLoading ? "Updating…" : "Update →"}
            </button>
          </div>

          {refineResult && !refineResult.text && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 14, color: "#334155", background: "#F8FAFC", borderRadius: 9, padding: "10px 14px", lineHeight: 1.75, marginBottom: 10 }}>
                {refineResult.analysis}
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {refineResult.rises?.map((r, i) => (
                  <span key={i} style={{ background: "#F0FDF4", color: "#15803D", borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 600 }}>↑ {r}</span>
                ))}
                {refineResult.falls?.map((f, i) => (
                  <span key={i} style={{ background: "#FEF2F2", color: "#DC2626", borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 600 }}>↓ {f}</span>
                ))}
                {refineResult.new_considerations?.map((nc, i) => (
                  <span key={i} style={{ background: "#EDE9FE", color: PURPLE, borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 600 }}>+ New: {nc}</span>
                ))}
              </div>
              {refineResult.revised_top_diagnosis && (
                <div style={{ marginTop: 10, fontWeight: 700, color: TEAL, fontSize: 13 }}>
                  Updated most likely: {refineResult.revised_top_diagnosis}
                </div>
              )}
              {refineResult.next_question && (
                <div style={{ marginTop: 8, fontSize: 13, color: ACCENT_DARK, background: ACCENT_LIGHT, borderRadius: 8, padding: "8px 12px" }}>
                  🔑 Next question to ask: <em>{refineResult.next_question}</em>
                </div>
              )}
            </div>
          )}
          {refineResult?.text && (
            <div style={{ marginTop: 10, fontSize: 13, color: "#334155", background: "#F8FAFC", borderRadius: 8, padding: "10px 14px", lineHeight: 1.75 }}>{refineResult.text}</div>
          )}
        </div>
      </div>
    );
  }

  /* ── INPUT VIEW ── */
  return (
    <div className="fade-in">
      <h2 style={S.sectionTitle}>🔍 Differential Diagnosis Builder</h2>
      <p style={S.sectionSub}>Enter a psychiatric clinical presentation to generate a ranked differential with reasoning, DSM-5 criteria mapping, investigations, and organic red flags.</p>
      {/* ── AI Usage Banner ── */}
      {limitError && (
        <div style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:9, padding:"10px 14px", marginBottom:"1rem", fontSize:13, color:"#DC2626", display:"flex", alignItems:"flex-start", gap:8 }}>
          <span style={{ flexShrink:0 }}>⚠️</span>
          <span>{limitError}</span>
        </div>
      )}
      {remaining !== null && remaining >= 0 && (
        <div style={{ background:"#F0F9FF", border:"1px solid #BAE6FD", borderRadius:9, padding:"8px 14px", marginBottom:"1rem", fontSize:12.5, color:"#0369A1", display:"flex", alignItems:"center", gap:8 }}>
          <span>💡</span>
          <span>{remaining} AI generation{remaining !== 1 ? "s" : ""} remaining today (resets at midnight UTC)</span>
        </div>
      )}

      {/* Input card */}
      <div style={{ ...S.card, borderTop: `4px solid ${ACCENT}` }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#475569", marginBottom: 8 }}>Clinical Presentation</div>
        <textarea style={{ ...S.textarea, minHeight: 130 }} value={symptoms} onChange={e => setSymptoms(e.target.value)}
          placeholder={"Describe the patient and their symptoms in as much detail as you have:\n\n• Age, sex, occupation\n• Duration and onset of symptoms\n• Key psychiatric symptoms\n• Relevant history and social context\n• Any investigations done\n\ne.g. 24-year-old male, 8-month history of social withdrawal, third-person auditory hallucinations, persecutory beliefs about neighbours, self-neglect, no substance use, no mood episode..."} />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <button style={{ ...S.btn(), padding: "10px 28px", fontSize: 15 }} onClick={buildDDx} disabled={loading || symptoms.trim().length < 20}>
            {loading ? (
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>⏳</span> Analysing presentation…
              </span>
            ) : "Build Differential →"}
          </button>
          {symptoms.trim().length > 0 && symptoms.trim().length < 20 && (
            <span style={{ fontSize: 12, color: "#94a3b8" }}>Add more detail for better results</span>
          )}
          {progress.ddx.built > 0 && (
            <span style={{ fontSize: 13, color: "#64748b", marginLeft: "auto" }}>
              {progress.ddx.built} differential{progress.ddx.built !== 1 ? "s" : ""} built this session
            </span>
          )}
        </div>

        {loading && (
          <div style={{ marginTop: 16, padding: "16px 20px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 24 }}>🧠</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: ACCENT_DARK }}>Generating differential diagnosis…</div>
              <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2 }}>Analysing presentation against DSM-5 criteria. This takes 10–20 seconds.</div>
            </div>
          </div>
        )}
        {ddxResult?.error && (
          <div style={{ marginTop: 12, padding: "12px 16px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, fontSize: 13, color: "#DC2626" }}>
            <strong>⚠️ Could not generate differential.</strong> {ddxResult.error.slice(0, 300)}
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setDdxResult(null)} style={{ ...S.btn("outline"), fontSize: 12, padding: "5px 12px" }}>Try Again</button>
            </div>
          </div>
        )}
      </div>

      {/* Symptom cluster quick-select */}
      <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
        ⚡ Quick-Select Symptom Clusters
      </div>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>
        Click a symptom cluster to auto-populate the presentation field, then customise as needed.
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "1rem" }}>
        {SYMPTOM_CLUSTERS.map(cat => (
          <button key={cat.category}
            onClick={() => setActiveClusterCat(activeClusterCat === cat.category ? null : cat.category)}
            style={{ border: `1.5px solid ${activeClusterCat === cat.category ? cat.color : "#E8EEF4"}`, background: activeClusterCat === cat.category ? `${cat.color}14` : "#fff", color: activeClusterCat === cat.category ? cat.color : "#64748b", borderRadius: 99, padding: "5px 14px", cursor: "pointer", fontSize: 12.5, fontWeight: activeClusterCat === cat.category ? 700 : 400, fontFamily: "inherit", transition: "all .15s" }}>
            {cat.icon} {cat.category}
          </button>
        ))}
      </div>

      {activeClusterCat && (() => {
        const cat = SYMPTOM_CLUSTERS.find(c => c.category === activeClusterCat);
        return (
          <div style={{ ...S.card, borderTop: `3px solid ${cat.color}`, marginBottom: "1.5rem" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: cat.color, marginBottom: 10 }}>{cat.icon} {cat.category} — Select a cluster</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px,1fr))", gap: 8 }}>
              {cat.clusters.map((cl, i) => (
                <button key={i} onClick={() => { setSymptoms(cl.symptoms); setActiveClusterCat(null); }}
                  style={{ textAlign: "left", background: "#F8FAFC", border: `1px solid ${cat.color}33`, borderRadius: 9, padding: "10px 12px", cursor: "pointer", fontFamily: "inherit", transition: "all .15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${cat.color}0D`; e.currentTarget.style.borderColor = cat.color; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "#F8FAFC"; e.currentTarget.style.borderColor = `${cat.color}33`; }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: cat.color, marginBottom: 4 }}>{cl.label}</div>
                  <div style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.5 }}>{cl.symptoms.slice(0, 80)}…</div>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Organic Red Flags reference */}
      <div style={{ ...S.card, borderTop: "3px solid #DC2626" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setShowRedFlags(!showRedFlags)}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#DC2626", marginBottom: 2 }}>🚨 Organic Causes & Emergency Red Flags</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>Always exclude organic pathology before diagnosing primary psychiatric illness</div>
          </div>
          <span style={{ fontSize: 18, color: "#94a3b8" }}>{showRedFlags ? "▲" : "▼"}</span>
        </div>

        {showRedFlags && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
              {["ALL", "EMERGENCY", "URGENT", "ROUTINE"].map(u => (
                <button key={u} onClick={() => setUrgencyFilter(u)}
                  style={{ border: `1.5px solid ${urgencyFilter === u ? (u === "EMERGENCY" ? "#DC2626" : u === "URGENT" ? AMBER : u === "ROUTINE" ? TEAL : ACCENT) : "#E8EEF4"}`, background: urgencyFilter === u ? (u === "EMERGENCY" ? "#FEF2F2" : u === "URGENT" ? "#FFFBEB" : u === "ROUTINE" ? TEAL_LIGHT : ACCENT_LIGHT) : "#fff", color: urgencyFilter === u ? (u === "EMERGENCY" ? "#DC2626" : u === "URGENT" ? AMBER : u === "ROUTINE" ? TEAL : ACCENT) : "#64748b", borderRadius: 99, padding: "4px 12px", cursor: "pointer", fontSize: 12, fontWeight: urgencyFilter === u ? 700 : 400, fontFamily: "inherit" }}>
                  {u === "EMERGENCY" ? "🚨 " : u === "URGENT" ? "⚠️ " : u === "ROUTINE" ? "ℹ️ " : ""}{u}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredRedFlags.map((rf, i) => {
                const isOpen = expandedRed === i;
                const urgencyColor = rf.urgency === "EMERGENCY" ? "#DC2626" : rf.urgency === "URGENT" ? AMBER : TEAL;
                const urgencyBg = rf.urgency === "EMERGENCY" ? "#FEF2F2" : rf.urgency === "URGENT" ? "#FFFBEB" : TEAL_LIGHT;
                return (
                  <div key={i} style={{ border: `1px solid ${urgencyColor}33`, borderRadius: 10, overflow: "hidden", background: "#fff" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", background: isOpen ? urgencyBg : "#fff" }} onClick={() => setExpandedRed(isOpen ? null : i)}>
                      <span style={{ background: urgencyBg, color: urgencyColor, borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 800, letterSpacing: .5, flexShrink: 0 }}>{rf.urgency}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", flex: 1, lineHeight: 1.4 }}>{rf.flag}</span>
                      <span style={{ color: "#94a3b8", flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
                    </div>
                    {isOpen && (
                      <div style={{ padding: "10px 14px", borderTop: `1px solid ${urgencyColor}22` }}>
                        <div style={{ fontSize: 13, color: "#334155", marginBottom: 8, lineHeight: 1.7 }}>
                          <strong style={{ color: urgencyColor }}>Implication:</strong> {rf.implication}
                        </div>
                        <div style={{ fontSize: 13, color: "#15803D", background: "#F0FDF4", borderRadius: 7, padding: "6px 10px" }}>
                          <strong>Action:</strong> {rf.action}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   MCQ PRACTICE
══════════════════════════════════════════ */
const SEED_MCQS = [
  { id: 1, q: "A 45-year-old man presents with a 4-week history of low mood, anhedonia, initial insomnia, poor concentration, and passive death wishes. He denies active suicidal intent. Which diagnosis best fits?", options: ["A. Dysthymia", "B. Adjustment disorder with depressed mood", "C. Major Depressive Episode", "D. Bipolar II Disorder – depressive phase", "E. Normal bereavement"], answer: "C", explanation: "Duration ≥2 weeks + ≥5 DSM-5 symptoms including depressed mood/anhedonia = Major Depressive Episode. Dysthymia requires ≥2 years. Adjustment disorder is temporally related to a stressor. No hypomania excludes Bipolar II.", topic: "Mood Disorders" },
  { id: 2, q: "Which of the following is the MOST consistent feature of a manic episode?", options: ["A. Early morning wakening", "B. Decreased need for sleep without fatigue", "C. Hyperphagia", "D. Thought insertion", "E. Flat affect"], answer: "B", explanation: "Decreased need for sleep (not insomnia) is a hallmark of mania. Thought insertion is a first-rank symptom of schizophrenia. Flat affect is a negative symptom.", topic: "Bipolar Disorder" },
  { id: 3, q: "A 23-year-old woman believes she is being watched through her television. She reports hearing two voices discussing her actions. Symptoms have been present for 7 months. The MOST likely diagnosis is:", options: ["A. Schizophreniform disorder", "B. Brief psychotic disorder", "C. Schizoaffective disorder", "D. Schizophrenia", "E. Delusional disorder"], answer: "D", explanation: "Schizophrenia requires ≥2 symptoms for ≥6 months. 7 months meets the threshold. Schizophreniform is 1–6 months. Delusional disorder features non-bizarre delusions without prominent hallucinations.", topic: "Psychosis" },
  { id: 4, q: "Which cognitive assessment is most appropriate as a brief bedside screen for dementia?", options: ["A. WAIS-IV", "B. Mini-Mental State Examination (MMSE)", "C. PANSS", "D. Hamilton Anxiety Rating Scale", "E. PHQ-9"], answer: "B", explanation: "MMSE is a validated 30-point bedside cognitive screen. WAIS-IV is a full neuropsychological battery. PANSS assesses psychosis severity. PHQ-9 screens for depression.", topic: "Cognitive Assessment" },
];

function MCQPractice({ progress, setProgress, user }) {
  const [mcqs, setMcqs] = useState(SEED_MCQS);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [showExp, setShowExp] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [topic, setTopic]           = useState("Mood Disorders");
  const [remaining, setRemaining]   = useState(null);
  const [limitError, setLimitError] = useState("");

  async function generateMCQ() {
    if (!user) { setLimitError("Please log in to use AI features."); return; }
    setGenerating(true); setLimitError("");
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const result = await askAI(
        "mcq",
        [{ role: "user", content: `Generate a psychiatry MCQ on the topic: ${topic}` }],
        { topic },
        session
      );
      const parsedQ = safeParseJSON(result.text);
      if (parsedQ) {
        setMcqs(m => [...m, { ...parsedQ, id: Date.now() }]);
        setIdx(mcqs.length);
        setSelected(null); setShowExp(false);
      } else {
        setLimitError("Could not parse the generated question. Try again.");
      }
      if (result.remaining !== null) setRemaining(result.remaining);
    } catch (err) {
      setLimitError(err.message);
    }
    setGenerating(false);
  }

  function answer(opt) {
    if (selected) return;
    setSelected(opt);
    setShowExp(true);
    const correct = opt[0] === mcqs[idx].answer;
    setProgress(p => ({ ...p, mcq: { correct: p.mcq.correct + (correct ? 1 : 0), total: p.mcq.total + 1 } }));
  }

  const q = mcqs[idx];
  const { correct, total } = progress.mcq;
  const pct = total ? Math.round((correct / total) * 100) : 0;

  return (
    <div>
      <h2 style={S.sectionTitle}>📝 MCQ Practice</h2>
      {/* ── AI Usage Banner ── */}
      {limitError && (
        <div style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:9, padding:"10px 14px", marginBottom:"1rem", fontSize:13, color:"#DC2626", display:"flex", alignItems:"flex-start", gap:8 }}>
          <span style={{ flexShrink:0 }}>⚠️</span>
          <span>{limitError}</span>
        </div>
      )}
      {remaining !== null && remaining >= 0 && (
        <div style={{ background:"#F0F9FF", border:"1px solid #BAE6FD", borderRadius:9, padding:"8px 14px", marginBottom:"1rem", fontSize:12.5, color:"#0369A1", display:"flex", alignItems:"center", gap:8 }}>
          <span>💡</span>
          <span>{remaining} MCQ generation{remaining !== 1 ? "s" : ""} remaining today (resets at midnight UTC)</span>
        </div>
      )}
      <p style={S.sectionSub}>Board-style psychiatry questions with detailed explanations.</p>
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 18px", fontSize: 14, minWidth: 160 }}>
          Score: <strong style={{ color: pct >= 60 ? TEAL : "#DC2626" }}>{correct}/{total}</strong> {total > 0 && `(${pct}%)`}
          {total > 0 && <div style={{ marginTop: 6 }}><ProgressBar value={correct} max={total} color={pct >= 60 ? TEAL : "#DC2626"} /></div>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}>
          <select value={topic} onChange={e => setTopic(e.target.value)} style={{ ...S.input, width: "auto", flex: 1 }}>
            {["Mood Disorders", "Psychosis", "Anxiety Disorders", "Personality Disorders", "Dementia", "Child Psychiatry", "Substance Use", "Forensic Psychiatry"].map(t => <option key={t}>{t}</option>)}
          </select>
          <button style={S.btn()} onClick={generateMCQ} disabled={generating}>{generating ? "Generating…" : "AI Generate ✨"}</button>
        </div>
      </div>
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={S.badge()}>{q.topic}</span>
          <span style={{ fontSize: 13, color: "#94a3b8" }}>Q {idx + 1} / {mcqs.length}</span>
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.75, color: "#1e293b", marginBottom: "1.25rem", fontWeight: 500 }}>{q.q}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {q.options.map((opt, i) => {
            const isCorrect = opt[0] === q.answer, isSelected = selected === opt;
            let bg = "#F8FAFC", border = "#E2E8F0", color = "#1e293b";
            if (selected) { if (isCorrect) { bg = "#F0FDF4"; border = "#86EFAC"; color = "#15803D"; } else if (isSelected) { bg = "#FEF2F2"; border = "#FCA5A5"; color = "#DC2626"; } }
            return <button key={i} onClick={() => answer(opt)} style={{ background: bg, border: `1.5px solid ${border}`, borderRadius: 8, padding: "10px 14px", cursor: selected ? "default" : "pointer", textAlign: "left", fontSize: 14, color, fontFamily: "inherit", transition: "all 0.15s" }}>{opt}{selected && isCorrect && " ✓"}{selected && isSelected && !isCorrect && " ✗"}</button>;
          })}
        </div>
        {showExp && <div style={{ marginTop: "1rem", background: ACCENT_LIGHT, borderRadius: 8, padding: "12px 14px", fontSize: 13, color: ACCENT_DARK, lineHeight: 1.7, borderLeft: `4px solid ${ACCENT}` }}><strong>Explanation:</strong> {q.explanation}</div>}
        {selected && idx < mcqs.length - 1 && <button style={{ ...S.btn(), marginTop: "1rem" }} onClick={() => { setIdx(i => i + 1); setSelected(null); setShowExp(false); }}>Next Question →</button>}
        {selected && idx === mcqs.length - 1 && <div style={{ marginTop: "1rem", fontSize: 13, color: "#64748b" }}>End of question bank. Generate more above! 🎓</div>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   REFERENCE SECTION
══════════════════════════════════════════ */
const DSM5_CRITERIA = [
  { diagnosis: "Major Depressive Episode", color: ACCENT, criteria: ["Depressed mood or anhedonia (≥1 required)", "≥5 symptoms total for ≥2 weeks", "Sleep disturbance (insomnia or hypersomnia)", "Appetite/weight change (±5% in 1 month)", "Psychomotor agitation or retardation", "Fatigue or loss of energy", "Feelings of worthlessness or guilt", "Difficulty concentrating or making decisions", "Recurrent thoughts of death or suicidal ideation"] },
  { diagnosis: "Manic Episode", color: ROSE, criteria: ["Elevated, expansive, or irritable mood ≥1 week", "Increased goal-directed activity or energy", "Grandiosity or inflated self-esteem", "Decreased need for sleep (feels rested after 3h)", "More talkative / pressured speech", "Flight of ideas or racing thoughts", "Distractibility", "Impulsive, risky, or pleasurable behaviour", "Severe enough to cause impairment or need hospitalisation"] },
  { diagnosis: "Schizophrenia", color: PURPLE, criteria: ["≥2 of 5 symptoms for ≥1 month (≥1 must be A–C):", "A: Delusions", "B: Hallucinations", "C: Disorganised speech", "D: Grossly disorganised/catatonic behaviour", "E: Negative symptoms (flat affect, alogia, avolition)", "Continuous signs ≥6 months", "Social/occupational dysfunction", "Rule out schizoaffective, mood disorders, substances"] },
  { diagnosis: "Generalised Anxiety Disorder", color: TEAL, criteria: ["Excessive anxiety/worry on most days ≥6 months", "Difficulty controlling the worry", "≥3 of: restlessness, fatigue, poor concentration, irritability, muscle tension, sleep disturbance", "Clinically significant distress or impairment", "Not due to substance or medical condition"] },
];

const PSYCH_DRUGS = [
  { drug: "Fluoxetine", class: "SSRI", use: "Depression, OCD, Bulimia, Panic disorder", se: "GI upset, sexual dysfunction, insomnia, serotonin syndrome (rare)", notes: "Long half-life (2–6 days). Safe in overdose. CYP2D6 inhibitor." },
  { drug: "Sertraline", class: "SSRI", use: "Depression, PTSD, OCD, Panic disorder, Social anxiety", se: "GI upset, sexual dysfunction, QTc prolongation at high doses", notes: "First-line in post-MI patients. Relatively safe in pregnancy." },
  { drug: "Lithium", class: "Mood Stabiliser", use: "Bipolar disorder (maintenance & acute mania), Augmentation in depression", se: "Tremor, polyuria, hypothyroidism, nephrogenic DI, teratogenicity", notes: "Narrow therapeutic index: 0.6–1.2 mmol/L. Monitor renal and thyroid function. Toxicity risk with NSAIDs/dehydration." },
  { drug: "Valproate", class: "Mood Stabiliser / Anticonvulsant", use: "Bipolar disorder, Epilepsy, Migraine prophylaxis", se: "Weight gain, hair loss, hepatotoxicity, thrombocytopenia, teratogenicity", notes: "CONTRAINDICATED in women of childbearing age (neural tube defects). Monitor LFTs and FBC." },
  { drug: "Olanzapine", class: "Atypical Antipsychotic", use: "Schizophrenia, Bipolar mania, Acute agitation", se: "Weight gain (significant), metabolic syndrome, sedation, QTc prolongation", notes: "Significant metabolic risk. Monitor glucose, lipids, weight." },
  { drug: "Clozapine", class: "Atypical Antipsychotic (2nd-line)", use: "Treatment-resistant schizophrenia (≥2 failed antipsychotics)", se: "Agranulocytosis (1–2%), seizures, myocarditis, metabolic effects, hypersalivation", notes: "Mandatory FBC monitoring. Most effective antipsychotic. Reduces suicide risk in schizophrenia." },
  { drug: "Diazepam", class: "Benzodiazepine", use: "Acute anxiety, Alcohol withdrawal, Status epilepticus", se: "Sedation, respiratory depression, dependence, tolerance, falls", notes: "Long-acting. Avoid long-term use. Risk of dependence after 4 weeks." },
  { drug: "Methylphenidate", class: "Stimulant (CNS)", use: "ADHD (children and adults), Narcolepsy", se: "Appetite suppression, insomnia, tachycardia, hypertension, growth suppression (children)", notes: "Schedule II controlled substance. Monitor growth in children. Avoid in cardiac disease." },
];

const CLINICAL_SCALES = [
  { name: "PHQ-9", full: "Patient Health Questionnaire-9", use: "Depression screening & severity", scoring: "0–27: Minimal (0–4), Mild (5–9), Moderate (10–14), Moderately severe (15–19), Severe (20–27)" },
  { name: "GAD-7", full: "Generalised Anxiety Disorder-7", use: "Anxiety screening & severity", scoring: "0–21: Minimal (0–4), Mild (5–9), Moderate (10–14), Severe (15–21)" },
  { name: "MMSE", full: "Mini-Mental State Examination", use: "Cognitive screening / Dementia", scoring: "0–30: Normal ≥24, Mild impairment 18–23, Severe <18" },
  { name: "AUDIT", full: "Alcohol Use Disorders Identification Test", use: "Alcohol use screening", scoring: "0–40: Hazardous use ≥8, Harmful ≥16, Possible dependence ≥20" },
  { name: "PANSS", full: "Positive and Negative Syndrome Scale", use: "Schizophrenia severity measurement", scoring: "30–210: Positive (7–49), Negative (7–49), General (16–112)" },
  { name: "CAGE", full: "Cut-Annoyed-Guilty-Eye opener", use: "Rapid alcohol use screen", scoring: "0–4: ≥2 'yes' answers = likely alcohol problem" },
];

function Reference() {
  const [tab, setTab] = useState("dsm5");
  const [expandedDrug, setExpandedDrug] = useState(null);

  const tabs = [
    { id: "dsm5", label: "DSM-5 Criteria" },
    { id: "drugs", label: "Psychopharmacology" },
    { id: "scales", label: "Clinical Scales" },
  ];

  return (
    <div>
      <h2 style={S.sectionTitle}>📚 Clinical Reference</h2>
      <p style={S.sectionSub}>Quick-access DSM-5 criteria, drug reference, and validated clinical scales.</p>

      <div style={{ display: "flex", gap: 4, marginBottom: "1.25rem", background: "#F1F5F9", borderRadius: 10, padding: 4 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, background: tab === t.id ? "#fff" : "transparent", border: "none", borderRadius: 8, padding: "8px 0", fontSize: 13, fontWeight: tab === t.id ? 700 : 400, color: tab === t.id ? ACCENT_DARK : "#64748b", cursor: "pointer", fontFamily: "inherit", boxShadow: tab === t.id ? "0 1px 4px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "dsm5" && (
        <div>
          {DSM5_CRITERIA.map((d, i) => (
            <div key={i} style={{ ...S.card, borderLeft: `4px solid ${d.color}` }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: d.color, marginBottom: 10 }}>{d.diagnosis}</div>
              {d.criteria.map((c, j) => (
                <div key={j} style={{ fontSize: 13, color: "#334155", marginBottom: 5, display: "flex", gap: 8 }}>
                  <span style={{ color: d.color, flexShrink: 0 }}>{c.startsWith("A:") || c.startsWith("B:") || c.startsWith("C:") || c.startsWith("D:") || c.startsWith("E:") ? "→" : "•"}</span>
                  <span>{c}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === "drugs" && (
        <div>
          {PSYCH_DRUGS.map((d, i) => (
            <div key={i} style={{ ...S.card, cursor: "pointer", padding: "1rem 1.25rem" }} onClick={() => setExpandedDrug(expandedDrug === i ? null : i)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "#1e293b" }}>{d.drug}</span>
                  <span style={{ ...S.badge(), marginLeft: 8, fontSize: 11 }}>{d.class}</span>
                </div>
                <span style={{ color: "#94a3b8", fontSize: 18 }}>{expandedDrug === i ? "▲" : "▼"}</span>
              </div>
              <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}><strong style={{ color: "#475569" }}>Uses:</strong> {d.use}</div>
              {expandedDrug === i && (
                <div style={{ marginTop: 10 }}>
                  <div style={S.divider} />
                  <div style={{ fontSize: 13, color: "#334155", marginBottom: 6 }}><strong style={{ color: "#DC2626" }}>Side effects:</strong> {d.se}</div>
                  <div style={{ fontSize: 13, color: "#334155", background: ACCENT_LIGHT, padding: "8px 10px", borderRadius: 6 }}>📌 <strong>Clinical note:</strong> {d.notes}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "scales" && (
        <div>
          {CLINICAL_SCALES.map((s, i) => (
            <div key={i} style={{ ...S.card }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ background: ACCENT, color: "#fff", borderRadius: 8, padding: "4px 12px", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{s.name}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "#64748b", marginBottom: 2 }}>{s.full}</div>
                  <div style={{ fontSize: 13, color: "#334155", marginBottom: 4 }}><strong>Use:</strong> {s.use}</div>
                  <div style={{ fontSize: 12, background: TEAL_LIGHT, color: TEAL, borderRadius: 6, padding: "5px 10px" }}><strong>Scoring:</strong> {s.scoring}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════
   PROFILE SECTION
══════════════════════════════════════════ */
const ACHIEVEMENTS = [
  { id: "first_case",   label: "First Case",        icon: "🎯", desc: "Opened your first clinical case",    check: (p) => p.cases.completed.length >= 1 },
  { id: "five_cases",   label: "Case Explorer",      icon: "🔬", desc: "Completed 5 cases",                  check: (p) => p.cases.completed.length >= 5 },
  { id: "all_cases",    label: "Case Master",        icon: "🏆", desc: "Completed all 20 cases",             check: (p) => p.cases.completed.length >= 20 },
  { id: "first_mcq",    label: "First MCQ",          icon: "📝", desc: "Answered your first MCQ",            check: (p) => p.mcq.total >= 1 },
  { id: "mcq_ten",      label: "Quiz Streak",        icon: "🔥", desc: "Answered 10 MCQs",                   check: (p) => p.mcq.total >= 10 },
  { id: "mcq_ace",      label: "High Achiever",      icon: "⭐", desc: "80%+ MCQ accuracy (≥5 answered)",   check: (p) => p.mcq.total >= 5 && (p.mcq.correct/p.mcq.total) >= 0.8 },
  { id: "osce_done",    label: "OSCE Veteran",       icon: "🎭", desc: "Completed all OSCE stations",        check: (p) => p.osce.completed.length >= 3 },
  { id: "mse_all",      label: "MSE Complete",       icon: "🧠", desc: "Explored all 6 MSE domains",         check: (p) => p.mse.explored.length >= 6 },
  { id: "ddx_builder",  label: "Diagnostician",      icon: "🔍", desc: "Built 3 differentials",              check: (p) => p.ddx.built >= 3 },
];

function ProfileSection({ progress, user, onLogout }) {
  const totalMCQ = progress.mcq.total;
  const mcqPct   = totalMCQ ? Math.round((progress.mcq.correct / totalMCQ) * 100) : 0;
  const casesN   = progress.cases.completed.length;
  const totalCases = CASES.length;
  const overallPct = Math.round(((casesN / totalCases) * 40 + (progress.osce.completed.length / 5) * 20 + (progress.mse.explored.length / 6) * 20 + Math.min(totalMCQ / 20, 1) * 20));

  const earned = ACHIEVEMENTS.filter(a => a.check(progress));
  const locked = ACHIEVEMENTS.filter(a => !a.check(progress));

  const stats = [
    { label: "Cases Completed",    value: `${casesN}/${totalCases}`,            color: ACCENT,  pct: casesN/totalCases },
    { label: "MCQ Accuracy",       value: totalMCQ ? `${mcqPct}%` : "—",       color: ROSE,    pct: mcqPct/100 },
    { label: "OSCE Stations",      value: `${progress.osce.completed.length}/5`,color: PURPLE,  pct: progress.osce.completed.length/5 },
    { label: "MSE Domains",        value: `${progress.mse.explored.length}/6`,  color: TEAL,    pct: progress.mse.explored.length/6 },
    { label: "Differentials Built",value: progress.ddx.built,                  color: AMBER,   pct: Math.min(progress.ddx.built/5, 1) },
    { label: "MCQs Answered",      value: totalMCQ,                             color: "#0891B2",pct: Math.min(totalMCQ/20,1) },
  ];

  return (
    <div className="fade-in">
      <h2 style={S.sectionTitle}>👤 My Progress</h2>
      <p style={S.sectionSub}>Track your progress, achievements, and performance across all modules.</p>

      {/* User account card */}
      {user ? (
        <div style={{ ...S.card, display:"flex", alignItems:"center", gap:14, flexWrap:"wrap", padding:"1rem 1.25rem", marginBottom:"1rem", background:"#EFF6FF", border:"1px solid #BFDBFE" }}>
          <div style={{ width:44, height:44, borderRadius:"50%", background:ACCENT, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>👤</div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, fontSize:14, color:ACCENT_DARK }}>{user.email}</div>
            <div style={{ fontSize:12, color:"#64748b", marginTop:2 }}>Signed in · Progress saved to your account</div>
          </div>
          <button onClick={onLogout} style={{ ...S.btn("outline"), padding:"7px 16px", fontSize:13 }}>Sign Out</button>
        </div>
      ) : (
        <div style={{ ...S.card, background:"#FEF3C7", border:"1px solid #FDE68A", padding:"0.875rem 1.25rem", marginBottom:"1rem", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <span style={{ fontSize:18 }}>🔒</span>
          <span style={{ fontSize:13, color:"#92400E", flex:1 }}>Log in to save your progress across sessions and access your personal analytics.</span>
        </div>
      )}

      {/* Profile card */}
      <div style={{ ...S.card, background: `linear-gradient(135deg, ${ACCENT_DARK} 0%, #1E5FAD 100%)`, color: "#fff", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, flexShrink: 0, border: "3px solid rgba(255,255,255,.3)" }}>
          🩺
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 2 }}>Medical Student</div>
          <div style={{ opacity: .8, fontSize: 13, marginBottom: 8 }}>Psychiatry Clerkship · PsychAI Tutor</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span style={{ background: "rgba(255,255,255,.15)", borderRadius: 20, padding: "3px 12px", fontSize: 12 }}>🏅 {earned.length} Achievement{earned.length !== 1 ? "s" : ""}</span>
            <span style={{ background: "rgba(255,255,255,.15)", borderRadius: 20, padding: "3px 12px", fontSize: 12 }}>📊 {overallPct}% Overall Progress</span>
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>{overallPct}%</div>
          <div style={{ fontSize: 12, opacity: .75 }}>Curriculum Complete</div>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Module Performance</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {stats.map((st, i) => (
          <div key={i} style={S.card}>
            <div style={{ fontSize: 22, fontWeight: 700, color: st.color }}>{st.value}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>{st.label}</div>
            <ProgressBar value={st.pct * 100} max={100} color={st.color} height={6} />
          </div>
        ))}
      </div>

      {/* Overall */}
      <div style={{ ...S.card, marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Overall Curriculum Progress</span>
          <span style={{ fontWeight: 700, color: TEAL, fontSize: 14 }}>{overallPct}%</span>
        </div>
        <ProgressBar value={overallPct} max={100} color={TEAL} height={12} />
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>Weighted score: Cases 40% · OSCE 20% · MSE 20% · MCQ 20%</div>
      </div>

      {/* Achievements */}
      <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Achievements</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: "0.75rem" }}>
        {[...earned, ...locked].map((a) => {
          const isEarned = a.check(progress);
          return (
            <div key={a.id} style={{ ...S.card, padding: "1rem", opacity: isEarned ? 1 : 0.45, borderLeft: isEarned ? `4px solid ${TEAL}` : "1px solid #E8EEF4" }}>
              <div style={{ fontSize: 26, marginBottom: 6 }}>{a.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 13, color: isEarned ? "#1e293b" : "#94a3b8", marginBottom: 3 }}>{a.label}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>{a.desc}</div>
              {isEarned && <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: TEAL }}>✓ Earned</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════
   FEEDBACK SECTION
══════════════════════════════════════════ */

const FEEDBACK_STORAGE_KEY = "psychai_feedback_v1";

function loadFeedbacks() {
  try {
    const raw = window.__psychaiFeedback;
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveFeedbacks(list) {
  try { window.__psychaiFeedback = JSON.stringify(list); } catch {}
}

const FEATURE_RATINGS = [
  { key: "overall",      label: "Overall App Experience",       icon: "⭐", description: "How satisfied are you with PsychAI Tutor overall?" },
  { key: "usefulness",   label: "Educational Usefulness",       icon: "📚", description: "How useful is this app for your psychiatry learning?" },
  { key: "osce",         label: "OSCE Simulator Quality",       icon: "🎭", description: "How realistic and educational are the OSCE simulations?" },
  { key: "cases",        label: "Clinical Cases Quality",       icon: "🩺", description: "How helpful are the clinical case discussions?" },
  { key: "mse",          label: "MSE Trainer Quality",          icon: "🧠", description: "How effective is the MSE trainer for learning?" },
  { key: "ddx",          label: "Differential Dx Builder",      icon: "🔍", description: "How useful is the differential diagnosis tool?" },
  { key: "mcq",          label: "MCQ Practice Quality",         icon: "📝", description: "How well do the MCQs prepare you for exams?" },
  { key: "easeOfUse",    label: "Ease of Use & Navigation",     icon: "🖥️", description: "How easy is the app to navigate and use?" },
];

const IMPROVEMENT_TAGS = [
  "More clinical cases", "Harder OSCE stations", "More MCQ topics",
  "Better mobile experience", "More drug reference info", "Video explanations",
  "Peer comparison / leaderboard", "Download/export notes", "More DSM-5 criteria",
  "Faster AI responses", "Progress certificates", "Dark mode",
];

function StarRating({ value, onChange, size = 28, readonly = false }) {
  const [hovered, setHovered] = useState(0);
  const display = readonly ? value : (hovered || value);
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          onClick={() => !readonly && onChange(n)}
          onMouseEnter={() => !readonly && setHovered(n)}
          onMouseLeave={() => !readonly && setHovered(0)}
          style={{
            background: "none", border: "none", cursor: readonly ? "default" : "pointer",
            fontSize: size, lineHeight: 1, padding: 0,
            color: n <= display ? "#F59E0B" : "#D1D5DB",
            transition: "color .1s, transform .1s",
            transform: !readonly && n <= hovered ? "scale(1.2)" : "scale(1)",
          }}>
          ★
        </button>
      ))}
    </div>
  );
}

function RatingRow({ feature, value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #EEF2F7", flexWrap: "wrap" }}>
      <div style={{ fontSize: 20, width: 28, flexShrink: 0 }}>{feature.icon}</div>
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, color: "#1e293b" }}>{feature.label}</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 1 }}>{feature.description}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <StarRating value={value} onChange={onChange} size={24} />
        {value > 0 && (
          <span style={{
            fontSize: 11.5, fontWeight: 700, color: value >= 4 ? TEAL : value === 3 ? AMBER : "#DC2626",
            background: value >= 4 ? TEAL_LIGHT : value === 3 ? "#FEF3C7" : "#FEF2F2",
            borderRadius: 20, padding: "2px 8px",
          }}>
            {["", "Poor", "Fair", "Good", "Very Good", "Excellent"][value]}
          </span>
        )}
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════
   ANALYTICS DASHBOARD
══════════════════════════════════════════════════════════════ */

// ── Mini SVG chart helpers (no external deps) ──────────────────

function Sparkline({ data, color = "#1E5FAD", height = 44, width = 180 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 8) - 4;
    return `${x},${y}`;
  });
  const pathD = "M " + pts.join(" L ");
  const areaD = pathD + ` L ${width},${height} L 0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#sg-${color.replace("#","")})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length-1].split(",")[0]} cy={pts[pts.length-1].split(",")[1]} r="3.5" fill={color} />
    </svg>
  );
}

function BarChart({ data, color = "#1E5FAD", maxVal }) {
  const max = maxVal || Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80, padding: "4px 0" }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div style={{ width: "100%", height: Math.max((d.value / max) * 64, d.value > 0 ? 4 : 0), background: d.color || color, borderRadius: "4px 4px 0 0", transition: "height .4s ease", minWidth: 8 }} />
          <div style={{ fontSize: 9.5, color: "#94a3b8", textAlign: "center", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

function DonutRing({ pct, color, size = 72, stroke = 9, label, sublabel }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)", width: size, height: size }}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#EEF2F7" strokeWidth={stroke} />
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            style={{ transition: "stroke-dasharray .6s ease" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color, lineHeight: 1 }}>{pct}%</span>
        </div>
      </div>
      {label && <div style={{ fontSize: 11.5, fontWeight: 600, color: "#374151", textAlign: "center", lineHeight: 1.3 }}>{label}</div>}
      {sublabel && <div style={{ fontSize: 10.5, color: "#94a3b8", textAlign: "center" }}>{sublabel}</div>}
    </div>
  );
}

function HeatRow({ label, cells, color }) {
  const max = Math.max(...cells, 1);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
      <div style={{ width: 88, fontSize: 11, color: "#64748b", textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ display: "flex", gap: 3, flex: 1 }}>
        {cells.map((v, i) => {
          const alpha = v === 0 ? 0.07 : 0.15 + (v / max) * 0.82;
          return <div key={i} title={`${v} ${v===1?"session":"sessions"}`} style={{ flex: 1, height: 16, borderRadius: 3, background: v === 0 ? "#EEF2F7" : color, opacity: v === 0 ? 1 : alpha + 0.18, transition: "opacity .2s" }} />;
        })}
      </div>
    </div>
  );
}

// ── Mock analytics data ────────────────────────────────────────

const MOCK_WEEKLY_ACTIVITY = [2, 4, 3, 6, 5, 8, 4, 2, 5, 7, 9, 6, 4, 7, 10, 8, 5, 3, 6, 9, 11, 7, 4, 6, 8, 12, 9, 6];
const MOCK_MCQ_TREND = [40, 45, 52, 48, 60, 58, 65, 62, 70, 68, 74, 72, 78, 80, 75, 82, 85, 88, 84, 90];
const MOCK_TOPIC_DATA = [
  { label: "Psychosis",  value: 12, color: "#7C3AED" },
  { label: "Mood",      value: 19, color: "#1E5FAD" },
  { label: "Anxiety",   value: 14, color: "#0F6E56" },
  { label: "Substance", value: 8,  color: "#B45309" },
  { label: "Neurocog",  value: 6,  color: "#9D174D" },
  { label: "Eating",    value: 5,  color: "#0891B2" },
  { label: "Personality",value:9,  color: "#DC2626" },
  { label: "Trauma",    value: 11, color: "#059669" },
];
const MOCK_OSCE_SCORES = [
  { station: "Psychosis", score: 78, sessions: 3, color: "#7C3AED" },
  { station: "Depression", score: 85, sessions: 4, color: "#1E5FAD" },
  { station: "Mania", score: 72, sessions: 2, color: "#B45309" },
  { station: "OCD", score: 91, sessions: 5, color: "#0F6E56" },
  { station: "Anxiety", score: 88, sessions: 4, color: "#0891B2" },
];
const MOCK_HEAT_DATA = [
  { label: "Cases",    cells: [1,0,2,1,0,3,1, 0,1,2,0,1,2,0, 1,3,1,0,2,1,1, 1,0,1,2,3,1,0] },
  { label: "MCQ",      cells: [0,2,1,2,1,0,2, 1,2,0,3,2,1,0, 2,1,0,2,3,2,1, 0,2,1,0,1,2,1] },
  { label: "OSCE",     cells: [0,0,1,0,1,0,0, 0,0,1,0,0,1,0, 1,0,0,0,1,0,1, 0,0,0,1,0,0,1] },
  { label: "MSE",      cells: [1,0,0,1,0,0,1, 0,1,0,0,1,0,0, 0,1,0,1,0,0,1, 1,0,1,0,1,0,0] },
  { label: "DDx",      cells: [0,1,0,0,1,1,0, 1,0,0,1,0,1,0, 0,0,1,0,0,1,0, 1,0,0,1,0,1,0] },
];
const MOCK_MCQ_BY_TOPIC = [
  { topic: "Schizophrenia",  correct: 9, total: 10 },
  { topic: "Depression",     correct: 14, total: 16 },
  { topic: "Bipolar",        correct: 7, total: 10 },
  { topic: "Anxiety",        correct: 11, total: 14 },
  { topic: "OCD",            correct: 8, total: 9 },
  { topic: "Pharmacology",   correct: 12, total: 18 },
  { topic: "Neurocog",       correct: 6, total: 8 },
  { topic: "Personality",    correct: 5, total: 7 },
];
const DAYS_ABR = ["M","T","W","T","F","S","S"];
const WEEK_LABELS = Array.from({length:4},(_,i)=>`W${i+1}`);

// ── Main Dashboard ─────────────────────────────────────────────

function AnalyticsDashboard({ progress }) {
  const [tab, setTab] = useState("overview");

  // Real progress metrics
  const casesCompleted = progress.cases.completed.length;
  const totalCases = CASES.length;
  const casesPct = Math.round((casesCompleted / totalCases) * 100);
  const mcqCorrect = progress.mcq.correct;
  const mcqTotal = progress.mcq.total;
  const mcqPct = mcqTotal ? Math.round((mcqCorrect / mcqTotal) * 100) : 0;
  const osceCompleted = progress.osce.completed.length;
  const mseExplored = progress.mse.explored.length;
  const ddxBuilt = progress.ddx.built;

  // Blend real + mock for richer dashboard
  const blendedMCQPct = mcqTotal >= 5 ? mcqPct : 76; // use mock if little real data
  const blendedCasesPct = casesCompleted >= 3 ? casesPct : 62;
  const overallPct = Math.round(
    (blendedCasesPct * 0.35) +
    (Math.min(blendedMCQPct, 100) * 0.25) +
    ((osceCompleted / 5) * 100 * 0.20) +
    ((mseExplored / 6) * 100 * 0.10) +
    (Math.min(ddxBuilt / 10, 1) * 100 * 0.10)
  );

  // Streak: mock 14-day streak
  const streakDays = 14;

  const TABS = [
    { id: "overview",    label: "Overview"   },
    { id: "cases",       label: "Cases"      },
    { id: "mcq",         label: "MCQ"        },
    { id: "osce",        label: "OSCE"       },
    { id: "activity",    label: "Activity"   },
  ];

  const tabStyle = (t) => ({
    padding: "7px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
    border: "none", fontFamily: "inherit", transition: "all .15s",
    background: tab === t ? ACCENT : "transparent",
    color: tab === t ? "#fff" : "#64748b",
  });

  return (
    <div className="fade-in">
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: "1.25rem" }}>
        <div>
          <h2 style={S.sectionTitle}>📊 Learning Analytics</h2>
          <p style={{ ...S.sectionSub, marginBottom: 0 }}>Performance insights across your psychiatry clerkship • Mock data shown where activity is limited</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 10, padding: "8px 14px" }}>
          <span style={{ fontSize: 20 }}>🔥</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#92400E", lineHeight: 1 }}>{streakDays}-day streak</div>
            <div style={{ fontSize: 11, color: "#B45309" }}>Keep it up!</div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: "flex", gap: 4, background: "#F1F5F9", borderRadius: 10, padding: 4, marginBottom: "1.25rem", flexWrap: "wrap" }}>
        {TABS.map(t => <button key={t.id} style={tabStyle(t.id)} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>

      {/* ══ OVERVIEW ══ */}
      {tab === "overview" && (
        <div>
          {/* KPI row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(155px,1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
            {[
              { label: "Overall Progress",  value: `${overallPct}%`, icon: "🎓", color: ACCENT,   sub: "Weighted curriculum" },
              { label: "Cases Completed",   value: `${casesCompleted}/${totalCases}`, icon: "🩺", color: "#0F6E56", sub: `${blendedCasesPct}% complete` },
              { label: "MCQ Accuracy",      value: `${blendedMCQPct}%`, icon: "📝", color: "#7C3AED", sub: `${mcqTotal || 74} answered` },
              { label: "OSCE Stations",     value: `${osceCompleted}/5`,  icon: "🎭", color: "#B45309", sub: "Completed" },
              { label: "MSE Domains",       value: `${mseExplored}/6`,   icon: "🧠", color: "#9D174D", sub: "Explored" },
              { label: "DDx Built",         value: ddxBuilt || 8,         icon: "🔍", color: "#0891B2", sub: "Differentials" },
            ].map((k, i) => (
              <div key={i} style={{ ...S.card, padding: "1rem", marginBottom: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <span style={{ fontSize: 20 }}>{k.icon}</span>
                  <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>{k.sub}</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: k.color, lineHeight: 1, marginBottom: 2 }}>{k.value}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Donut ring row */}
          <div style={{ ...S.card, marginBottom: "1rem" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: "1rem" }}>Module Completion at a Glance</div>
            <div style={{ display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: 16 }}>
              <DonutRing pct={blendedCasesPct}   color={ACCENT}   size={80} stroke={9} label="Cases"       sublabel={`${casesCompleted}/${totalCases}`} />
              <DonutRing pct={blendedMCQPct}     color="#7C3AED"  size={80} stroke={9} label="MCQ Acc."    sublabel={`${mcqTotal||74} total`} />
              <DonutRing pct={Math.round((osceCompleted/5)*100)} color="#B45309" size={80} stroke={9} label="OSCE"  sublabel={`${osceCompleted}/5 done`} />
              <DonutRing pct={Math.round((mseExplored/6)*100)}   color="#9D174D"  size={80} stroke={9} label="MSE"       sublabel={`${mseExplored}/6 domains`} />
              <DonutRing pct={Math.min(Math.round(((ddxBuilt||8)/10)*100),100)} color="#0891B2" size={80} stroke={9} label="DDx" sublabel={`${ddxBuilt||8} built`} />
            </div>
          </div>

          {/* Weekly trend + topic bar side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
            <div style={{ ...S.card, marginBottom: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 4 }}>MCQ Accuracy Trend</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>Last 20 sessions</div>
              <Sparkline data={MOCK_MCQ_TREND} color="#7C3AED" height={52} width={220} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>4 weeks ago</span>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Today</span>
              </div>
            </div>
            <div style={{ ...S.card, marginBottom: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 4 }}>Daily Study Activity</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>Questions answered per day</div>
              <Sparkline data={MOCK_WEEKLY_ACTIVITY} color={ACCENT} height={52} width={220} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>28 days ago</span>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Today</span>
              </div>
            </div>
          </div>

          {/* Summary callout */}
          <div style={{ ...S.card, background: `linear-gradient(135deg, ${ACCENT_DARK}, #1E5FAD)`, color: "#fff", marginBottom: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>🏆 Performance Summary</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12 }}>
              {[
                { icon: "📈", text: `MCQ accuracy improved +14% over 4 weeks` },
                { icon: "⚡", text: `Strongest topic: OCD & Anxiety (91% avg)` },
                { icon: "🎯", text: `Needs attention: Substance use disorders` },
                { icon: "🔥", text: `${streakDays}-day study streak — top 15% of users` },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
                  <span style={{ fontSize: 12.5, opacity: .92, lineHeight: 1.5 }}>{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ CASES TAB ══ */}
      {tab === "cases" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
            <div style={{ ...S.card, marginBottom: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 12 }}>Cases by Category</div>
              <BarChart color={ACCENT} maxVal={4}
                data={[
                  { label: "Neurodev", value: 2, color: "#0891B2" },
                  { label: "Psychosis", value: 2, color: "#7C3AED" },
                  { label: "Bipolar", value: 2, color: "#B45309" },
                  { label: "Depressive", value: 2, color: "#1E5FAD" },
                  { label: "Anxiety", value: 2, color: "#0F6E56" },
                  { label: "OCD", value: 2, color: "#9D174D" },
                  { label: "Trauma", value: 2, color: "#059669" },
                  { label: "Eating", value: 2, color: "#DC2626" },
                ]}
              />
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>2 cases per major category</div>
            </div>
            <div style={{ ...S.card, marginBottom: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 8 }}>Completion Status</div>
              <DonutRing pct={blendedCasesPct} color={ACCENT} size={100} stroke={12} label="" />
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>✅ Completed</span>
                  <span style={{ fontWeight: 700, color: ACCENT }}>{casesCompleted} cases</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>⭕ Remaining</span>
                  <span style={{ fontWeight: 700, color: "#94a3b8" }}>{totalCases - casesCompleted} cases</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#64748b" }}>📚 Total</span>
                  <span style={{ fontWeight: 700 }}>{totalCases} cases</span>
                </div>
              </div>
            </div>
          </div>

          {/* Case list */}
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 12 }}>All Cases — Completion Status</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 6 }}>
              {CASES.map(c => {
                const done = progress.cases.completed.includes(c.id);
                const cats = { neurodev:"#0891B2", psychosis:"#7C3AED", bipolar:"#B45309", depressive:"#1E5FAD", anxiety:"#0F6E56", ocd:"#9D174D", trauma:"#059669", somatic:"#DC2626", eating:"#E11D48", disruptive:"#D97706", substance:"#78716C", neurocog:"#6366F1", personality:"#DB2777", history:"#14B8A6", mse_cases:"#8B5CF6" };
                const col = cats[c.category] || ACCENT;
                return (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: done ? "#F0FFF4" : "#F8FAFC", border: `1px solid ${done ? "#BBF7D0" : "#E8EEF4"}` }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: col, flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 12, color: done ? "#065F46" : "#64748b", fontWeight: done ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
                    <span style={{ fontSize: 13 }}>{done ? "✅" : "⭕"}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Difficulty breakdown */}
          <div style={{ ...S.card, marginBottom: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 10 }}>Difficulty Distribution</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {["Beginner","Intermediate","Advanced"].map(level => {
                const n = CASES.filter(c => c.difficulty === level).length;
                const completedN = CASES.filter(c => c.difficulty === level && progress.cases.completed.includes(c.id)).length;
                const col = level === "Beginner" ? "#0F6E56" : level === "Intermediate" ? "#B45309" : "#DC2626";
                return (
                  <div key={level} style={{ flex: 1, minWidth: 100, padding: "12px 14px", borderRadius: 10, background: "#F8FAFC", border: `1px solid #E8EEF4` }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: col }}>{completedN}/{n}</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>{level}</div>
                    <ProgressBar value={completedN} max={n} color={col} height={5} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══ MCQ TAB ══ */}
      {tab === "mcq" && (
        <div>
          {/* Headline stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
            {[
              { label: "Total Answered",  value: mcqTotal || 74,  icon: "📝", color: "#374151" },
              { label: "Correct",         value: mcqCorrect || 63,icon: "✅", color: "#0F6E56" },
              { label: "Incorrect",       value: (mcqTotal||74) - (mcqCorrect||63), icon: "❌", color: "#DC2626" },
              { label: "Accuracy",        value: `${blendedMCQPct}%`, icon: "🎯", color: "#7C3AED" },
            ].map((s, i) => (
              <div key={i} style={{ ...S.card, padding: "1rem", marginBottom: 0, textAlign: "center" }}>
                <div style={{ fontSize: 24 }}>{s.icon}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1.1 }}>{s.value}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Accuracy trend */}
          <div style={{ ...S.card, marginBottom: "1rem" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 4 }}>Accuracy Trend — Last 20 Sessions</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>Shows improvement trajectory over time</div>
            <Sparkline data={MOCK_MCQ_TREND} color="#7C3AED" height={64} width={300} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>Session 1 (40%)</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#7C3AED" }}>Latest ({MOCK_MCQ_TREND[MOCK_MCQ_TREND.length-1]}%)</span>
            </div>
          </div>

          {/* Per-topic breakdown */}
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 12 }}>Performance by Topic</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {MOCK_MCQ_BY_TOPIC.map((t, i) => {
                const pct = Math.round((t.correct / t.total) * 100);
                const col = pct >= 80 ? "#0F6E56" : pct >= 65 ? "#B45309" : "#DC2626";
                return (
                  <div key={i}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 12.5, color: "#374151", fontWeight: 500 }}>{t.topic}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: col }}>{t.correct}/{t.total} ({pct}%)</span>
                    </div>
                    <ProgressBar value={pct} max={100} color={col} height={7} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
              {[["#0F6E56","≥80% Excellent"],["#B45309","65–79% Good"],["#DC2626","<65% Review"]].map(([c,l])=>(
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#64748b" }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} />{l}
                </div>
              ))}
            </div>
          </div>

          {/* Topic bar chart */}
          <div style={{ ...S.card, marginBottom: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 4 }}>Questions Attempted by Topic</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>Distribution of practice effort</div>
            <BarChart data={MOCK_TOPIC_DATA} />
          </div>
        </div>
      )}

      {/* ══ OSCE TAB ══ */}
      {tab === "osce" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
            <div style={{ ...S.card, padding: "1rem", marginBottom: 0, textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: ACCENT }}>{osceCompleted}/5</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>Stations Completed</div>
            </div>
            <div style={{ ...S.card, padding: "1rem", marginBottom: 0, textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#0F6E56" }}>
                {MOCK_OSCE_SCORES.length > 0 ? Math.round(MOCK_OSCE_SCORES.reduce((a,s) => a + s.score, 0) / MOCK_OSCE_SCORES.length) : 0}%
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>Average Score</div>
            </div>
            <div style={{ ...S.card, padding: "1rem", marginBottom: 0, textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#B45309" }}>
                {MOCK_OSCE_SCORES.reduce((a,s) => a + s.sessions, 0)}
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>Total Attempts</div>
            </div>
            <div style={{ ...S.card, padding: "1rem", marginBottom: 0, textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#7C3AED" }}>
                {Math.max(...MOCK_OSCE_SCORES.map(s => s.score))}%
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>Best Station Score</div>
            </div>
          </div>

          {/* Per-station breakdown */}
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 12 }}>Station Performance</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {MOCK_OSCE_SCORES.map((st, i) => (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: st.color }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{st.station}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>{st.sessions} attempt{st.sessions > 1 ? "s" : ""}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: st.score >= 80 ? "#0F6E56" : "#B45309" }}>{st.score}%</span>
                      <span style={{ fontSize: 11, background: st.score >= 80 ? "#D1FAE5" : "#FEF3C7", color: st.score >= 80 ? "#065F46" : "#92400E", borderRadius: 6, padding: "2px 7px", fontWeight: 600 }}>
                        {st.score >= 80 ? "Pass" : "Near Pass"}
                      </span>
                    </div>
                  </div>
                  <ProgressBar value={st.score} max={100} color={st.color} height={8} />
                </div>
              ))}
            </div>
          </div>

          {/* Checklist coverage bar */}
          <div style={{ ...S.card, marginBottom: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 12 }}>Checklist Domain Coverage</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { domain: "History Taking",      pct: 88, color: "#1E5FAD" },
                { domain: "Risk Assessment",      pct: 75, color: "#DC2626" },
                { domain: "Mental State Exam",    pct: 82, color: "#7C3AED" },
                { domain: "Differential Diagnosis",pct: 70, color: "#B45309" },
                { domain: "Management Plan",      pct: 65, color: "#0F6E56" },
                { domain: "Communication Skills", pct: 91, color: "#0891B2" },
              ].map((d, i) => (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 12, color: "#374151" }}>{d.domain}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: d.color }}>{d.pct}%</span>
                  </div>
                  <ProgressBar value={d.pct} max={100} color={d.color} height={6} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ ACTIVITY TAB ══ */}
      {tab === "activity" && (
        <div>
          {/* Streak banner */}
          <div style={{ ...S.card, background: "linear-gradient(135deg,#92400E,#B45309)", color: "#fff", marginBottom: "1rem", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ fontSize: 48 }}>🔥</div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{streakDays}-Day Streak</div>
              <div style={{ opacity: .85, fontSize: 13, marginTop: 2 }}>You've studied every day for {streakDays} days • Current best</div>
            </div>
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div style={{ fontSize: 13, opacity: .75 }}>Longest streak</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>18 days</div>
            </div>
          </div>

          {/* Week activity grid */}
          <div style={{ ...S.card, marginBottom: "1rem" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 8 }}>4-Week Activity Heatmap</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12 }}>Study sessions per module per day</div>
            {/* Day labels */}
            <div style={{ display: "flex", gap: 6, marginBottom: 4, paddingLeft: 94 }}>
              {Array.from({length:4},(_,w)=>DAYS_ABR.map((d,di)=>(
                <div key={`${w}-${di}`} style={{ flex: 1, fontSize: 9.5, color: "#94a3b8", textAlign: "center" }}>{d}</div>
              )))}
            </div>
            {MOCK_HEAT_DATA.map((row, i) => (
              <HeatRow key={i} label={row.label} cells={row.cells} color={[ACCENT,"#7C3AED","#B45309","#9D174D","#0891B2"][i]} />
            ))}
            {/* Week labels */}
            <div style={{ display: "flex", paddingLeft: 94, marginTop: 6 }}>
              {WEEK_LABELS.map(w => <div key={w} style={{ flex: 1, fontSize: 10, color: "#94a3b8", textAlign: "center" }}>{w}</div>)}
            </div>
          </div>

          {/* Daily activity sparkline */}
          <div style={{ ...S.card, marginBottom: "1rem" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginBottom: 4 }}>Daily Study Volume</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>Total interactions per day over 4 weeks</div>
            <Sparkline data={MOCK_WEEKLY_ACTIVITY} color={ACCENT} height={72} width={300} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>4 weeks ago</span>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>Today</span>
            </div>
          </div>

          {/* Study stats summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: "0.75rem", marginBottom: 0 }}>
            {[
              { label: "Total Study Days",  value: "26",    icon: "📅", color: ACCENT  },
              { label: "Total Sessions",    value: "142",   icon: "⚡", color: "#7C3AED"},
              { label: "Avg / Day",         value: "5.5",   icon: "📊", color: "#0F6E56"},
              { label: "Best Day",          value: "12",    icon: "🏆", color: "#B45309"},
              { label: "Morning Sessions",  value: "58%",   icon: "🌅", color: "#0891B2"},
              { label: "Modules Touched",   value: "6/7",   icon: "🗂️", color: "#9D174D"},
            ].map((s,i)=>(
              <div key={i} style={{ ...S.card, padding: "1rem", marginBottom: 0 }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


function FeedbackSection({ user }) {
  const [easeOfUse,        setEaseOfUse]        = useState(0);
  const [educationalValue, setEducationalValue]  = useState(0);
  const [osceUsefulness,   setOsceUsefulness]   = useState(0);
  const [caseRealism,      setCaseRealism]       = useState(0);
  const [mostUseful,       setMostUseful]        = useState("");
  const [likedMost,        setLikedMost]         = useState("");
  const [suggestions,      setSuggestions]       = useState("");
  const [recommend,        setRecommend]         = useState("");
  const [submitted,        setSubmitted]         = useState(false);
  const [submitting,       setSubmitting]        = useState(false);
  const [error,            setError]             = useState("");

  const SECTIONS = ["Clinical Cases","OSCE Simulator","MSE Trainer","DDx Builder","MCQ Practice","Reference","Analytics Dashboard","About"];

  // ── Inline star picker ──────────────────────────────────────
  function StarPick({ value, onChange, label, required }) {
    return (
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:13, fontWeight:600, color:"#374151", marginBottom:5 }}>
          {label}{required && <span style={{ color:"#DC2626" }}> *</span>}
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {[1,2,3,4,5].map(n => (
            <button key={n} onClick={() => onChange(n)} style={{
              width:38, height:38, borderRadius:8,
              border:`2px solid ${n<=value?"#F59E0B":"#E8EEF4"}`,
              background: n<=value?"#FEF3C7":"#fff",
              fontSize:18, cursor:"pointer", transition:"all .12s",
              display:"flex", alignItems:"center", justifyContent:"center"
            }}>⭐</button>
          ))}
          {value > 0 && (
            <span style={{ fontSize:12, color:"#94a3b8", alignSelf:"center", marginLeft:4 }}>
              {["","Poor","Fair","Good","Very Good","Excellent"][value]}
            </span>
          )}
        </div>
      </div>
    );
  }

  async function handleSubmit() {
    setError("");

    // ── Step 1: Verify user is authenticated via Supabase ────
    const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authUser) {
      setError("Please log in to submit feedback.");
      return;
    }

    // ── Step 2: Validate required ratings ────────────────────
    if (!easeOfUse || !educationalValue) {
      setError("Please rate Ease of Use and Educational Value before submitting.");
      return;
    }

    setSubmitting(true);

    // ── Step 3: Build payload with explicit integer casting ───
    const payload = {
      user_id:             authUser.id,
      ease_of_use:         parseInt(easeOfUse,        10),
      educational_value:   parseInt(educationalValue,  10),
      osce_usefulness:     osceUsefulness  ? parseInt(osceUsefulness,  10) : null,
      case_realism:        caseRealism     ? parseInt(caseRealism,     10) : null,
      most_useful_section: mostUseful      || null,
      liked_most:          likedMost       || null,
      suggestions:         suggestions     || null,
      recommend:           recommend       || null,
    };

    // ── Step 4: Insert into Supabase ─────────────────────────
    const { error: sbErr } = await supabase
      .from("app_feedback")
      .insert(payload);

    setSubmitting(false);

    if (sbErr) {
      console.error("Feedback save error:", sbErr);
      setError(`Could not save feedback: ${sbErr.message}`);
      return;
    }

    setSubmitted(true);
  }

  function reset() {
    setEaseOfUse(0); setEducationalValue(0);
    setOsceUsefulness(0); setCaseRealism(0);
    setMostUseful(""); setLikedMost("");
    setSuggestions(""); setRecommend("");
    setSubmitted(false); setError("");
  }

  /* ── SUCCESS VIEW ── */
  if (submitted) {
    return (
      <div className="fade-in">
        <div style={{ ...S.card, textAlign:"center", padding:"3rem 2rem", borderTop:`4px solid ${TEAL}` }}>
          <div style={{ fontSize:56, marginBottom:16 }}>🎉</div>
          <h2 style={{ ...S.sectionTitle, textAlign:"center", marginBottom:8 }}>Thank you for your feedback!</h2>
          <p style={{ fontSize:14, color:"#64748b", lineHeight:1.7, maxWidth:440, margin:"0 auto 1.5rem" }}>
            Your response has been saved to your account and will help us improve PsychAI Tutor for all medical students.
          </p>
          <div style={{ display:"flex", gap:12, justifyContent:"center", flexWrap:"wrap", marginBottom:"1.5rem" }}>
            <div style={{ background:TEAL_LIGHT, borderRadius:12, padding:"12px 20px", textAlign:"center" }}>
              <div style={{ fontWeight:700, color:TEAL, fontSize:22 }}>{educationalValue}/5</div>
              <div style={{ fontSize:12, color:"#475569" }}>Educational value</div>
            </div>
            <div style={{ background:ACCENT_LIGHT, borderRadius:12, padding:"12px 20px", textAlign:"center" }}>
              <div style={{ fontWeight:700, color:ACCENT, fontSize:22 }}>{easeOfUse}/5</div>
              <div style={{ fontSize:12, color:"#475569" }}>Ease of use</div>
            </div>
          </div>
          <button onClick={reset} style={{ ...S.btn("outline") }}>Submit Another Response</button>
        </div>
      </div>
    );
  }

  /* ── LOGIN GATE ── */
  if (!user) {
    return (
      <div className="fade-in">
        <h2 style={S.sectionTitle}>⭐ Share Feedback</h2>
        <p style={S.sectionSub}>Help us improve PsychAI Tutor for all medical students.</p>
        <div style={{ ...S.card, textAlign:"center", padding:"2.5rem 2rem", borderTop:`4px solid ${AMBER}` }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🔒</div>
          <div style={{ fontWeight:700, fontSize:16, color:"#1e293b", marginBottom:8 }}>Login Required</div>
          <p style={{ fontSize:14, color:"#64748b", lineHeight:1.7, maxWidth:380, margin:"0 auto 1.5rem" }}>
            Please log in to submit feedback. This ensures your response is linked to your account and prevents duplicate submissions.
          </p>
          <div style={{ fontSize:13, color:"#92400E", background:"#FEF3C7", border:"1px solid #FDE68A", borderRadius:9, padding:"10px 16px", display:"inline-block" }}>
            Please log in to submit feedback.
          </div>
        </div>
      </div>
    );
  }

  /* ── FORM VIEW ── */
  return (
    <div className="fade-in">
      <h2 style={S.sectionTitle}>⭐ Share Feedback</h2>
      <p style={S.sectionSub}>Help us improve PsychAI Tutor. Your feedback is saved directly to our database.</p>

      {/* Logged-in badge */}
      <div style={{ ...S.card, background:"#F0FFF4", border:"1px solid #BBF7D0", padding:"0.75rem 1.25rem", marginBottom:"1rem", display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:16 }}>✅</span>
        <span style={{ fontSize:13, color:"#065F46" }}>
          Submitting as <strong>{user.email}</strong>
        </span>
      </div>

      {/* ── Ratings ── */}
      <div style={{ ...S.card }}>
        <div style={{ fontWeight:700, fontSize:14, color:"#1e293b", marginBottom:16 }}>Ratings</div>
        <StarPick value={easeOfUse}        onChange={setEaseOfUse}        label="Ease of Use"              required />
        <StarPick value={educationalValue} onChange={setEducationalValue} label="Educational Value"        required />
        <StarPick value={osceUsefulness}   onChange={setOsceUsefulness}   label="OSCE Simulator Usefulness" />
        <StarPick value={caseRealism}      onChange={setCaseRealism}      label="Case Realism" />
      </div>

      {/* ── Most useful section ── */}
      <div style={{ ...S.card }}>
        <div style={{ fontWeight:600, fontSize:14, color:"#1e293b", marginBottom:10 }}>Most Useful Section</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
          {SECTIONS.map(s => (
            <button key={s} onClick={() => setMostUseful(s === mostUseful ? "" : s)}
              style={{ border:`1.5px solid ${s===mostUseful?ACCENT:"#E8EEF4"}`,
                background:s===mostUseful?ACCENT_LIGHT:"#fff",
                color:s===mostUseful?ACCENT_DARK:"#64748b",
                borderRadius:99, padding:"5px 13px", cursor:"pointer",
                fontSize:12.5, fontWeight:s===mostUseful?700:400,
                fontFamily:"inherit", transition:"all .15s" }}>
              {s===mostUseful?"✓ ":""}{s}
            </button>
          ))}
        </div>
      </div>

      {/* ── Liked most ── */}
      <div style={{ ...S.card }}>
        <label style={{ fontWeight:600, fontSize:14, color:"#1e293b", display:"block", marginBottom:8 }}>
          What did you like most?
        </label>
        <textarea style={{ ...S.textarea, minHeight:80 }} value={likedMost}
          onChange={e => setLikedMost(e.target.value)}
          placeholder="e.g. The OSCE simulator is incredibly realistic and great for exam prep…" />
      </div>

      {/* ── Suggestions ── */}
      <div style={{ ...S.card }}>
        <label style={{ fontWeight:600, fontSize:14, color:"#1e293b", display:"block", marginBottom:8 }}>
          Suggestions for improvement
        </label>
        <textarea style={{ ...S.textarea, minHeight:80 }} value={suggestions}
          onChange={e => setSuggestions(e.target.value)}
          placeholder="e.g. More advanced cases, video explanations, a revision mode…" />
      </div>

      {/* ── Recommend ── */}
      <div style={{ ...S.card }}>
        <div style={{ fontWeight:600, fontSize:14, color:"#1e293b", marginBottom:12 }}>
          Would you recommend PsychAI Tutor?
        </div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          {[
            { val:"yes",      label:"👍 Yes, definitely", bg:TEAL_LIGHT, color:TEAL       },
            { val:"probably", label:"🤔 Probably",         bg:"#FEF3C7",  color:AMBER      },
            { val:"unsure",   label:"😐 Not sure",         bg:"#F1F5F9",  color:"#64748b"  },
            { val:"no",       label:"👎 Probably not",     bg:"#FEF2F2",  color:"#DC2626"  },
          ].map(opt => (
            <button key={opt.val} onClick={() => setRecommend(opt.val === recommend ? "" : opt.val)}
              style={{ flex:1, minWidth:130, padding:"10px 14px", borderRadius:10,
                border:`2px solid ${recommend===opt.val?opt.color:"#E8EEF4"}`,
                background:recommend===opt.val?opt.bg:"#fff",
                color:recommend===opt.val?opt.color:"#64748b",
                cursor:"pointer", fontFamily:"inherit", fontSize:13,
                fontWeight:recommend===opt.val?700:400, transition:"all .15s" }}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:9,
          padding:"10px 14px", marginBottom:"1rem", fontSize:13, color:"#DC2626" }}>
          ⚠️ {error}
        </div>
      )}

      {/* ── Submit ── */}
      <div style={{ ...S.card,
        background:(easeOfUse&&educationalValue)?ACCENT_LIGHT:"#F8FAFC",
        border:`1px solid ${(easeOfUse&&educationalValue)?"#BFDBFE":"#E8EEF4"}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, fontSize:14, color:"#1e293b", marginBottom:3 }}>Ready to submit?</div>
            <div style={{ fontSize:13, color:"#64748b" }}>
              {(!easeOfUse||!educationalValue)
                ? "Please rate Ease of Use and Educational Value to submit."
                : "Your feedback will be saved to your account in Supabase."}
            </div>
          </div>
          <button onClick={handleSubmit}
            disabled={!easeOfUse||!educationalValue||submitting}
            style={{ ...S.btn(), padding:"11px 28px", fontSize:15,
              opacity:(!easeOfUse||!educationalValue)?0.45:1,
              background:(easeOfUse&&educationalValue)?TEAL:"#94a3b8" }}>
            {submitting ? "Saving…" : "Submit Feedback ✓"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FeedbackHistory({ entries, onClear }) {
  const allAvgs = entries.map(e => e.avgRating).filter(v => v > 0);
  const globalAvg = allAvgs.length ? (allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length).toFixed(1) : "—";

  const tagFrequency = {};
  entries.forEach(e => (e.selectedTags || []).forEach(t => { tagFrequency[t] = (tagFrequency[t] || 0) + 1; }));
  const topTags = Object.entries(tagFrequency).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const featureAvgs = FEATURE_RATINGS.map(f => {
    const vals = entries.map(e => e.ratings?.[f.key]).filter(v => v > 0);
    return { ...f, avg: vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null };
  });

  return (
    <div style={{ marginTop: 16 }}>
      <div style={S.divider} />

      {/* Aggregate summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: "0.75rem", marginBottom: "1.25rem" }}>
        <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "0.875rem 1rem", textAlign: "center" }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: TEAL }}>{globalAvg}</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>Avg overall rating</div>
          <StarRating value={Math.round(globalAvg)} readonly size={16} />
        </div>
        <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "0.875rem 1rem", textAlign: "center" }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: ACCENT }}>{entries.length}</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>Responses stored</div>
        </div>
        {entries.filter(e => e.wouldRecommend === "yes").length > 0 && (
          <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "0.875rem 1rem", textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: PURPLE }}>
              {Math.round((entries.filter(e => e.wouldRecommend === "yes").length / entries.length) * 100)}%
            </div>
            <div style={{ fontSize: 11, color: "#64748b" }}>Would recommend</div>
          </div>
        )}
      </div>

      {/* Per-feature averages */}
      <div style={{ marginBottom: "1.25rem" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Average Feature Ratings</div>
        {featureAvgs.filter(f => f.avg !== null).map(f => (
          <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 15, width: 20 }}>{f.icon}</span>
            <span style={{ fontSize: 12.5, color: "#475569", flex: 1 }}>{f.label}</span>
            <div style={{ width: 120 }}>
              <ProgressBar value={parseFloat(f.avg)} max={5} color={parseFloat(f.avg) >= 4 ? TEAL : parseFloat(f.avg) >= 3 ? AMBER : "#DC2626"} height={6} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", width: 28, textAlign: "right" }}>{f.avg}</span>
          </div>
        ))}
      </div>

      {/* Top improvement tags */}
      {topTags.length > 0 && (
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Top Requested Improvements</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {topTags.map(([tag, count]) => (
              <span key={tag} style={{ background: ACCENT_LIGHT, color: ACCENT_DARK, borderRadius: 99, padding: "4px 12px", fontSize: 12, fontWeight: 600 }}>
                {tag} <span style={{ opacity: .6 }}>×{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Individual entries */}
      <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Individual Responses</div>
      {entries.map((entry, i) => (
        <div key={entry.id} style={{ ...S.card, padding: "0.875rem 1.125rem", marginBottom: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#1e293b" }}>
                Response #{entries.length - i} · {entry.date} at {entry.time}
              </div>
              {entry.role && (
                <div style={{ fontSize: 12, color: "#64748b" }}>{entry.role || ""}</div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StarRating value={entry.ratings?.overall || 0} readonly size={16} />
              <span style={{ fontSize: 13, fontWeight: 700, color: entry.avgRating >= 4 ? TEAL : entry.avgRating >= 3 ? AMBER : "#DC2626" }}>
                {entry.avgRating}/5
              </span>
            </div>
          </div>
          {entry.wouldRecommend && (
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>
              Recommend: <strong style={{ color: entry.wouldRecommend === "yes" ? TEAL : entry.wouldRecommend === "no" ? "#DC2626" : AMBER }}>
                {entry.wouldRecommend === "yes" ? "👍 Yes" : entry.wouldRecommend === "no" ? "👎 No" : entry.wouldRecommend === "maybe" ? "🤔 Probably yes" : "😐 Not sure"}
              </strong>
            </div>
          )}
          {entry.selectedTags?.length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
              {entry.selectedTags.map(t => (
                <span key={t} style={{ background: "#F1F5F9", color: "#475569", borderRadius: 99, padding: "2px 9px", fontSize: 11 }}>{t}</span>
              ))}
            </div>
          )}
          {entry.freeText && (
            <div style={{ fontSize: 13, color: "#334155", background: "#F8FAFC", borderRadius: 7, padding: "8px 10px", fontStyle: "italic", lineHeight: 1.65 }}>
              "{entry.freeText}"
            </div>
          )}
        </div>
      ))}

      <button onClick={onClear}
        style={{ ...S.btn("ghost"), fontSize: 12, color: "#DC2626", marginTop: 4 }}>
        🗑 Clear all stored feedback
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════
   GLOBAL SEARCH OVERLAY
══════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════
   AUTH MODAL — Login / Sign Up
══════════════════════════════════════════════════════════════════ */
function AuthModal({ view, setView, onSuccess }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [message, setMessage]   = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError(""); setMessage("");
    if (view === "signup") {
      const { error: err } = await supabase.auth.signUp({ email, password });
      if (err) { setError(err.message); }
      else { setMessage("Account created! Check your email to confirm, then log in."); }
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) { setError(err.message); }
      else { onSuccess(); }
    }
    setLoading(false);
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(15,30,60,.55)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:"1rem" }}>
      <div className="fade-in" style={{ background:"#fff", borderRadius:18, padding:"2.5rem 2rem", width:"100%", maxWidth:420, boxShadow:"0 24px 80px rgba(0,0,0,.22)" }}>
        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:"1.75rem" }}>
          <div style={{ fontSize:36, marginBottom:8 }}>🩺</div>
          <div style={{ fontFamily:"Georgia,serif", fontSize:22, fontWeight:700, color:ACCENT_DARK }}>
            <span style={{ color:ACCENT }}>Psych</span>AI Tutor
          </div>
          <div style={{ fontSize:14, color:"#64748b", marginTop:6 }}>
            {view === "signup" ? "Create your free account" : "Welcome back"}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:12, fontWeight:600, color:"#374151", display:"block", marginBottom:5 }}>Email address</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              style={{ ...S.input, width:"100%" }} placeholder="you@university.edu" />
          </div>
          <div style={{ marginBottom:20 }}>
            <label style={{ fontSize:12, fontWeight:600, color:"#374151", display:"block", marginBottom:5 }}>Password {view==="signup" && <span style={{ color:"#94a3b8", fontWeight:400 }}>(min. 6 characters)</span>}</label>
            <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
              style={{ ...S.input, width:"100%" }} placeholder="••••••••" />
          </div>

          {error   && <div style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:8, padding:"9px 12px", fontSize:13, color:"#DC2626", marginBottom:14 }}>⚠️ {error}</div>}
          {message && <div style={{ background:"#F0FFF4", border:"1px solid #BBF7D0", borderRadius:8, padding:"9px 12px", fontSize:13, color:"#065F46", marginBottom:14 }}>✅ {message}</div>}

          <button type="submit" disabled={loading}
            style={{ ...S.btn(), width:"100%", padding:"13px", fontSize:15, justifyContent:"center", background:loading?"#94a3b8":ACCENT }}>
            {loading ? "Please wait…" : view === "signup" ? "Create Account" : "Log In"}
          </button>
        </form>

        {/* Toggle */}
        <div style={{ textAlign:"center", marginTop:18, fontSize:13, color:"#64748b" }}>
          {view === "signup" ? (
            <>Already have an account? <button onClick={() => { setView("login"); setError(""); setMessage(""); }} style={{ background:"none", border:"none", color:ACCENT, fontWeight:700, cursor:"pointer", fontFamily:"inherit", fontSize:13 }}>Log In</button></>
          ) : (
            <>Don't have an account? <button onClick={() => { setView("signup"); setError(""); setMessage(""); }} style={{ background:"none", border:"none", color:ACCENT, fontWeight:700, cursor:"pointer", fontFamily:"inherit", fontSize:13 }}>Sign Up</button></>
          )}
        </div>

        {/* Guest option */}
        <div style={{ textAlign:"center", marginTop:10 }}>
          <button onClick={onSuccess} style={{ background:"none", border:"none", color:"#94a3b8", cursor:"pointer", fontFamily:"inherit", fontSize:12 }}>
            Continue without account →
          </button>
        </div>
      </div>
    </div>
  );
}

function SearchOverlay({ query, setQuery, onClose, setSection }) {
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const ALL_TOPICS = [
    { title: "Major Depressive Disorder",         section: "cases",   hint: "Depressive Disorders" },
    { title: "Bipolar I Disorder — Manic Episode", section: "cases",   hint: "Bipolar & Related" },
    { title: "Schizophrenia",                      section: "cases",   hint: "Psychosis Spectrum" },
    { title: "PTSD",                               section: "cases",   hint: "Trauma & Stressor" },
    { title: "OCD",                                section: "cases",   hint: "OCD & Related" },
    { title: "Anorexia Nervosa",                   section: "cases",   hint: "Eating Disorders" },
    { title: "Alcohol Withdrawal",                 section: "cases",   hint: "Substance Use" },
    { title: "Borderline Personality Disorder",    section: "cases",   hint: "Personality Disorders" },
    { title: "Alzheimer's Disease",                section: "cases",   hint: "Neurocognitive" },
    { title: "ADHD",                               section: "cases",   hint: "Neurodevelopmental" },
    { title: "ASD",                                section: "cases",   hint: "Neurodevelopmental" },
    { title: "DSM-5 Criteria",                     section: "ref",     hint: "Reference → DSM-5" },
    { title: "Psychopharmacology",                 section: "ref",     hint: "Reference → Drugs" },
    { title: "Clinical Scales (PHQ-9, GAD-7…)",   section: "ref",     hint: "Reference → Scales" },
    { title: "Suicidal Ideation OSCE",             section: "osce",    hint: "OSCE Simulator" },
    { title: "MSE — Thought Form & Content",       section: "mse",     hint: "MSE Trainer" },
    { title: "MCQ — Mood Disorders",               section: "mcq",     hint: "MCQ Practice" },
    { title: "MCQ — Psychosis",                    section: "mcq",     hint: "MCQ Practice" },
    { title: "Differential Diagnosis Builder",     section: "ddx",     hint: "DDx Builder" },
    { title: "My Progress & Achievements",         section: "profile",  hint: "Profile" },
    { title: "Submit Feedback / Rate the App",       section: "feedback", hint: "Feedback" },
    { title: "Feature Ratings & Suggestions",        section: "feedback", hint: "Feedback" },
    ...CASES.map(c => ({ title: c.title, section: "cases", hint: CASE_CATEGORIES.find(cat => cat.id === c.category)?.label || "" })),
  ];

  const results = query.length > 1
    ? ALL_TOPICS.filter(t => t.title.toLowerCase().includes(query.toLowerCase()) || t.hint.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : ALL_TOPICS.slice(0, 6);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 60 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "min(520px,92vw)", boxShadow: "0 24px 60px rgba(0,0,0,.25)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid #EEF2F7", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🔍</span>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search psychiatry topics, cases, drugs…" style={{ flex: 1, border: "none", outline: "none", fontSize: 15, fontFamily: "inherit", background: "transparent" }} />
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#94a3b8" }}>✕</button>
        </div>
        <div style={{ maxHeight: 360, overflowY: "auto" }}>
          {!query && <div style={{ padding: "8px 16px 4px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1 }}>Quick Access</div>}
          {results.map((r, i) => (
            <button key={i} onClick={() => { setSection(r.section); onClose(); setQuery(""); }}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left", borderBottom: "1px solid #F8FAFC", fontFamily: "inherit" }}
              onMouseEnter={e => e.currentTarget.style.background = "#F8FAFF"}
              onMouseLeave={e => e.currentTarget.style.background = "none"}>
              <span style={{ fontSize: 16 }}>{NAV_ITEMS.find(n => n.id === r.section)?.icon || "📌"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "#1e293b" }}>{r.title}</div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>{r.hint}</div>
              </div>
              <span style={{ fontSize: 12, color: "#C7D2E0" }}>→</span>
            </button>
          ))}
          {query && results.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>No results for "{query}"</div>}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   SIDEBAR + BOTTOM NAV + APP SHELL
══════════════════════════════════════════ */
function Sidebar({ section, setSection, progress, user, onLogin, onSignup, onLogout }) {
  const totalMCQ = progress.mcq.total;
  const overallPct = Math.round(
    ((progress.cases.completed.length / CASES.length) * 40) +
    ((progress.osce.completed.length / 5) * 20) +
    ((progress.mse.explored.length / 6) * 20) +
    (Math.min(totalMCQ / 20, 1) * 20)
  );

  return (
    <aside className="sidebar" style={{ position:"fixed", top:0, left:0, bottom:0, width:SIDEBAR_W, background:ACCENT_DARK, display:"flex", flexDirection:"column", zIndex:200, overflowY:"auto" }}>
      {/* Logo */}
      <div style={{ padding:"22px 20px 18px", borderBottom:"1px solid rgba(255,255,255,.1)" }}>
        <div style={{ fontFamily:"Georgia,serif", fontWeight:700, fontSize:18, color:"#fff", letterSpacing:.3 }}>
          <span style={{ color:"#7EC8E3" }}>Psych</span>AI Tutor
        </div>
        <div style={{ fontSize:11, color:"rgba(255,255,255,.5)", marginTop:2, letterSpacing:.5 }}>PSYCHIATRY CLERKSHIP</div>
      </div>

      {/* User badge */}
      {user ? (
        <div style={{ padding:"10px 14px 8px", borderBottom:"1px solid rgba(255,255,255,.08)" }}>
          <div style={{ fontSize:11, color:"rgba(255,255,255,.5)", marginBottom:3 }}>Signed in as</div>
          <div style={{ fontSize:12.5, color:"#fff", fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.email}</div>
        </div>
      ) : (
        <div style={{ padding:"10px 12px 8px", borderBottom:"1px solid rgba(255,255,255,.08)", display:"flex", gap:6 }}>
          <button onClick={onLogin}  style={{ flex:1, background:"rgba(255,255,255,.12)", border:"1px solid rgba(255,255,255,.2)", borderRadius:7, color:"#fff", fontFamily:"inherit", fontSize:12, fontWeight:600, padding:"7px 0", cursor:"pointer" }}>Log In</button>
          <button onClick={onSignup} style={{ flex:1, background:"#7EC8E3", border:"none", borderRadius:7, color:ACCENT_DARK, fontFamily:"inherit", fontSize:12, fontWeight:700, padding:"7px 0", cursor:"pointer" }}>Sign Up</button>
        </div>
      )}

      {/* Nav */}
      <nav style={{ flex:1, padding:"10px 10px" }}>
        {NAV_ITEMS.map(item => {
          const active = section === item.id;
          return (
            <button key={item.id} className={`nav-item${active?" active":""}`} onClick={() => setSection(item.id)}
              style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"9px 12px", background:active?"rgba(255,255,255,.16)":"transparent", border:"none", borderRadius:9, cursor:"pointer", textAlign:"left", marginBottom:2, color:active?"#fff":"rgba(255,255,255,.65)", fontFamily:"inherit", fontSize:13.5, fontWeight:active?600:400, transition:"all .15s" }}>
              <span style={{ fontSize:16, width:20, textAlign:"center" }}>{item.icon}</span>
              <span style={{ flex:1 }}>{item.label}</span>
              {active && <span style={{ width:6, height:6, borderRadius:"50%", background:"#7EC8E3", flexShrink:0 }} />}
            </button>
          );
        })}
      </nav>

      {/* Feedback button */}
      <div style={{ padding:"10px 12px 0" }}>
        <button onClick={() => setSection("feedback")}
          style={{ display:"flex", alignItems:"center", gap:9, width:"100%", background:"rgba(255,255,255,.1)", border:"1px solid rgba(255,255,255,.18)", borderRadius:9, padding:"9px 12px", color:"rgba(255,255,255,.85)", fontFamily:"inherit", fontSize:13, fontWeight:500, cursor:"pointer", transition:"background .15s" }}>
          <span style={{ fontSize:16 }}>📝</span>
          <span style={{ flex:1 }}>Provide Feedback</span>
        </button>
      </div>

      {/* Progress + logout */}
      <div style={{ padding:"14px 14px 20px", borderTop:"1px solid rgba(255,255,255,.1)" }}>
        <div style={{ fontSize:11, color:"rgba(255,255,255,.5)", marginBottom:6, letterSpacing:.5, textTransform:"uppercase" }}>Overall Progress</div>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
          <div style={{ flex:1, background:"rgba(255,255,255,.15)", borderRadius:99, height:6, overflow:"hidden" }}>
            <div style={{ width:`${overallPct}%`, background:"#7EC8E3", height:"100%", borderRadius:99, transition:"width .5s ease" }} />
          </div>
          <span style={{ fontSize:12, color:"#7EC8E3", fontWeight:700 }}>{overallPct}%</span>
        </div>
        <div style={{ fontSize:11, color:"rgba(255,255,255,.4)", marginBottom: user ? 10 : 0 }}>{progress.cases.completed.length}/{CASES.length} cases · {progress.mcq.total} MCQs</div>
        {user && (
          <button onClick={onLogout} style={{ width:"100%", background:"rgba(255,255,255,.08)", border:"1px solid rgba(255,255,255,.12)", borderRadius:7, color:"rgba(255,255,255,.6)", fontFamily:"inherit", fontSize:11.5, padding:"6px 0", cursor:"pointer", marginTop:4 }}>
            Sign Out
          </button>
        )}
      </div>
    </aside>
  );
}

function BottomNav({ section, setSection }) {
  const items = NAV_ITEMS.slice(0, 8);
  return (
    <nav className="bottom-nav" style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: "1px solid #E8EEF4", display: "flex", zIndex: 300, boxShadow: "0 -4px 20px rgba(0,0,0,.08)" }}>
      {items.map(item => {
        const active = section === item.id;
        return (
          <button key={item.id} onClick={() => setSection(item.id)}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "8px 2px", background: "none", border: "none", cursor: "pointer", color: active ? ACCENT : "#94a3b8", fontFamily: "inherit", gap: 2 }}>
            <span style={{ fontSize: 20 }}>{item.icon}</span>
            <span style={{ fontSize: 9.5, fontWeight: active ? 700 : 400, letterSpacing: .2 }}>{item.shortLabel}</span>
            {active && <span style={{ width: 18, height: 3, borderRadius: 99, background: ACCENT, marginTop: 1 }} />}
          </button>
        );
      })}
      {/* Feedback in-app tab */}
      <button
        onClick={() => setSection("feedback")}
        style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "8px 2px", background: "none", border: "none", cursor: "pointer", color: section === "feedback" ? ACCENT : "#94a3b8", fontFamily: "inherit", gap: 2 }}
      >
        <span style={{ fontSize: 20 }}>📝</span>
        <span style={{ fontSize: 9.5, letterSpacing: .2 }}>Feedback</span>
        {section === "feedback" && <span style={{ width: 18, height: 3, borderRadius: 99, background: ACCENT, marginTop: 1 }} />}
      </button>
    </nav>
  );
}

function TopBar({ setSearchOpen, section, setSection, user, onLogin, onLogout }) {
  const current = NAV_ITEMS.find(n => n.id === section);
  return (
    <header style={{ height:56, background:"#fff", borderBottom:"1px solid #E8EEF4", display:"flex", alignItems:"center", padding:"0 1.25rem", gap:12, position:"sticky", top:0, zIndex:150, boxShadow:"0 1px 4px rgba(0,0,0,.04)" }}>
      <span style={{ fontSize:20 }}>{current?.icon}</span>
      <span style={{ fontWeight:700, fontSize:16, color:ACCENT_DARK, flex:1, fontFamily:"Georgia,serif" }}>{current?.label}</span>
      <button onClick={() => setSearchOpen(true)} style={{ display:"flex", alignItems:"center", gap:8, background:"#F0F4F8", border:"1px solid #E8EEF4", borderRadius:9, padding:"7px 14px", cursor:"pointer", color:"#64748b", fontSize:13, fontFamily:"inherit" }}>
        🔍 <span className="hide-mobile">Search topics, cases, drugs…</span>
        <span style={{ background:"#E8EEF4", borderRadius:5, padding:"1px 6px", fontSize:11, color:"#94a3b8" }}>⌘K</span>
      </button>
      {user ? (
        <button onClick={onLogout} style={{ display:"flex", alignItems:"center", gap:6, background:"#F1F5F9", border:"1px solid #E8EEF4", borderRadius:8, padding:"6px 12px", cursor:"pointer", color:"#64748b", fontSize:12, fontFamily:"inherit" }}>
          <span>👤</span><span className="hide-mobile" style={{ maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.email}</span><span style={{ fontSize:10, color:"#94a3b8" }}>Sign out</span>
        </button>
      ) : (
        <button onClick={onLogin} style={{ display:"flex", alignItems:"center", gap:6, background:ACCENT, border:"none", borderRadius:8, padding:"7px 14px", cursor:"pointer", color:"#fff", fontSize:13, fontWeight:600, fontFamily:"inherit" }}>
          Log In
        </button>
      )}
    </header>
  );
}


/* ══════════════════════════════════════════
   ABOUT PAGE
══════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════
   PRIVACY POLICY PAGE
══════════════════════════════════════════════════════════════════ */
function PrivacyPolicy({ setSection }) {
  const Section = ({ icon, title, children }) => (
    <div style={{ marginBottom:"1.5rem" }}>
      <h3 style={{ fontSize:16, fontWeight:700, color:ACCENT_DARK, marginBottom:10, display:"flex", alignItems:"center", gap:8 }}>
        <span>{icon}</span>{title}
      </h3>
      <div style={{ fontSize:13.5, color:"#374151", lineHeight:1.8 }}>{children}</div>
    </div>
  );

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ ...S.card, borderTop:`4px solid ${ACCENT}`, marginBottom:"1.5rem" }}>
        <button onClick={() => setSection("about")} style={{ ...S.btn("ghost"), fontSize:13, marginBottom:12, padding:"4px 10px" }}>← Back</button>
        <h2 style={S.sectionTitle}>🔒 Privacy Policy</h2>
        <p style={{ ...S.sectionSub, marginBottom:0 }}>Last updated: {new Date().toLocaleDateString("en-GB", { year:"numeric", month:"long", day:"numeric" })}</p>
      </div>

      <div style={S.card}>
        <Section icon="🎓" title="1. Purpose of This Application">
          <p>PsychAI Tutor is designed exclusively for <strong>medical education and exam preparation</strong>. It is intended for medical students, junior doctors, residents, and other healthcare trainees preparing for psychiatry assessments including OSCEs, written examinations, and clinical placements.</p>
          <p style={{ marginTop:8 }}>PsychAI Tutor does <strong>not</strong> provide clinical diagnosis, treatment recommendations, or professional medical advice of any kind.</p>
        </Section>

        <Section icon="📋" title="2. Information We Collect">
          <p>When you create an account and use PsychAI Tutor, we collect and store the following information:</p>
          <ul style={{ paddingLeft:20, marginTop:8 }}>
            <li style={{ marginBottom:6 }}><strong>Account information:</strong> your email address, used to create and manage your account.</li>
            <li style={{ marginBottom:6 }}><strong>Learning progress:</strong> completed clinical cases, OSCE stations attempted, MSE domains explored, DDx analyses, and MCQ scores.</li>
            <li style={{ marginBottom:6 }}><strong>AI usage data:</strong> counts of AI feature use per day (OSCE stations, DDx analyses, MCQ generations, MSE evaluations) to enforce fair-use limits.</li>
            <li style={{ marginBottom:6 }}><strong>Feedback submissions:</strong> ratings, written comments, and role information submitted through the in-app feedback form.</li>
            <li style={{ marginBottom:6 }}><strong>Session data:</strong> authentication tokens managed by Supabase Auth.</li>
          </ul>
        </Section>

        <Section icon="🚫" title="3. What We Do Not Collect">
          <p>PsychAI Tutor does <strong>not</strong> collect, store, or process real patient-identifiable information. All clinical cases within the application are entirely fictional and created for educational purposes.</p>
          <p style={{ marginTop:8, fontWeight:600, color:"#DC2626" }}>Users must not enter, upload, or reference real patient data, including names, dates of birth, NHS or hospital numbers, or any other information that could identify a real individual, at any point within this application.</p>
        </Section>

        <Section icon="🤖" title="4. AI-Generated Content">
          <p>AI features within PsychAI Tutor — including OSCE patient simulations, differential diagnosis generation, MCQ creation, and MSE feedback — are processed through <strong>secure server-side API routes</strong>. Your API requests are never made directly from your browser to the AI provider.</p>
          <p style={{ marginTop:8 }}>AI-generated content may contain inaccuracies, omissions, or errors. All AI outputs should be <strong>verified with qualified educators, supervisors, and trusted medical references</strong> before being relied upon for learning or clinical application.</p>
        </Section>

        <Section icon="🗄️" title="5. Data Storage and Security">
          <p>All user account data, learning progress, usage records, and feedback are stored using <strong>Supabase</strong>, a secure cloud database platform. Data is protected by:</p>
          <ul style={{ paddingLeft:20, marginTop:8 }}>
            <li style={{ marginBottom:6 }}>Row-level security (RLS) policies ensuring users can only access their own data.</li>
            <li style={{ marginBottom:6 }}>Encrypted connections (HTTPS/TLS) for all data in transit.</li>
            <li style={{ marginBottom:6 }}>Supabase Auth for session management and credential handling.</li>
          </ul>
          <p style={{ marginTop:8 }}>OpenAI API keys and Supabase service credentials are stored exclusively as server-side environment variables and are never exposed in the application's frontend code.</p>
        </Section>

        <Section icon="📤" title="6. Data Sharing">
          <p>We do not sell, rent, or share your personal data with third parties for marketing purposes. Data may be processed by the following service providers solely to operate the application:</p>
          <ul style={{ paddingLeft:20, marginTop:8 }}>
            <li style={{ marginBottom:6 }}><strong>Supabase</strong> — database, authentication, and storage.</li>
            <li style={{ marginBottom:6 }}><strong>OpenAI</strong> — AI content generation via secure server-side API calls.</li>
            <li style={{ marginBottom:6 }}><strong>Vercel</strong> — application hosting and serverless API routing.</li>
          </ul>
        </Section>

        <Section icon="🗑️" title="7. Data Deletion and User Rights">
          <p>You have the right to request deletion of your account and all associated data. To request data removal, please contact the application owner directly. We will process deletion requests within a reasonable timeframe.</p>
          <p style={{ marginTop:8 }}>You may also have rights under applicable data protection legislation (including GDPR where applicable) to access, correct, or port your personal data.</p>
        </Section>

        <Section icon="🔄" title="8. Changes to This Policy">
          <p>We may update this Privacy Policy from time to time. Continued use of PsychAI Tutor after any changes constitutes acceptance of the updated policy. The date at the top of this page reflects when the policy was last updated.</p>
        </Section>

        <div style={{ marginTop:"1.5rem", padding:"1rem 1.25rem", background:"#EFF6FF", border:"1px solid #BFDBFE", borderRadius:10, fontSize:13, color:"#1E40AF" }}>
          <strong>Questions or data removal requests?</strong> Please contact the PsychAI Tutor team via the in-app <button onClick={() => setSection("feedback")} style={{ background:"none", border:"none", color:ACCENT, cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700, padding:0, textDecoration:"underline" }}>Feedback</button> section.
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   TERMS OF USE PAGE
══════════════════════════════════════════════════════════════════ */
function TermsOfUse({ setSection }) {
  const Section = ({ icon, title, children }) => (
    <div style={{ marginBottom:"1.5rem" }}>
      <h3 style={{ fontSize:16, fontWeight:700, color:ACCENT_DARK, marginBottom:10, display:"flex", alignItems:"center", gap:8 }}>
        <span>{icon}</span>{title}
      </h3>
      <div style={{ fontSize:13.5, color:"#374151", lineHeight:1.8 }}>{children}</div>
    </div>
  );

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ ...S.card, borderTop:`4px solid ${TEAL}`, marginBottom:"1.5rem" }}>
        <button onClick={() => setSection("about")} style={{ ...S.btn("ghost"), fontSize:13, marginBottom:12, padding:"4px 10px" }}>← Back</button>
        <h2 style={S.sectionTitle}>📜 Terms of Use</h2>
        <p style={{ ...S.sectionSub, marginBottom:0 }}>Last updated: {new Date().toLocaleDateString("en-GB", { year:"numeric", month:"long", day:"numeric" })}</p>
      </div>

      <div style={S.card}>
        {/* Important notice */}
        <div style={{ background:"#FEF3C7", border:"1px solid #FDE68A", borderRadius:10, padding:"12px 16px", marginBottom:"1.5rem", fontSize:13.5, color:"#92400E" }}>
          <strong>⚠️ Please read these Terms of Use carefully before using PsychAI Tutor.</strong> By accessing or using this application, you agree to be bound by the terms set out below. If you do not agree, please do not use this application.
        </div>

        <Section icon="🎓" title="1. Educational Purpose Only">
          <p>PsychAI Tutor is provided exclusively for <strong>educational and exam preparation purposes</strong>. It is designed to help medical students, junior doctors, and healthcare trainees develop knowledge and skills in psychiatry.</p>
          <p style={{ marginTop:8 }}>PsychAI Tutor does <strong>not</strong> constitute medical practice, clinical advice, diagnosis, or treatment of any kind. Nothing within the application should be interpreted as a substitute for professional medical education, qualified clinical supervision, or the advice of a registered healthcare professional.</p>
        </Section>

        <Section icon="🏥" title="2. Not for Clinical Use">
          <p>Users must <strong>not</strong> use PsychAI Tutor to make or inform real patient care decisions. Specifically:</p>
          <ul style={{ paddingLeft:20, marginTop:8 }}>
            <li style={{ marginBottom:6 }}>Do not use AI-generated differentials, MSE feedback, or OSCE simulations as the basis for real clinical management.</li>
            <li style={{ marginBottom:6 }}>Do not use the application in a clinical setting as a reference tool for active patient care.</li>
            <li style={{ marginBottom:6 }}>Do not share AI-generated content with patients or caregivers as medical information.</li>
          </ul>
        </Section>

        <Section icon="🚫" title="3. Prohibited Use of Patient Data">
          <p>Users must <strong>not</strong> upload, enter, or reference any real patient-identifiable information within PsychAI Tutor. This prohibition includes but is not limited to:</p>
          <ul style={{ paddingLeft:20, marginTop:8 }}>
            <li style={{ marginBottom:6 }}>Patient names, dates of birth, addresses, or contact details.</li>
            <li style={{ marginBottom:6 }}>Hospital, NHS, or national ID numbers.</li>
            <li style={{ marginBottom:6 }}>Any information that could identify a real individual directly or indirectly.</li>
          </ul>
          <p style={{ marginTop:8 }}>All clinical content within the application uses entirely fictional case scenarios created for educational purposes.</p>
        </Section>

        <Section icon="©️" title="4. Intellectual Property">
          <p>All content, features, and design elements of PsychAI Tutor are the intellectual property of PsychAI Tutor and its creators. This includes, but is not limited to:</p>
          <ul style={{ paddingLeft:20, marginTop:8 }}>
            <li style={{ marginBottom:6 }}>All educational content, clinical case scenarios, and OSCE structures.</li>
            <li style={{ marginBottom:6 }}>Scoring logic, marking schemes, and feedback frameworks.</li>
            <li style={{ marginBottom:6 }}>Interface design, layout, branding, and visual identity.</li>
            <li style={{ marginBottom:6 }}>The PsychAI Tutor name and associated marks.</li>
          </ul>
          <p style={{ marginTop:8 }}>Users may <strong>not</strong> copy, redistribute, publish, reverse engineer, resell, sublicense, or otherwise commercially exploit any part of this platform without prior written permission from the application owner.</p>
        </Section>

        <Section icon="🤖" title="5. AI Features and Usage Limits">
          <p>AI-powered features within PsychAI Tutor (including OSCE simulation, differential diagnosis generation, MCQ creation, and MSE evaluation) are subject to <strong>daily usage limits per user</strong>. These limits are in place to:</p>
          <ul style={{ paddingLeft:20, marginTop:8 }}>
            <li style={{ marginBottom:6 }}>Control operational costs and ensure the platform remains accessible.</li>
            <li style={{ marginBottom:6 }}>Ensure fair access for all registered users.</li>
          </ul>
          <p style={{ marginTop:8 }}>Usage limits reset at midnight UTC each day. Current limits are displayed within each feature. Limits may be adjusted at any time without prior notice.</p>
        </Section>

        <Section icon="🔄" title="6. Service Modifications and Availability">
          <p>The application owner reserves the right to:</p>
          <ul style={{ paddingLeft:20, marginTop:8 }}>
            <li style={{ marginBottom:6 }}>Update, modify, or remove features, content, or functionality at any time without prior notice.</li>
            <li style={{ marginBottom:6 }}>Temporarily or permanently suspend access to the service for maintenance, security, or operational reasons.</li>
            <li style={{ marginBottom:6 }}>Modify these Terms of Use at any time. Continued use of the application constitutes acceptance of any updated terms.</li>
          </ul>
        </Section>

        <Section icon="⚖️" title="7. Limitation of Liability">
          <p>To the fullest extent permitted by applicable law, PsychAI Tutor and its creators accept no liability for:</p>
          <ul style={{ paddingLeft:20, marginTop:8 }}>
            <li style={{ marginBottom:6 }}>Any inaccuracies or errors in AI-generated content.</li>
            <li style={{ marginBottom:6 }}>Any clinical, educational, or professional decisions made based on content from this application.</li>
            <li style={{ marginBottom:6 }}>Loss of data, service interruptions, or technical failures.</li>
          </ul>
        </Section>

        <Section icon="📬" title="8. Contact">
          <p>If you have questions about these Terms of Use, wish to report a concern, or would like to request permission to use platform content, please contact the application team via the in-app <button onClick={() => setSection("feedback")} style={{ background:"none", border:"none", color:ACCENT, cursor:"pointer", fontFamily:"inherit", fontSize:13.5, fontWeight:700, padding:0, textDecoration:"underline" }}>Feedback</button> form.</p>
        </Section>

        <div style={{ marginTop:"1.5rem", padding:"1rem 1.25rem", background:"#F0FFF4", border:"1px solid #BBF7D0", borderRadius:10, fontSize:13, color:"#065F46" }}>
          <strong>By using PsychAI Tutor you confirm</strong> that you have read and agree to these Terms of Use, that you will use the application for educational purposes only, and that you will not enter real patient data.
        </div>
      </div>
    </div>
  );
}

function AboutPage() {
  const TEAM_VALUES = [
    { icon: "🎓", title: "Education First", desc: "Every feature is designed around proven pedagogical principles — Socratic questioning, spaced repetition, deliberate practice, and immediate feedback." },
    { icon: "🔬", title: "Evidence-Based Content", desc: "All clinical content is aligned with DSM-5-TR, NICE guidelines, Maudsley Prescribing Guidelines, and current UK/international psychiatry curricula." },
    { icon: "🤖", title: "Responsible AI", desc: "AI is used as a teaching tool, not a clinical decision-maker. Every AI interaction is framed as educational and clearly separated from real clinical practice." },
    { icon: "🔒", title: "Privacy by Design", desc: "No patient data is ever entered or processed. All fictional cases use non-identifiable information. User progress and feedback are stored locally only." },
  ];

  const GOALS = [
    { num: "01", title: "Build Clinical Reasoning", desc: "Train students to systematically approach psychiatric presentations — moving from symptoms to diagnosis to management with confidence and structure.", color: ACCENT },
    { num: "02", title: "Master the MSE", desc: "Develop fluency in Mental Status Examination documentation — the language of psychiatry — through structured practice and AI-evaluated feedback.", color: PURPLE },
    { num: "03", title: "OSCE Readiness", desc: "Simulate high-pressure clinical encounters with realistic AI patients across all major psychiatric presentations before entering the exam room.", color: "#D97706" },
    { num: "04", title: "Differential Diagnosis Skills", desc: "Teach students to hold multiple diagnoses in mind simultaneously, weigh evidence systematically, and always exclude organic and emergency causes first.", color: TEAL },
    { num: "05", title: "Pharmacology & Reference", desc: "Provide instant access to psychiatric drug profiles, DSM-5 criteria, and validated rating scales — the knowledge base behind every clinical decision.", color: ROSE },
    { num: "06", title: "Reduce Stigma Through Education", desc: "Foster compassionate, patient-centred attitudes toward mental illness by immersing students in realistic, humanised clinical scenarios from day one.", color: "#059669" },
  ];

  const MODULE_SUMMARY = [
    { icon: "🩺", label: "Clinical Cases",     desc: "15 DSM-5 categories · 20 cases",      color: ACCENT  },
    { icon: "🎭", label: "OSCE Simulator",     desc: "5 stations · AI patient · feedback",   color: "#D97706" },
    { icon: "🧠", label: "MSE Trainer",        desc: "11 domains · practice · sample MSEs",  color: PURPLE  },
    { icon: "🔍", label: "Differential Dx",    desc: "Symptom clusters · organic flags",     color: TEAL    },
    { icon: "📝", label: "MCQ Practice",       desc: "USMLE/MRCPsych-style · AI-generated",  color: ROSE    },
    { icon: "📚", label: "Reference",          desc: "DSM-5 · pharmacology · scales",        color: "#0891B2" },
  ];

  return (
    <div className="fade-in">

      {/* ── Hero ── */}
      <div style={{ borderRadius: 16, background: `linear-gradient(145deg, ${ACCENT_DARK} 0%, #1a4a8a 60%, #1e5fad 100%)`, color: "#fff", padding: "2.25rem 2rem", marginBottom: "1.5rem", position: "relative", overflow: "hidden" }}>
        {/* Decorative circles */}
        <div style={{ position: "absolute", width: 180, height: 180, borderRadius: "50%", background: "rgba(255,255,255,.05)", right: -30, top: -30 }} />
        <div style={{ position: "absolute", width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,.05)", right: "auto", top: -20, left: 40 }} />
        <div style={{ position: "absolute", width: 80, height: 80, borderRadius: "50%", background: "rgba(255,255,255,.05)", right: "auto", top: "auto", bottom: -30, left: 60 }} />
        <div style={{ position: "relative" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,.12)", borderRadius: 99, padding: "4px 14px", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 14 }}>
            <span style={{ color: "#7EC8E3" }}>●</span> PsychAI Tutor · v2.0
          </div>
          <h1 style={{ fontFamily: "Georgia,serif", fontSize: 30, fontWeight: 700, color: "#fff", marginBottom: 10, lineHeight: 1.15 }}>
            AI-Powered Psychiatry<br />Education for Medical Students
          </h1>
          <p style={{ fontSize: 15, opacity: .88, lineHeight: 1.75, maxWidth: 560, marginBottom: "1.5rem" }}>
            PsychAI Tutor is an interactive, evidence-based psychiatry learning platform built for medical students during their psychiatry clerkship. Powered by Claude AI, it brings clinical cases, OSCE simulation, and structured examination training to every student's pocket.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["DSM-5-TR Aligned", "Evidence-Based", "USMLE & MRCPsych", "Mobile-Friendly", "AI-Powered"].map(tag => (
              <span key={tag} style={{ background: "rgba(255,255,255,.14)", borderRadius: 20, padding: "4px 13px", fontSize: 12, fontWeight: 600 }}>{tag}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Mission ── */}
      <div style={{ ...S.card, borderLeft: `5px solid ${ACCENT}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Our Mission</div>
        <h2 style={{ fontFamily: "Georgia,serif", fontSize: 20, fontWeight: 700, color: ACCENT_DARK, marginBottom: 12, lineHeight: 1.3 }}>
          Democratising High-Quality Psychiatry Education
        </h2>
        <p style={{ fontSize: 14, color: "#334155", lineHeight: 1.85, marginBottom: 10 }}>
          Psychiatry is one of medicine's most intellectually demanding and socially significant disciplines — yet many medical students arrive at their clerkship underprepared for the unique challenges of psychiatric assessment. PsychAI Tutor exists to close that gap.
        </p>
        <p style={{ fontSize: 14, color: "#334155", lineHeight: 1.85 }}>
          We combine structured medical education principles with the power of large language models to create an always-available, non-judgmental learning environment where students can practise clinical reasoning, interview skills, and diagnostic thinking without the pressure of real patient encounters.
        </p>
      </div>

      {/* ── Target Users ── */}
      <div style={{ ...S.card }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: TEAL, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Target Users</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px,1fr))", gap: "0.875rem" }}>
          {[
            { icon: "👨‍⚕️", title: "Medical Students", desc: "Primary audience — students in their psychiatry clerkship or preparing for OSCE and written exams.", highlight: true },
            { icon: "🩺", title: "Foundation Doctors", desc: "FY1/FY2 doctors rotating through psychiatry who need a rapid refresher on presentations and MSE.", highlight: false },
            { icon: "📋", title: "Psychiatry Trainees", desc: "CT1/CT2 trainees consolidating knowledge for MRCPsych Part 1 examinations.", highlight: false },
            { icon: "🎓", title: "Medical Educators", desc: "Clinical tutors and professors looking for structured digital resources to supplement teaching.", highlight: false },
          ].map((u, i) => (
            <div key={i} style={{ background: u.highlight ? ACCENT_LIGHT : "#F8FAFC", borderRadius: 12, padding: "1rem", border: `1px solid ${u.highlight ? "#BFDBFE" : "#E8EEF4"}` }}>
              <div style={{ fontSize: 26, marginBottom: 8 }}>{u.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: u.highlight ? ACCENT_DARK : "#1e293b", marginBottom: 4 }}>{u.title}</div>
              <div style={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.6 }}>{u.desc}</div>
              {u.highlight && <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: ACCENT }}>● Primary Audience</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── What's Inside ── */}
      <div style={{ ...S.card }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Platform Modules</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px,1fr))", gap: "0.75rem" }}>
          {MODULE_SUMMARY.map((m, i) => (
            <div key={i} style={{ background: "#F8FAFC", borderRadius: 10, padding: "0.875rem 1rem", borderTop: `3px solid ${m.color}` }}>
              <div style={{ fontSize: 22, marginBottom: 5 }}>{m.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 13, color: m.color, marginBottom: 3 }}>{m.label}</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>{m.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Education Goals ── */}
      <div style={{ ...S.card }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: PURPLE, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Psychiatry Education Goals</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          {GOALS.map((g, i) => (
            <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${g.color}18`, border: `1.5px solid ${g.color}33`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: g.color, flexShrink: 0 }}>
                {g.num}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b", marginBottom: 3 }}>{g.title}</div>
                <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7 }}>{g.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Core Values ── */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Our Core Values</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px,1fr))", gap: "0.875rem", marginBottom: "1.5rem" }}>
        {TEAM_VALUES.map((v, i) => (
          <div key={i} style={{ ...S.card, marginBottom: 0, padding: "1.125rem" }}>
            <div style={{ fontSize: 26, marginBottom: 8 }}>{v.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: ACCENT_DARK, marginBottom: 6 }}>{v.title}</div>
            <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7 }}>{v.desc}</div>
          </div>
        ))}
      </div>

      {/* ── Ethical AI Use ── */}
      <div style={{ ...S.card, borderTop: `4px solid ${PURPLE}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 26 }}>🤖</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: PURPLE, textTransform: "uppercase", letterSpacing: 1 }}>Ethical AI Use Statement</div>
            <div style={{ fontWeight: 700, fontSize: 17, color: ACCENT_DARK, fontFamily: "Georgia,serif" }}>Responsible Use of Artificial Intelligence</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { icon: "✅", title: "AI as Tutor, Not Clinician", body: "Claude AI is used exclusively as an educational scaffold. It simulates patients, generates questions, and provides pedagogical feedback. It does not diagnose, prescribe, or advise on real patients under any circumstances.", color: TEAL },
            { icon: "✅", title: "Transparency", body: "All AI-generated content is clearly identified. Students are always aware they are interacting with an AI simulation, not a real patient or clinician. AI responses are framed as educational prompts, not clinical facts.", color: ACCENT },
            { icon: "✅", title: "No Real Patient Data", body: "PsychAI Tutor processes only fictional, non-identifiable case scenarios created for educational purposes. Users must never enter real patient information into any field of this application.", color: "#059669" },
            { icon: "✅", title: "Accuracy & Limitations", body: "AI-generated content may contain inaccuracies. All clinical content has been designed in alignment with DSM-5-TR and evidence-based guidelines, but students must verify important clinical information with authoritative sources.", color: AMBER },
            { icon: "✅", title: "Human Oversight", body: "This platform is intended to supplement, not replace, clinical supervision by qualified psychiatrists and educators. All learning must occur within the context of appropriate medical education oversight.", color: PURPLE },
            { icon: "✅", title: "Fairness & Inclusion", body: "Case scenarios are designed to represent diverse patient populations. We are committed to identifying and correcting any bias in clinical scenarios or AI responses that may disadvantage any group.", color: ROSE },
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: i < 5 ? "1px solid #EEF2F7" : "none" }}>
              <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: item.color, marginBottom: 3 }}>{item.title}</div>
                <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.75 }}>{item.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Clinical Disclaimer ── */}
      <div style={{ borderRadius: 14, background: "#1e293b", color: "#fff", padding: "1.75rem 1.5rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 26 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#F59E0B", textTransform: "uppercase", letterSpacing: 1 }}>Important Notice</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: "#fff", fontFamily: "Georgia,serif" }}>Educational Disclaimer</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            "PsychAI Tutor is an educational tool designed exclusively for medical student learning. It is NOT a clinical decision-support system and must NEVER be used to guide real patient care.",
            "All clinical cases, patient simulations, diagnoses, and management suggestions within this application are fictional and created solely for teaching purposes. They do not constitute medical advice.",
            "No real, identifiable patient information should ever be entered into this application. If you are caring for a patient, consult a qualified clinician and appropriate clinical resources.",
            "AI-generated responses, including differential diagnoses, management plans, and feedback, may be incomplete or inaccurate. Always verify clinical information against authoritative medical literature and guidelines.",
            "This application does not establish a doctor-patient relationship. If you or someone you know is experiencing a mental health crisis, please contact emergency services or a mental health professional immediately.",
          ].map((point, i) => (
            <div key={i} style={{ display: "flex", gap: 10, fontSize: 13, lineHeight: 1.75, color: "rgba(255,255,255,.82)" }}>
              <span style={{ color: "#F59E0B", flexShrink: 0, marginTop: 1 }}>›</span>
              <span>{point}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,.1)", fontSize: 12, color: "rgba(255,255,255,.45)", lineHeight: 1.6 }}>
          By using PsychAI Tutor, you acknowledge that this platform is for educational purposes only and agree not to use any content herein for clinical decision-making or patient management.
        </div>
      </div>

      {/* ── Technology & Credits ── */}
      <div style={{ ...S.card }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Technology</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px,1fr))", gap: "0.75rem" }}>
          {[
            { label: "AI Engine",       value: "Claude (Anthropic)",   icon: "🤖" },
            { label: "Framework",       value: "React",                icon: "⚛️" },
            { label: "Content Standard",value: "DSM-5-TR",             icon: "📖" },
            { label: "Exam Alignment",  value: "USMLE · MRCPsych",    icon: "🎓" },
            { label: "Guidelines",      value: "NICE · Maudsley",      icon: "📋" },
            { label: "Platform",        value: "Claude Artifacts",     icon: "🛠️" },
          ].map((t, i) => (
            <div key={i} style={{ background: "#F8FAFC", borderRadius: 10, padding: "0.75rem 0.875rem" }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>{t.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#1e293b", marginBottom: 2 }}>{t.value}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>{t.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [section, setSection]     = useState("home");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ]     = useState("");
  const [authView, setAuthView]   = useState(null); // "login" | "signup" | null
  const [user, setUser]           = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [progress, setProgress]   = useState({
    cases: { completed: [] },
    osce:  { completed: [] },
    mse:   { explored: [] },
    ddx:   { built: 0 },
    mcq:   { correct: 0, total: 0 },
  });

  // ── Auth listener ─────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) { setAuthView(null); loadProgress(session.user.id); }
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Load progress from Supabase ───────────────────────────────
  async function loadProgress(uid) {
    const { data } = await supabase
      .from("user_progress")
      .select("*")
      .eq("user_id", uid)
      .single();
    if (data) {
      setProgress({
        cases: { completed: data.cases_completed || [] },
        osce:  { completed: data.osce_completed  || [] },
        mse:   { explored:  data.mse_explored    || [] },
        ddx:   { built: data.ddx_built           || 0  },
        mcq:   { correct: data.mcq_correct       || 0, total: data.mcq_total || 0 },
      });
    }
  }

  // ── Persist progress to Supabase (debounced via useEffect) ────
  const saveProgress = useCallback(async (p) => {
    if (!user) return;
    await supabase.from("user_progress").upsert({
      user_id:         user.id,
      cases_completed: p.cases.completed,
      osce_completed:  p.osce.completed,
      mse_explored:    p.mse.explored,
      ddx_built:       p.ddx.built,
      mcq_correct:     p.mcq.correct,
      mcq_total:       p.mcq.total,
      updated_at:      new Date().toISOString(),
    }, { onConflict: "user_id" });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => saveProgress(progress), 1200);
    return () => clearTimeout(t);
  }, [progress, user, saveProgress]);

  // ── Logout ───────────────────────────────────────────────────
  async function handleLogout() {
    await supabase.auth.signOut();
    setUser(null);
    setProgress({ cases:{completed:[]}, osce:{completed:[]}, mse:{explored:[]}, ddx:{built:0}, mcq:{correct:0,total:0} });
    setSection("home");
  }

  /* Keyboard shortcut Cmd/Ctrl+K */
  useEffect(() => {
    function handler(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen(true); }
      if (e.key === "Escape") setSearchOpen(false);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (authLoading) {
    return (
      <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background: BG }}>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🩺</div>
          <div style={{ fontFamily:"Georgia,serif", fontSize:22, color:ACCENT_DARK, fontWeight:700 }}>PsychAI Tutor</div>
          <div style={{ marginTop:16, fontSize:13, color:"#94a3b8" }}>Loading…</div>
        </div>
      </div>
    );
  }

  // ── Auth modal overlay ────────────────────────────────────────
  if (authView) {
    return <AuthModal view={authView} setView={setAuthView} onSuccess={() => setAuthView(null)} />;
  }

  const props = { progress, setProgress, setSection, user };

  const renderSection = () => {
    switch (section) {
      case "home":     return <Home {...props} onAuthPrompt={() => setAuthView("login")} />;
      case "cases":    return <ClinicalCases {...props} />;
      case "osce":     return <OSCESimulator {...props} />;
      case "mse":      return <MSETrainer {...props} />;
      case "ddx":      return <DDxBuilder {...props} />;
      case "mcq":      return <MCQPractice {...props} />;
      case "ref":      return <Reference />;
      case "profile":  return <ProfileSection progress={progress} user={user} onLogout={handleLogout} />;
      case "analytics": return <AnalyticsDashboard progress={progress} user={user} />;
      case "feedback": return <FeedbackSection user={user} />;
      case "about":    return <AboutPage />;
      case "privacy":  return <PrivacyPolicy setSection={setSection} />;
      case "terms":    return <TermsOfUse    setSection={setSection} />;
      default:         return <Home {...props} onAuthPrompt={() => setAuthView("login")} />;
    }
  };

  return (
    <div style={{ background: BG, minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{-webkit-font-smoothing:antialiased;}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:99px;}
        ::-webkit-scrollbar-track{background:transparent;}
        .ch{transition:box-shadow .18s,transform .18s;}
        .ch:hover{box-shadow:0 8px 28px rgba(0,0,0,.10)!important;transform:translateY(-2px)!important;}
        .fade-in{animation:fadeIn .28s ease both;}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .nav-item{transition:background .15s;}
        .nav-item:hover{background:rgba(255,255,255,.12)!important;}
        .nav-item.active{background:rgba(255,255,255,.18)!important;}
        button{transition:all .15s;}
        button:active{transform:scale(.97);}
        button:disabled{opacity:.55;cursor:not-allowed;transform:none!important;}
        input:focus,textarea:focus,select:focus{border-color:#1E5FAD!important;box-shadow:0 0 0 3px rgba(30,95,173,.15)!important;outline:none!important;}
        input,textarea,select{transition:border-color .15s,box-shadow .15s;}
        ::selection{background:rgba(30,95,173,.18);color:#1e293b;}
        @media(max-width:700px){
          .sidebar{display:none!important;}
          .bottom-nav{display:flex!important;}
          .main-wrap{margin-left:0!important;}
          .main-pad{padding-bottom:80px!important;}
          h2{font-size:18px!important;}
        }
        @media(min-width:701px){
          .bottom-nav{display:none!important;}
          .main-wrap{margin-left:${SIDEBAR_W}px;}
        }
        @media print{
          .sidebar,.bottom-nav{display:none!important;}
          .main-wrap{margin:0!important;}
        }
      `}</style>

      {searchOpen && <SearchOverlay query={searchQ} setQuery={setSearchQ} onClose={() => setSearchOpen(false)} setSection={setSection} />}

      <Sidebar section={section} setSection={setSection} progress={progress} user={user}
               onLogin={() => setAuthView("login")} onSignup={() => setAuthView("signup")} onLogout={handleLogout} />
      <BottomNav section={section} setSection={setSection} />

      <div className="main-wrap" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <TopBar setSearchOpen={setSearchOpen} section={section} setSection={setSection}
                user={user} onLogin={() => setAuthView("login")} onLogout={handleLogout} />

        <main className="main-pad fade-in" key={section} style={{ flex: 1, maxWidth: 900, margin: "0 auto", width: "100%", padding: "1.5rem 1.25rem 3rem" }}>
          {/* ── Educational disclaimer ribbon ── */}
          <div style={{ display:"flex", alignItems:"flex-start", gap:9, background:"#EFF6FF", border:"1px solid #BFDBFE", borderRadius:9, padding:"9px 14px", marginBottom:"1.25rem" }}>
            <span style={{ fontSize:15, flexShrink:0, marginTop:1 }}>🎓</span>
            <span style={{ fontSize:12, color:"#1E40AF", lineHeight:1.55 }}>
              <strong>For medical education only.</strong> This app does not provide clinical diagnosis, treatment recommendations, or professional medical advice. All cases are fictional. Always consult qualified clinicians and current guidelines for patient care.
            </span>
          </div>
          {renderSection()}
        </main>

        {/* ── Legal Footer ── */}
        <footer style={{ marginTop:"2rem", borderTop:"1px solid #E8EEF4", background:"#fff", fontSize:12.5 }}>
          {/* Disclaimer bar */}
          <div style={{ background:"#FEF3C7", borderBottom:"1px solid #FDE68A", padding:"10px 1.5rem", display:"flex", alignItems:"flex-start", gap:10 }}>
            <span style={{ fontSize:16, flexShrink:0, marginTop:1 }}>⚠️</span>
            <p style={{ margin:0, fontSize:12.5, color:"#92400E", lineHeight:1.6 }}>
              <strong>Medical Education Disclaimer.</strong> PsychAI Tutor is designed for medical education only and does not provide clinical diagnosis or treatment. All cases are fictional. Always consult qualified clinicians and current guidelines for patient care decisions.
            </p>
          </div>

          {/* Main footer body */}
          <div style={{ padding:"1.25rem 1.5rem", display:"flex", flexWrap:"wrap", gap:"1.5rem", justifyContent:"space-between", alignItems:"flex-start" }}>

            {/* Brand */}
            <div style={{ minWidth:180 }}>
              <div style={{ fontFamily:"Georgia,serif", fontWeight:700, fontSize:17, color:ACCENT_DARK, marginBottom:4 }}>
                <span style={{ color:"#1E5FAD" }}>Psych</span>AI Tutor
              </div>
              <div style={{ fontSize:11.5, color:"#64748b", lineHeight:1.6, maxWidth:220 }}>
                AI-powered psychiatry education for medical students, junior doctors, and trainees preparing for clinical assessments.
              </div>
            </div>

            {/* Content alignment */}
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:0.8, marginBottom:8 }}>Content Alignment</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {["DSM-5-TR","ICD-11","NICE Guidelines","USMLE Step 1 & 2","MRCPsych","Maudsley Guidelines"].map(b => (
                  <span key={b} style={{ background:"#EBF2FB", color:ACCENT_DARK, borderRadius:6, padding:"3px 9px", fontSize:11, fontWeight:600 }}>{b}</span>
                ))}
              </div>
            </div>

            {/* Legal links + copyright */}
            <div style={{ textAlign:"right", minWidth:180 }}>
              <div style={{ fontWeight:600, color:"#64748b", marginBottom:6, fontSize:12 }}>PsychAI Tutor v3.0</div>
              <div style={{ color:"#94a3b8", marginBottom:4 }}>Powered by OpenAI &amp; Supabase</div>
              <div style={{ color:"#64748b", fontWeight:600, marginBottom:8 }}>
                © PsychAI Tutor 2026. All rights reserved.
              </div>
              {/* Legal page links */}
              <div style={{ display:"flex", gap:10, justifyContent:"flex-end", flexWrap:"wrap" }}>
                <button onClick={() => setSection("privacy")}
                  style={{ background:"none", border:"none", color:ACCENT, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:500, padding:0, textDecoration:"underline" }}>
                  Privacy Policy
                </button>
                <span style={{ color:"#CBD5E1" }}>·</span>
                <button onClick={() => setSection("terms")}
                  style={{ background:"none", border:"none", color:ACCENT, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:500, padding:0, textDecoration:"underline" }}>
                  Terms of Use
                </button>
              </div>
            </div>
          </div>

          {/* Bottom micro bar */}
          <div style={{ borderTop:"1px solid #F1F5F9", padding:"8px 1.5rem", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8, background:"#FAFAFA" }}>
            <span style={{ color:"#94a3b8", fontSize:11 }}>
              For educational use only · Not a substitute for clinical training or professional medical advice
            </span>
            <span style={{ display:"flex", alignItems:"center", gap:8, fontSize:11 }}>
              <button onClick={() => setSection("privacy")}
                style={{ background:"none", border:"none", color:"#94a3b8", cursor:"pointer", fontFamily:"inherit", fontSize:11, padding:0, textDecoration:"underline" }}>
                Privacy Policy
              </button>
              <span style={{ color:"#CBD5E1" }}>·</span>
              <button onClick={() => setSection("terms")}
                style={{ background:"none", border:"none", color:"#94a3b8", cursor:"pointer", fontFamily:"inherit", fontSize:11, padding:0, textDecoration:"underline" }}>
                Terms of Use
              </button>
              <span style={{ color:"#CBD5E1" }}>·</span>
              <span style={{ color:"#CBD5E1" }}>Supabase · OpenAI</span>
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
