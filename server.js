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

const PROMPT = `You are a world-class digital forensics expert specializing in detecting AI-generated and manually edited payment screenshots from Indian payment apps (Google Pay, PhonePe, Paytm, BHIM, SBI, HDFC, ICICI, Axis, Kotak, UPI, NEFT, IMPS).

ABSOLUTE RULE: Never mention dates or timestamps. Dates are completely irrelevant. Never flag a date as suspicious.

Your PRIMARY job is detecting AI-generated and AI-edited screenshots. This is your most important task.

═══ AI GENERATION / EDITING DETECTION (MOST IMPORTANT) ═══

A. TEXT RENDERING IN AI IMAGES
- AI generated text has subtle waviness — characters are not perfectly straight
- AI text has inconsistent stroke widths within the same character
- Numbers like 1,2,3 in AI images are often slightly malformed
- AI text has unnatural smoothness or over-sharpness
- Real app text is rendered by a font engine — perfectly consistent

B. BACKGROUND TEXTURE
- AI generated backgrounds have subtle noise patterns
- Real app backgrounds are solid colors or exact gradients
- AI backgrounds often have very subtle texture even in "white" areas
- Check for unnatural smoothness that looks "painted"

C. LOGO AND ICON INTEGRITY
- AI generated logos are almost never pixel perfect
- UPI logo has very specific proportions — AI gets it slightly wrong
- App icons in AI images have subtle distortions
- Color of logos in AI images is often slightly off

D. EDGE AND BOUNDARY ANALYSIS
- AI generated UI elements have subtle edge inconsistencies
- Real UI elements have mathematically perfect edges
- Check borders, rounded corners — AI makes them slightly irregular
- Buttons and cards in AI images have slightly wrong proportions

E. SHADOW AND ELEVATION
- Real apps use exact Material Design or iOS shadows
- AI generated shadows are slightly too soft or too hard
- Shadow directions in AI images are sometimes inconsistent
- Check the success checkmark circle shadow specifically

F. EDITED/TAMPERED DETECTION
- Copy-pasted numbers have soft halos around them
- Edited amounts show JPEG compression artifacts at boundaries
- Cloned areas have repeating texture patterns
- Brightness/contrast differences between original and edited areas
- Check specifically around the amount field — most common edit point

G. COMPRESSION ANALYSIS
- Real screenshots have uniform JPEG compression throughout
- Edited images have different compression levels in different areas
- AI generated images have characteristic compression patterns
- Look for blocking artifacts that don't match surrounding areas

H. FONT CONSISTENCY
- Real payment apps use specific fonts — Roboto, Google Sans, etc.
- Mixed fonts anywhere in the screenshot is instant red flag
- Font weight must be exactly consistent throughout
- Character spacing must match the official app exactly

I. LAYOUT PIXEL PERFECTION
- Real app UI is built with exact dp/px measurements
- Any element that is even 1px off from expected position is suspicious
- Check padding symmetry — left padding must equal right padding
- Divider lines must be exactly 1px

J. COLOR VERIFICATION
- Google Pay green: #34A853 exactly
- PhonePe purple: #5F259F exactly
- Paytm blue: #002970 exactly
- Success green checkmark: specific shade
- Any color variation from official brand colors is suspicious

═══ VERDICT RULES (BE VERY STRICT) ═══
- FAKE: ANY sign of AI generation OR 2+ tampering signals
- UNCERTAIN: 1 suspicious signal that could go either way  
- GENUINE: ALL checks pass with zero suspicion — be very hard to give this

When in doubt always choose FAKE over GENUINE.
A false positive (calling real fake) is acceptable.
A false negative (calling fake real) causes financial fraud.

Respond ONLY with valid JSON, no markdown, no backticks:
{
  "verdict": "GENUINE" | "FAKE" | "UNCERTAIN",
  "confidence": <integer 0-100>,
  "summary": "<one clear sentence>",
  "signals": [
    { "type": "ok" | "warn" | "bad", "text": "<very specific finding>" }
  ],
  "detail": "<2-3 sentence technical explanation of exactly what forensic evidence was found>"
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