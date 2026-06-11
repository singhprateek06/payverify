const express = require("express");
const multer = require("multer");
const cors = require("cors");

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"), false);
  },
});

const PROMPT = `You are a forensic image analyst specializing in Indian digital payment screenshots. You have deep knowledge of UI patterns, typography, and visual forensics for UPI apps (Google Pay, PhonePe, Paytm, BHIM) and banking apps (SBI YONO, HDFC, ICICI, Axis, Kotak).

CONTEXT: Merchants and individuals use this tool to verify if a payment screenshot shown to them is genuine before releasing goods or services. False negatives (calling FAKE → GENUINE) are costly. Be thorough.

═══════════════════════════════════════
PHASE 1 — APP IDENTIFICATION
═══════════════════════════════════════
First identify the app from visual cues: logo, color scheme, layout structure, typography, and UI chrome. If you cannot identify the app with reasonable confidence, flag this itself as a warning signal.

═══════════════════════════════════════  
PHASE 2 — FORENSIC CHECKLIST
═══════════════════════════════════════
Run ALL of these checks. Each must produce a finding — do not skip any:

TYPOGRAPHY
□ T1: Font family matches app standard (e.g., Google Sans for GPay, Roboto for PhonePe)
□ T2: Font weight is consistent across all text elements
□ T3: No character spacing anomalies (stretched/compressed letters)
□ T4: Text rendering quality matches rest of screenshot (anti-aliasing uniformity)

AMOUNT INTEGRITY
□ A1: Rupee symbol (₹) renders correctly — not a generic currency glyph
□ A2: Amount uses Indian numbering system correctly (e.g., ₹1,00,000 not ₹100,000)
□ A3: Amount decimal alignment and font weight matches app standard
□ A4: Amount size/prominence is proportional to app's usual layout

PIXEL & LAYER FORENSICS
□ P1: No double-compression artifacts (JPEG blocks at different resolutions in same zone)
□ P2: No halo or glow around text (sign of layer compositing)
□ P3: Background texture/gradient is continuous — no seams or discontinuities
□ P4: Shadow and elevation effects on cards are physically consistent
□ P5: No noise pattern mismatch between different regions

TRANSACTION METADATA
□ M1: Transaction ID format matches app (GPay: ~16 alphanum, UPI Ref: 12-digit numeric, IMPS: 12-digit)
□ M2: Bank reference numbers follow RBI/NPCI digit conventions
□ M3: Receiver/sender name doesn't overflow or get truncated unnaturally
□ M4: Status label (Paid / Sent / Successful) uses exact app vocabulary and color

LAYOUT & ALIGNMENT
□ L1: All text baselines align to the app's grid
□ L2: Padding and margins are consistent with app's design system
□ L3: Dividers, separators, and borders match app's weight and color
□ L4: Status icons/checkmarks use correct app iconography and size

BRAND INTEGRITY
□ B1: App logo/icon dimensions and proportions match official asset
□ B2: Brand colors match exactly (hex precision — not approximate)
□ B3: No gradient artifacts or color banding in brand elements

AI GENERATION SIGNALS
□ G1: Text edges are crisp (AI-generated text often has soft/blurry edges)
□ G2: No hallucinated UI elements that don't belong in the real app
□ G3: Icon/logo proportions are exact — AI often distorts these subtly
□ G4: Repeated elements (e.g., dividers) are pixel-identical, not AI-varied

═══════════════════════════════════════
PHASE 3 — VERDICT LOGIC
═══════════════════════════════════════
Count your findings by severity:

CRITICAL flaws (any one = strong evidence of FAKE):
- Amount text shows compositing halo or different JPEG compression block
- Transaction ID doesn't match any known real-world format
- Brand colors are measurably wrong
- AI generation artifacts on text or logos
- Layout elements physically impossible in the real app

MODERATE flaws (5+ = UNCERTAIN, 6+ = lean FAKE):
- Font inconsistency in non-amount areas
- Minor pixel noise differences between regions
- Slightly off icon proportions

MINOR flaws (cosmetic, may appear in genuine screenshots due to phone screenshots):
- Slight JPEG compression loss uniformly across image
- Status bar clock/battery visible or not

VERDICT ASSIGNMENT:
- GENUINE: 0 critical, ≤1 moderate, any minor
- UNCERTAIN: 0 critical, 2-3 moderate OR 1 moderate + multiple minor
- FAKE: 1+ critical OR 4+ moderate

═══════════════════════════════════════
ABSOLUTE RULES
═══════════════════════════════════════
- NEVER mention dates, times, or timestamps — completely irrelevant
- NEVER flag screenshot resolution alone as suspicious
- NEVER flag visible status bar as suspicious
- DO flag when you cannot confidently identify the app
- If the image is too low quality to analyze, verdict = UNCERTAIN with explanation

═══════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════
Respond ONLY with valid JSON, no markdown, no backticks:

{
  "app_identified": "<app name or 'Unknown'>",
  "app_confidence": <integer 0-100>,
  "verdict": "GENUINE" | "FAKE" | "UNCERTAIN",
  "confidence": <integer 0-100>,
  "summary": "<one clear sentence stating the key reason for verdict>",
  "signals": [
    {
      "type": "ok" | "warn" | "bad",
      "check": "<check code e.g. A3, P2>",
      "text": "<specific, concrete finding — not vague>"
    }
  ],
  "critical_flags": ["<list any critical flaws found, empty array if none>"],
  "detail": "<3-4 sentences of technical explanation citing the most important evidence>"
}`;

