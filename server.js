/* GramCare AI - Node.js HTTP API server (educational prototype) */
/* Ported from server.c (C backend). Frontend API contracts preserved exactly. */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { GoogleGenAI } = require('@google/genai');

const app = express();

// CORS (server.c set Access-Control-Allow-Origin: * on every response)
app.use(cors());

// JSON body parser (frontend sends Content-Type: application/json)
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------------------
// In-memory patient store (mirrors server.c: static Patient patients[200])
// ---------------------------------------------------------------------------
const MAX_PATIENTS = 200;
const patients = [
  { id: 'GC-1001', name: 'Sunita Devi', village: 'Sahaspur', mobile: '9000000001', flag: 'NORMAL', age: 34 },
  { id: 'GC-1002', name: 'Ramesh Negi', village: 'Chakrata', mobile: '9000000002', flag: 'URGENT', age: 61 },
  { id: 'GC-1003', name: 'Kavita Rawat', village: 'Doiwala', mobile: '9000000003', flag: 'REVIEW', age: 27 },
];

// ---------------------------------------------------------------------------
// Vital-sign classification (ported from C edge())
// ---------------------------------------------------------------------------
function edge(hr, sp, tp) {
  if (hr < 30 || hr > 220 || sp < 50 || sp > 100 || tp < 30 || tp > 45) return 'INVALID';
  if (sp < 90 || hr > 130 || hr < 45 || tp >= 39.5) return 'URGENT';
  if (sp < 94 || hr > 100 || hr < 55 || tp >= 38) return 'REVIEW';
  return 'NORMAL';
}

// ---------------------------------------------------------------------------
// Gemma 4 client (server-side only — API key never reaches frontend)
// ---------------------------------------------------------------------------
let geminiClient = null;
function getGeminiClient() {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    geminiClient = new GoogleGenAI({ apiKey });
  }
  return geminiClient;
}

