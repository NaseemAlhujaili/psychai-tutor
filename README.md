# 🩺 PsychAI Tutor

**AI-powered psychiatry education for medical students, junior doctors, and trainees.**

Built with React + Vite. AI features powered by Claude (Anthropic). Deployable to Vercel in minutes.

---

## What's inside

| Module | Description |
|---|---|
| 🩺 Clinical Cases | 24 clerkship-level DSM-5 cases with AI tutor chat |
| 🎭 OSCE Simulator | 5 stations with AI patient personas and examiner feedback |
| 🧠 MSE Trainer | Mental Status Examination practice with AI evaluation |
| 🔍 DDx Builder | Differential diagnosis with emergency flags |
| 📝 MCQ Practice | USMLE/MRCPsych-style questions with AI generation |
| 📚 Clinical Reference | DSM-5 criteria, pharmacology, rating scales |
| 📊 Analytics | Learning dashboard with activity heatmap and performance charts |
| 👤 Profile | Progress tracking and achievements |

---

## Deploy to Vercel (recommended)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create psychai-tutor --public --push
```

### 2. Import into Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your GitHub repository
3. Vercel auto-detects Vite — no build settings needed
4. Before deploying, add your environment variable:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (from [console.anthropic.com](https://console.anthropic.com/settings/keys)) |

5. Click **Deploy** — done in ~60 seconds

### 3. Your app is live

Vercel gives you a URL like `psychai-tutor.vercel.app`. Share it with your students.

---

## Run locally

```bash
# Install dependencies
npm install

# Copy env template and add your key
cp .env.example .env.local
# Edit .env.local and set ANTHROPIC_API_KEY=sk-ant-...

# Start Vite dev server (port 3000)
npm run dev
```

> **Note:** Local AI features require the API key. The static content (cases, reference, UI) works without it.

---

## Project structure

```
psychai-tutor/
├── api/
│   └── chat.js          # Vercel serverless function — Anthropic proxy
├── src/
│   ├── main.jsx         # React entry point
│   └── App.jsx          # Entire application (~4600 lines)
├── index.html           # Vite HTML template
├── vite.config.js       # Vite configuration
├── vercel.json          # Vercel routing and function config
├── package.json
├── .env.example         # Environment variable template
└── .gitignore
```

---

## Architecture

```
Browser → /api/chat (Vercel Function) → Anthropic API
                ↑
         API key stored securely
         as Vercel environment variable
         (never exposed to browser)
```

All AI calls are proxied through `/api/chat.js`. The Anthropic API key lives only in Vercel's environment — never in the browser bundle.

---

## Estimated API costs

PsychAI Tutor uses `claude-sonnet-4-20250514` with `max_tokens: 2500`.

| Usage | Approx. cost |
|---|---|
| Single case discussion (5 turns) | ~$0.01 |
| Full OSCE station + feedback | ~$0.03 |
| MCQ generation (1 question) | ~$0.002 |
| MSE evaluation | ~$0.01 |

Light student usage (~20 interactions/day) ≈ **$0.20–$0.50/day**.

---

## Educational disclaimer

> PsychAI Tutor is designed for **medical education and exam preparation only**. It does not provide clinical diagnosis, treatment recommendations, or professional medical advice. All cases are fictional. Always consult qualified clinicians and current guidelines for patient care decisions.

---

## Tech stack

- **Frontend:** React 18, Vite 5
- **AI:** Claude Sonnet 4 via Anthropic Messages API
- **Hosting:** Vercel (serverless functions + CDN)
- **Styling:** Inline React styles (no CSS framework dependency)
- **Content alignment:** DSM-5-TR, ICD-11, NICE Guidelines, USMLE, MRCPsych
