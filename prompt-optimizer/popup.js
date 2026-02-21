// ===== DOM References =====
const $ = (id) => document.getElementById(id);

const input = $("input");
const optimizeBtn = $("optimize");
const btnText = optimizeBtn.querySelector(".btn-text");
const spinner = optimizeBtn.querySelector(".spinner");
const compareView = $("compare-view");
const originalText = $("original-text");
const rewrittenText = $("rewritten-text");
const rewriteActions = $("rewrite-actions");
const errorMsg = $("error-msg");
const tokenInfo = $("token-info");

// ===== Tab Navigation =====
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.remove("active");
      t.setAttribute("aria-selected", "false");
    });
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));

    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");
    $("tab-" + tab.dataset.tab).classList.remove("hidden");
  });
});

// ===== Helpers =====
function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideError(el) {
  el.classList.add("hidden");
}

function setLoading(loading) {
  optimizeBtn.disabled = loading;
  btnText.textContent = loading ? "Processing..." : "Optimize with AI";
  spinner.classList.toggle("hidden", !loading);
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function sanitizeInput(text) {
  return text.replace(/\s+/g, " ").trim();
}

// ===== Settings Management =====
const DEFAULTS = {
  apiKey: "",
  model: "gemini-2.0-flash",
  localHistory: true,
  consent: true,
  floatingBar: true,
};

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULTS, (data) => resolve(data));
  });
}

async function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set(settings, resolve);
  });
}

// Load settings into UI on popup open
(async () => {
  const s = await loadSettings();
  $("api-key").value = s.apiKey;
  $("model-select").value = s.model;
  $("local-history").checked = s.localHistory;
  $("consent-toggle").checked = s.consent;
  $("floating-bar-toggle").checked = s.floatingBar;

  // Restore last prompt
  chrome.storage.local.get("lastPrompt", (data) => {
    if (data.lastPrompt) input.value = data.lastPrompt;
  });
})();

$("save-settings").addEventListener("click", async () => {
  const settings = {
    apiKey: $("api-key").value.trim(),
    model: $("model-select").value,
    localHistory: $("local-history").checked,
    consent: $("consent-toggle").checked,
    floatingBar: $("floating-bar-toggle").checked,
  };
  await saveSettings(settings);
  $("settings-status").textContent = "Settings saved.";
  setTimeout(() => ($("settings-status").textContent = ""), 2000);

  // Notify content scripts about floating bar toggle
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "TOGGLE_FLOATING_BAR",
        visible: settings.floatingBar,
      }).catch(() => {});
    }
  });
});

// ===== Gemini API Call (via background service worker) =====
async function callGemini(messages, maxTokens = 1024) {
  const settings = await loadSettings();

  if (!settings.apiKey) {
    throw new Error("No API key set. Go to Settings tab and add your Gemini key.");
  }
  if (!settings.consent) {
    throw new Error("Text processing disabled. Enable consent in Settings.");
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "GEMINI_REQUEST",
        payload: {
          apiKey: settings.apiKey,
          model: settings.model,
          messages,
          maxTokens,
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      }
    );
  });
}

// ===== Rewrite Feature =====
optimizeBtn.addEventListener("click", async () => {
  const text = sanitizeInput(input.value);
  if (!text) {
    showError(errorMsg, "Please enter a prompt first.");
    return;
  }

  hideError(errorMsg);
  setLoading(true);
  compareView.classList.add("hidden");
  rewriteActions.classList.add("hidden");
  tokenInfo.classList.add("hidden");

  const tone = $("tone").value;
  const length = $("length").value;
  const formality = $("formality").value;

  const systemPrompt = [
    "You are an expert prompt engineer and text rewriter.",
    "Rewrite the user's text according to these instructions:",
    `- Tone: ${tone}`,
    `- Length: ${length === "same" ? "keep roughly the same length" : length}`,
    `- Formality: ${formality === "auto" ? "match the original" : formality}`,
    "- Preserve the original meaning. Do not add new facts.",
    "- If you detect PII (emails, phone numbers, addresses), note it but preserve it.",
    "- Return ONLY the rewritten text, no explanations.",
  ].join("\n");

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: text },
  ];

  try {
    const result = await callGemini(messages);
    const rewritten = result.content;
    const usage = result.usage;

    // Show compare view
    originalText.textContent = text;
    rewrittenText.textContent = rewritten;
    compareView.classList.remove("hidden");
    rewriteActions.classList.remove("hidden");

    // Token info
    if (usage) {
      tokenInfo.textContent = `Tokens: ${usage.promptTokens} in / ${usage.candidatesTokens} out (${usage.totalTokens} total)`;
      tokenInfo.classList.remove("hidden");
    }

    // Save to local history
    const settings = await loadSettings();
    if (settings.localHistory) {
      chrome.storage.local.set({ lastPrompt: text });
    }
  } catch (err) {
    showError(errorMsg, err.message);
  } finally {
    setLoading(false);
  }
});

// Copy rewritten text
$("copy").addEventListener("click", () => {
  const text = rewrittenText.textContent;
  navigator.clipboard.writeText(text).then(() => {
    $("copy").textContent = "Copied!";
    setTimeout(() => ($("copy").textContent = "Copy Result"), 1500);
  });
});

// Replace selection on page
$("replace-selection").addEventListener("click", () => {
  const text = rewrittenText.textContent;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "REPLACE_SELECTION",
        text,
      }).catch(() => {
        showError(errorMsg, "Could not replace text on page. Content script may not be loaded.");
      });
    }
  });
});

// ===== Extract Feature =====
let capturedText = "";

$("capture-selection").addEventListener("click", () => {
  hideError($("extract-error"));

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;

    chrome.tabs.sendMessage(tabs[0].id, { type: "GET_SELECTION" }, (response) => {
      if (chrome.runtime.lastError) {
        showError($("extract-error"), "Could not capture selection. Try refreshing the page.");
        return;
      }
      if (!response?.text) {
        showError($("extract-error"), "No text selected on the page.");
        return;
      }

      capturedText = sanitizeInput(response.text);
      $("captured-text").textContent = capturedText;
      $("extract-preview").classList.remove("hidden");
      $("extract-controls").style.display = "flex";
    });
  });
});

async function processExtraction(mode) {
  if (!capturedText) return;
  hideError($("extract-error"));

  const prompts = {
    summary: "Summarize the following text in 2-3 concise sentences. Return only the summary.",
    bullets: "Convert the following text into clear, concise bullet points. Return only the bullet points, each starting with a dash (-).",
    "key-ideas": "Extract the 3-5 key ideas from the following text. Return each key idea on its own line, numbered.",
  };

  const messages = [
    { role: "system", content: prompts[mode] },
    { role: "user", content: capturedText },
  ];

  try {
    $("extract-output").classList.add("hidden");
    const result = await callGemini(messages, 512);
    $("extract-result").textContent = result.content;
    $("extract-output").classList.remove("hidden");
  } catch (err) {
    showError($("extract-error"), err.message);
  }
}

$("summarize").addEventListener("click", () => processExtraction("summary"));
$("bulletize").addEventListener("click", () => processExtraction("bullets"));
$("key-ideas").addEventListener("click", () => processExtraction("key-ideas"));

$("copy-extract").addEventListener("click", () => {
  navigator.clipboard.writeText($("extract-result").textContent).then(() => {
    $("copy-extract").textContent = "Copied!";
    setTimeout(() => ($("copy-extract").textContent = "Copy"), 1500);
  });
});
