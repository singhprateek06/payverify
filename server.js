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

const PROMPT = `You are an expert payment fraud detection system specializing in Indian digital payments (UPI, NEFT, IMPS, RTGS, and bank apps like Google Pay, PhonePe, Paytm, BHIM, SBI, HDFC, ICICI).

ABSOLUTE RULE: Never mention dates or timestamps. Dates are completely irrelevant. Never flag a date as suspicious.

Analyze this payment screenshot for signs of tampering or forgery.

Examine these factors:
1. Font consistency — fonts must be uniform and match the app standard
2. Pixel artifacts — look for irregular edges or copy-paste artifacts around amounts
3. Layout and spacing — misaligned elements or uneven padding
4. Color inconsistencies — wrong brand colors or gradient mismatches
5. Transaction ID format — must match UPI/bank specific patterns
6. Amount formatting — correct Indian numbering and rupee symbol
7. Logo and watermark integrity — app logos must be correct
8. AI generation signs — unnatural text rendering, wrong logo proportions, inconsistent edges

VERDICT RULES:
- GENUINE: screenshot looks authentic with 1-2 suspicious signals
- UNCERTAIN: 3 minor suspicious signals but not conclusive
- FAKE: clear evidence of tampering, editing, or AI generation

Only mark as FAKE when there is strong clear evidence. When in doubt use UNCERTAIN not FAKE.

Respond ONLY with valid JSON, no markdown, no backticks:
{
  "verdict": "GENUINE" | "FAKE" | "UNCERTAIN",
  "confidence": <integer 0-100>,
  "summary": "<one clear sentence>",
  "signals": [
    { "type": "ok" | "warn" | "bad", "text": "<specific finding>" }
  ],
  "detail": "<2-3 sentence technical explanation>"
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

app.listen(PORT, () => {
  console.log(`\n✅ PayVerify backend running at http://localhost:${PORT}`);
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("⚠️  WARNING: OPENROUTER_API_KEY not set.\n");
  }
});