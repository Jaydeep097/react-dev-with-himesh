// ===== Background Service Worker =====
// Handles: Gemini API proxy, rate limiting, floating bar actions

// ===== Rate Limiter =====
const rateLimiter = {
  requests: [],
  maxRequests: 20, // max requests per window
  windowMs: 60_000, // 1 minute window

  canProceed() {
    const now = Date.now();
    this.requests = this.requests.filter((t) => now - t < this.windowMs);
    if (this.requests.length >= this.maxRequests) return false;
    this.requests.push(now);
    return true;
  },
};

// ===== Retry with Exponential Backoff =====
async function fetchWithRetry(url, options, retries = 3) {
  let delay = 250;

  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, options);

    if (res.ok) return res;

    // Retry on 429 (rate limit) or 5xx (server error)
    if ((res.status === 429 || res.status >= 500) && i < retries) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 2000);
      continue;
    }

    // Non-retryable error
    const body = await res.json().catch(() => ({}));
    const errMsg =
      body?.error?.message || `Gemini API error (${res.status})`;
    throw new Error(errMsg);
  }
}

// ===== Convert chat messages to Gemini format =====
// Input:  [{ role: "system"|"user", content: "..." }, ...]
// Output: { systemInstruction, contents } for Gemini API
function toGeminiFormat(messages) {
  let systemInstruction = null;
  const contents = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = { parts: [{ text: msg.content }] };
    } else {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }
  }

  return { systemInstruction, contents };
}

// ===== Gemini API Call =====
async function callGemini({ apiKey, model, messages, maxTokens }) {
  const { systemInstruction, contents } = toGeminiFormat(messages);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: maxTokens || 1024,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = systemInstruction;
  }

  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  const content =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  const usage = data.usageMetadata
    ? {
        promptTokens: data.usageMetadata.promptTokenCount || 0,
        candidatesTokens: data.usageMetadata.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata.totalTokenCount || 0,
      }
    : null;

  return { content: content.trim(), usage };
}

// ===== Message Router =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GEMINI_REQUEST") {
    if (!rateLimiter.canProceed()) {
      sendResponse({ error: "Rate limit reached. Please wait a moment." });
      return true;
    }

    callGemini(message.payload)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));

    return true; // keep channel open for async response
  }

  if (message.type === "FLOATING_BAR_ACTION") {
    if (!rateLimiter.canProceed()) {
      sendResponse({ error: "Rate limit reached. Try again shortly." });
      return true;
    }

    // Load settings and process the floating bar action
    chrome.storage.local.get(
      { apiKey: "", model: "gemini-2.0-flash", consent: true },
      (settings) => {
        if (!settings.apiKey) {
          sendResponse({
            error: "No API key. Open extension popup \u2192 Settings.",
          });
          return;
        }
        if (!settings.consent) {
          sendResponse({
            error: "Consent disabled. Enable in extension settings.",
          });
          return;
        }

        let systemPrompt;
        if (message.action === "rewrite") {
          systemPrompt = `Rewrite the following text with a ${message.tone || "neutral"} tone. Preserve original meaning. Return only the rewritten text.`;
        } else {
          systemPrompt =
            "Summarize the following text in 2-3 concise sentences. Return only the summary.";
        }

        const messages = [
          { role: "system", content: systemPrompt },
          { role: "user", content: message.text.slice(0, 4000) }, // truncate large input
        ];

        callGemini({
          apiKey: settings.apiKey,
          model: settings.model,
          messages,
          maxTokens: 512,
        })
          .then((result) => sendResponse(result))
          .catch((err) => sendResponse({ error: err.message }));
      },
    );

    return true;
  }
});