// Bounded retry for transient Google API errors (500, 503, 429).
// Never retries 400/401/403/404.
const RETRYABLE_STATUS = new Set([429, 500, 503]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithRetry(ai, params) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      lastErr = err;
      const status = err.code || err.status || 0;
      if (!RETRYABLE_STATUS.has(status) || attempt === MAX_RETRIES) {
        throw err;
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`Gemma transient error (${status}), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// Gemma 4 model via the Gemini API.
// gemma-4-31b-it returns HTTP 500 on generateContent for this project;
// gemma-4-26b-a4b-it is confirmed accessible and working.
const GEMMA_MODEL = 'gemma-4-26b-a4b-it';

// ---------------------------------------------------------------------------
// Server-side rate limiter for /api/gemma (prevents unbounded API costs)
// ---------------------------------------------------------------------------
const GEMMA_RATE_LIMIT = {};
const GEMMA_MAX_REQUESTS = 15; // per window per IP
const GEMMA_WINDOW_MS = 60000; // 1 minute

function checkGemmaRateLimit(ip) {
  const now = Date.now();
  const entry = GEMMA_RATE_LIMIT[ip] || { count: 0, resetAt: now + GEMMA_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + GEMMA_WINDOW_MS;
  }
  entry.count += 1;
  GEMMA_RATE_LIMIT[ip] = entry;
  return entry.count <= GEMMA_MAX_REQUESTS;
}

// Clean up stale rate-limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const ip of Object.keys(GEMMA_RATE_LIMIT)) {
    if (now > GEMMA_RATE_LIMIT[ip].resetAt) {
      delete GEMMA_RATE_LIMIT[ip];
    }
  }
}, 300000);

const HEALTHCARE_SYSTEM_INSTRUCTION = `You are GramCare AI, an educational rural-healthcare prototype.
Provide general educational health information only.
Never claim to diagnose the user.
Never claim to replace a doctor.
Avoid presenting uncertain medical information as fact.
Recommend appropriate professional medical care when necessary.
Keep responses concise and easy to understand.
Be suitable for users who may have limited medical knowledge.
Respond in the language used by the user when practical (English or Hindi/Hinglish).
For potentially urgent symptoms such as severe chest pain, severe difficulty breathing,
unconsciousness, severe bleeding, signs of stroke, serious accident/injury, or other
obvious emergencies, clearly recommend seeking immediate emergency medical assistance
rather than relying on the AI.
Do not imply that GramCare has actually contacted an ambulance, doctor, ASHA worker,
hospital, or emergency service.`;

// ---------------------------------------------------------------------------
// API routes (exact frontend contracts preserved)
// ---------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ ok: true, backend: 'Node.js', name: 'GramCare AI' });
});

app.post('/api/vitals', (req, res) => {
  // C defaults missing numeric fields to 0
  const hr = Number(req.body.hr) || 0;
  const sp = Number(req.body.spo2) || 0;
  const tp = Number(req.body.temp) || 0;
  const flag = edge(hr, sp, tp);
  const message = flag === 'INVALID'
    ? 'Re-check the measurement'
    : 'Attention flag only - not a diagnosis';
  res.json({ flag, message });
});

app.get('/api/patients', (req, res) => {
  res.json(patients);
});

app.post('/api/patients', (req, res) => {
  if (patients.length >= MAX_PATIENTS) {
    return res.status(400).json({ error: 'Patient limit reached' });
  }

  const name = String(req.body.name || '');
  const village = String(req.body.village || '');
  const mobile = String(req.body.mobile || '');
  // C defaults missing age to -1, which fails validation (age < 0)
  const age = Number.isFinite(Number(req.body.age)) ? Number(req.body.age) : -1;

  // C validation: strlen(name)<2 || age<0 || age>120 || strlen(village)<2 || strlen(mobile)!=10
  if (name.length < 2 || age < 0 || age > 120 || village.length < 2 || mobile.length !== 10) {
    return res.status(400).json({ error: 'Invalid patient details' });
  }

  const p = {
    id: `GC-${1001 + patients.length}`,
    name,
    village,
    mobile,
    flag: 'NO READINGS',
    age,
  };
  patients.push(p);
  res.json({ ok: true, id: p.id });
});

app.get('/api/medicines', (req, res) => {
  res.json([
    { name: 'Paracetamol 500 mg', category: 'Fever & pain', price: 24, rx: false },
    { name: 'ORS Sachet', category: 'Hydration', price: 22, rx: false },
    { name: 'Digital Thermometer', category: 'Devices', price: 180, rx: false },
    { name: 'Pulse Oximeter', category: 'Devices', price: 899, rx: false },
    { name: 'Amoxicillin', category: 'Prescription only', price: 120, rx: true },
  ]);
});

app.post('/api/emergency', (req, res) => {
  const name = String(req.body.name || 'Unknown patient');
  const problem = String(req.body.problem || '');
  res.json({
    id: `SOS-${Date.now()}`,
    status: 'SENT',
    patient: name,
    problem: problem,
    responder: 'Nearest on-duty doctor / ASHA',
    eta_min: 8,
  });
});

<<<<<<< Updated upstream
app.post('/api/gemma', async (req, res) => {
  // ---- Rate limit (server-side only, prevents unbounded API costs) ----
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (!checkGemmaRateLimit(ip)) {
    return res.status(429).json({
      ok: false,
      error: 'AI rate limit exceeded. Please try again later.',
    });
  }

  try {
    const { message } = req.body;

    // ---- Input validation ----
    if (message === undefined || message === null) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (typeof message !== 'string') {
      return res.status(400).json({ error: 'Message must be a string' });
    }
    if (!message.trim()) {
      return res.status(400).json({ error: 'Message must not be empty' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: 'Message must not exceed 2000 characters' });
    }

    // ---- API key check (server-side only) ----
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ ok: false, error: 'AI service is temporarily unavailable.' });
    }

    // ---- Call Gemma 4 via Gemini API ----
    const ai = getGeminiClient();
    const response = await generateWithRetry(ai, {
      model: GEMMA_MODEL,
      contents: message,
      config: {
        systemInstruction: HEALTHCARE_SYSTEM_INSTRUCTION,
      },
    });

    const responseText = response.text || '';

    res.json({
      ok: true,
      model: GEMMA_MODEL,
      response: responseText,
      disclaimer: 'Educational information only — not a diagnosis or replacement for professional medical care.',
    });
  } catch (err) {
    // Log only safe debugging information (no keys, no stack traces)
    console.error('Gemma API error:', err.message || 'Unknown error');
    res.status(503).json({ ok: false, error: 'AI service is temporarily unavailable.' });
  }
});

// ---------------------------------------------------------------------------
// Sarvam AI Speech-to-Text Transcription Route
// ---------------------------------------------------------------------------
app.post('/api/transcribe', express.raw({ type: '*/*', limit: '15mb' }), async (req, res) => {
  try {
    const customKey = req.headers['x-sarvam-key'];
    const apiKey = customKey || process.env.SARVAM_API_KEY;

    if (!apiKey) {
      return res.status(400).json({
        error: 'SARVAM_API_KEY is not configured. Please add SARVAM_API_KEY in your .env file.',
      });
    }

    const audioBuffer = req.body;
    if (!audioBuffer || audioBuffer.length === 0) {
      return res.status(400).json({ error: 'No audio data received' });
    }

    const lang = req.query.lang || 'hi-IN';
    const contentType = req.headers['content-type'] || 'audio/webm';

    const blob = new Blob([audioBuffer], { type: contentType });
    const formData = new FormData();
    formData.append('file', blob, 'audio.webm');
    formData.append('model', 'saaras:v4');
    formData.append('mode', 'transcribe');
    formData.append('language_code', lang);

    const sarvamRes = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
      },
      body: formData,
    });

    const data = await sarvamRes.json();

    // Save transcript to database / store
    const text = (data.transcript || '').trim();
    if (text) {
      const record = {
        id: voiceTranscripts.length + 1,
        transcript: text,
        language: lang,
        created_at: new Date().toISOString(),
      };
      voiceTranscripts.unshift(record);
      data.db_id = record.id;
      data.saved_to_db = true;
    }

    return res.status(sarvamRes.status).json(data);
  } catch (err) {
    console.error('Sarvam AI transcription error:', err);
    return res.status(500).json({ error: err.message || 'Failed to transcribe audio' });
  }
});

// ---------------------------------------------------------------------------
// Voice Transcripts Routes
// ---------------------------------------------------------------------------
const voiceTranscripts = [];

app.get('/api/transcripts', (req, res) => {
  res.json(voiceTranscripts);
});

app.post('/api/transcripts', (req, res) => {
  const text = String(req.body.transcript || '').trim();
  const lang = String(req.body.language || 'hi-IN');
  if (!text) return res.status(400).json({ error: 'Missing transcript text' });
  const item = {
    id: voiceTranscripts.length + 1,
    transcript: text,
    language: lang,
    created_at: new Date().toISOString(),
  };
  voiceTranscripts.unshift(item);
  res.json({ ok: true, id: item.id, saved: true });
});

// Unmatched API routes -> 404 JSON (mirrors server.c)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Unknown API route' });
});

// ---------------------------------------------------------------------------
// Static frontend (public/)
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback: serve index.html for non-file, non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 8080;

if (!process.env.GEMINI_API_KEY) {
  console.warn('WARNING: GEMINI_API_KEY is not set. /api/gemma will be unavailable.');
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GramCare Node.js server: http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop.');
});
