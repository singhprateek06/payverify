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

const PROMPT = `You are a highly specialized forensic payment screenshot analyst with deep expertise in Indian digital payment systems (UPI, NEFT, IMPS, RTGS) and apps including Google Pay, PhonePe, Paytm, BHIM, SBI YONO, HDFC, ICICI, Axis, Kotak.

Your job is to detect AI-generated, edited, or tampered payment screenshots with maximum accuracy.

CRITICAL CHECKS - examine each one very carefully:

1. FONT ANALYSIS
- Check if fonts match exactly with the official app font
- Look for mixed fonts in the same text block
- Check font weight inconsistencies
- Look for slightly different character spacing or kerning

2. PIXEL FORENSICS
- Look for compression artifacts around text and numbers
- Check for copy-paste residue (soft edges, halos around numbers)
- Look for mismatched JPEG compression levels in different areas
- Check if the background texture is consistent throughout

3. AMOUNT VERIFICATION
- Indian numbering system: 1,00,000 not 100,000
- Rupee symbol ₹ placement and size must match app standard
- Decimal points must be consistent
- Check if amount looks artificially inserted

4. TRANSACTION ID FORENSICS
- Google Pay: 12 digit numeric UTR
- PhonePe: alphanumeric starting with specific prefixes
- Paytm: specific format patterns
- NEFT/IMPS: specific bank UTR formats
- Flag any ID that looks randomly generated

5. LAYOUT FORENSICS
- Pixel perfect alignment — any misalignment is suspicious
- Check padding and margins are consistent with app version
- Button sizes and positions must match official app
- Check if any element looks slightly out of place

6. COLOR AND GRADIENT
- App brand colors must be exact hex values
- Gradients must match official app gradients
- Check for color banding or artificial gradients
- Success screen colors must match official app

7. AI GENERATION DETECTION
- AI generated images often have subtle texture inconsistencies
- Text in AI images often has slight waviness or inconsistency
- Logos in AI images are often slightly wrong
- Numbers in AI generated images are often malformed
- Check for unnatural smoothness in background

8. SHADOW AND DEPTH
- Check if shadows are consistent and natural
- UI elements must have consistent elevation shadows
- Artificially added elements often have wrong shadow direction

9. LOGO AND WATERMARK
- UPI logo must be pixel perfect
- App logos must match current version exactly
- NPCI watermark must be present and correct
- Check for blurry or slightly wrong logos

10. METADATA CONSISTENCY
- All text must be same rendering engine
- Check for inconsistent anti-aliasing
- Mixed rendering is a strong sign of tampering

VERDICT RULES:
- FAKE: if 2 or more suspicious signals found
- UNCERTAIN: if 1 suspicious signal found but not conclusive
- GENUINE: only if ALL checks pass with no suspicion

Be extremely strict. When in doubt, mark as FAKE or UNCERTAIN. A fake screenshot causing financial fraud is far worse than a false positive.

Important: Do NOT check or mention dates, timestamps, or time-related information under any circumstances. A past or future date is NOT a sign of tampering — ignore all dates completely.

Respond ONLY with a valid JSON object, no markdown, no backticks:
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