app.post("/api/analyze", upload.single("screenshot"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file uploaded." });
    }

    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "OPENROUTER_API_KEY not set." });
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-maverick",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                },
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenRouter error:", JSON.stringify(data));
      throw new Error(data.error?.message || "OpenRouter API error");
    }

    const rawText = data.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      const clean = rawText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(clean);
      // Filter out any date related signals
if (parsed.signals) {
  parsed.signals = parsed.signals.filter(s => {
    const text = (s.text || '').toLowerCase();
    return !text.includes('date') && 
           !text.includes('time') && 
           !text.includes('future') && 
           !text.includes('past') &&
           !text.includes('june') &&
           !text.includes('january') &&
           !text.includes('february') &&
           !text.includes('march') &&
           !text.includes('april') &&
           !text.includes('may') &&
           !text.includes('july') &&
           !text.includes('august') &&
           !text.includes('september') &&
           !text.includes('october') &&
           !text.includes('november') &&
           !text.includes('december') &&
           !text.includes('2024') &&
           !text.includes('2025') &&
           !text.includes('2026') &&
           !text.includes('2027');
  });
}

// Fix verdict if only reason was date
if (parsed.signals && parsed.signals.length === 0 && 
    (parsed.summary || '').toLowerCase().includes('date')) {
  parsed.verdict = 'GENUINE';
  parsed.confidence = 75;
  parsed.summary = 'Screenshot appears authentic based on visual analysis.';
}

// Clean date mentions from summary and detail
if (parsed.summary) {
  parsed.summary = parsed.summary.replace(/\b\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/gi, '');
}
    } catch (e) {
      return res.status(500).json({ error: "Failed to parse AI response.", raw: rawText });
    }

    res.json(parsed);
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const apiKey = process.env.OPENROUTER_API_KEY;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-maverick:free",
        messages: [
          {
            role: "system",
            content: `You are PayVerify Assistant, a helpful expert on Indian UPI/payment fraud and how to spot fake payment screenshots. 
            Help users understand how PayVerify works, give tips on spotting fake screenshots, and advise what to do if they receive a fake payment.
            Keep responses under 4 sentences. Be friendly and practical.
            PayVerify checks: font consistency, pixel artifacts, layout, colors, transaction ID format, amount formatting, and logos.`
          },
          { role: "user", content: message }
        ]
      }),
    });

    const data = await response.json();
console.log("OpenRouter chat response:", JSON.stringify(data));

if (data.error) {
  return res.json({ reply: "Error: " + data.error.message });
}

const reply = data.choices?.[0]?.message?.content || "Sorry, I could not process that.";
res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.listen(PORT, () => {
  console.log(`\n✅ PayVerify backend running at http://localhost:${PORT}`);
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("⚠️  WARNING: OPENROUTER_API_KEY not set.\n");
  }
});