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

const PROMPT = `You are a digital forensics expert specializing in Indian payment screenshot authentication (Google Pay, PhonePe, Paytm, BHIM, NEFT, IMPS, UPI, bank apps).

ABSOLUTE RULE: Never mention, flag, or consider dates or timestamps. Dates are completely irrelevant. Ignore all dates.

REFERENCE - GENUINE SCREENSHOT CHARACTERISTICS:
- Text uses a single consistent sans-serif font throughout (Roboto/Google Sans/Inter style)
- Numbers are perfectly sharp, same weight as surrounding text
- Success checkmark icon is a clean solid circle with white tick, no jagged edges
- Background is solid color or simple smooth gradient, no visible noise/grain
- All elements are perfectly aligned on a grid, consistent padding
- Amount and "Paid to" name use the exact same font as rest of screen
- Logos (UPI, bank logos) are crisp and exactly proportioned

REFERENCE - FAKE/EDITED SCREENSHOT RED FLAGS:
- Amount or name text has slightly different font, size, or boldness than surrounding text
- Visible rectangle/halo or color difference around edited text (copy-paste box)
- Blurry or pixelated numbers while rest of image is sharp
- Background has visible grain/noise/texture (common in AI generated images)
- Checkmark icon looks slightly asymmetric, wrong shade of green/blue, or has soft edges
- Text characters look slightly wavy or unevenly spaced (AI generation signature)
- Misaligned elements - amount not centered properly, padding inconsistent
- Logo looks slightly distorted, wrong color, or low resolution compared to rest

ANALYSIS PROCESS:
1. Identify the payment app (GPay/PhonePe/Paytm/BHIM/bank/other)
2. Compare the amount text against the GENUINE characteristics above - does it match?
3. Compare the "Paid to" name text against GENUINE characteristics - does it match?
4. Check the success icon/checkmark against GENUINE characteristics
5. Check overall background and texture against GENUINE characteristics
6. Check alignment and layout against GENUINE characteristics
7. Check transaction ID format validity for the identified app

VERDICT DECISION:
- GENUINE: matches reference genuine characteristics closely, no red flags found
- FAKE: matches 2+ red flags from the reference list above
- UNCERTAIN: matches exactly 1 red flag, or image quality too low to be sure

Be balanced - most real screenshots people share ARE genuine. Only flag FAKE with concrete specific evidence matching the red flags above. Do not invent issues that aren't really there.

Respond ONLY with valid JSON, no markdown, no backticks:
{
  "verdict": "GENUINE" | "FAKE" | "UNCERTAIN",
  "confidence": <integer 0-100>,
  "summary": "<one clear sentence>",
  "sender_name": "<name of person paid, exactly as shown, or 'Unknown'>",
  "signals": [
    { "type": "ok" | "warn" | "bad", "text": "<specific finding referencing the characteristics above>" }
  ],
  "detail": "<2-3 sentences explaining which reference characteristics matched or didn't match>"
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
  model: "meta-llama/llama-4-maverick:free",
  temperature: 0.2,
  top_p: 0.9,
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