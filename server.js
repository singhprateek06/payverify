
require("dotenv").config();

const express = require("express");
const multer = require("multer");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Image upload configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      return cb(null, true);
    }
    cb(new Error("Only image files are allowed."));
  },
});

// Shared OpenRouter request helper
async function callOpenRouter({ model, messages, temperature = 0.2 }) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    const err = new Error("OPENROUTER_API_KEY not configured in Render.");
    err.status = 500;
    throw err;
  }

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, temperature }),
      signal: AbortSignal.timeout(90000),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("OpenRouter error:", {
      status: response.status,
      message: data.error?.message || "Unknown API error",
      code: data.error?.code,
    });

    const err = new Error(
      data.error?.message || "OpenRouter request failed."
    );
    err.status = 502;
    throw err;
  }

  const content = data.choices?.[0]?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("The AI returned an empty response.");
  }

  return content.trim();
}

// Parse AI JSON safely
function parseAIJson(rawText) {
  const cleaned = rawText.replace(/```(?:json)?/gi, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }

    throw new Error("The AI response was not valid JSON.");
  }
}

// Exclude date/timestamp-related visual signals.
// Never infer that a screenshot is genuine just because
// all signals have been filtered out.
const EXCLUDED_TERMS = [
  "date", "time", "timestamp", "future", "past",
  "january", "february", "march", "april", "may",
  "june", "july", "august", "september", "october",
  "november", "december", "2024", "2025", "2026", "2027",
];

function cleanAnalysis(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Invalid AI analysis response.");
  }

  const verdicts = ["GENUINE", "FAKE", "UNCERTAIN"];
  const signalTypes = ["ok", "warn", "bad"];

  if (!verdicts.includes(result.verdict)) {
    result.verdict = "UNCERTAIN";
  }

  const confidence = Number(result.confidence);
  result.confidence = Number.isFinite(confidence)
    ? Math.max(0, Math.min(100, Math.round(confidence)))
    : 0;

  result.summary =
    typeof result.summary === "string"
      ? result.summary
      : "The screenshot could not be assessed reliably.";

  result.sender_name =
    typeof result.sender_name === "string"
      ? result.sender_name
      : "Unknown";

  result.detail =
    typeof result.detail === "string"
      ? result.detail
      : "Insufficient information for a reliable assessment.";

  result.signals = Array.isArray(result.signals)
    ? result.signals
        .filter((s) => s && typeof s.text === "string")
        .filter((s) => {
          const text = s.text.toLowerCase();
          return !EXCLUDED_TERMS.some((term) => text.includes(term));
        })
        .map((s) => ({
          type: signalTypes.includes(s.type) ? s.type : "warn",
          text: s.text,
        }))
    : [];

  return result;
}

const PROMPT = `
You are a digital forensics assistant examining Indian UPI
and banking payment screenshots.

Do not use dates or timestamps as evidence.

Examine:
1. Font consistency and text alignment.
2. Pixelation, blur, unusual edges and editing halos.
3. Checkmark, logo, icon and layout consistency.
4. Background artifacts and suspicious visual inconsistencies.
5. Amount and recipient text rendering.
6. Whether transaction identifiers look structurally plausible.
   Do not claim to have verified them against bank records.

Do not assume that a simple design, dark background or particular
font proves authenticity. Compression can create visual artifacts.

A screenshot alone cannot prove that a payment occurred.

Verdict rules:
- FAKE: multiple strong, concrete visual indicators of manipulation.
- UNCERTAIN: ambiguous evidence, insufficient evidence or poor image quality.
- GENUINE: no significant visual manipulation indicators detected.
  This is a visual assessment, not proof of payment.

Return ONLY valid JSON:
{
  "verdict": "GENUINE" | "FAKE" | "UNCERTAIN",
  "confidence": 0,
  "summary": "One clear sentence.",
  "sender_name": "Recipient name exactly as displayed, or Unknown",
  "signals": [
    {
      "type": "ok" | "warn" | "bad",
      "text": "A specific visual observation"
    }
  ],
  "detail": "Two or three sentences explaining the evidence and limitations."
}

Confidence describes confidence in the visual assessment,
not proof that a payment occurred.
`;

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Payment screenshot analysis
app.post("/api/analyze", upload.single("screenshot"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "No image uploaded. Use the field name screenshot.",
      });
    }

    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;

    const rawText = await callOpenRouter({
      model: "meta-llama/llama-4-maverick",
      temperature: 0.2,
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
    });

    const result = cleanAnalysis(parseAIJson(rawText));
    return res.json(result);
  } catch (err) {
    console.error("Analysis error:", err.message);

    return res.status(err.status || 500).json({
      error: err.message || "Screenshot analysis failed.",
    });
  }
});

// PayVerify chatbot
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body || {};

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Please provide a message." });
    }

    if (message.length > 4000) {
      return res.status(400).json({
        error: "Message is too long. Maximum 4000 characters.",
      });
    }

    const reply = await callOpenRouter({
      model: "meta-llama/llama-4-maverick:free",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: `You are PayVerify Assistant, an expert on Indian
UPI payment fraud and suspicious payment screenshots.
Explain visual checks, common fraud signs and why users should
verify incoming payments in their bank account or official payment app.
Keep replies under four sentences. Be friendly and practical.
Never claim that a screenshot proves payment.`,
        },
        { role: "user", content: message.trim() },
      ],
    });

    return res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err.message);

    return res.status(err.status || 500).json({
      error: err.message || "Chat request failed.",
    });
  }
});

// Handle image upload and request errors
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  console.error("Request error:", err.message);

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      error:
        err.code === "LIMIT_FILE_SIZE"
          ? "Image exceeds the 10 MB limit."
          : err.message,
    });
  }

  if (err.message === "Only image files are allowed.") {
    return res.status(400).json({ error: err.message });
  }

  return res.status(err.status || 500).json({
    error: err.message || "Internal server error.",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`PayVerify backend listening on port ${PORT}`);

  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("OPENROUTER_API_KEY is not configured.");
  }
});
