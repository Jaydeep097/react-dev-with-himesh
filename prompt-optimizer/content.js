// ===== Content Script: Floating Bar, Selection Capture, Text Replacement =====

let floatingBar = null;

// ===== Floating Assistant Bar =====
function createFloatingBar() {
  if (floatingBar) return;

  floatingBar = document.createElement("div");
  floatingBar.id = "po-floating-bar";

  floatingBar.innerHTML = `
    <div id="po-bar-inner">
      <span id="po-bar-label">Prompt Optimizer</span>
      <select id="po-bar-tone" aria-label="Tone">
        <option value="neutral">Neutral</option>
        <option value="formal">Formal</option>
        <option value="casual">Casual</option>
        <option value="persuasive">Persuasive</option>
        <option value="friendly">Friendly</option>
      </select>
      <button id="po-bar-rewrite" title="Rewrite selected text">Rewrite</button>
      <button id="po-bar-summarize" title="Summarize selected text">Summarize</button>
      <button id="po-bar-collapse" title="Minimize bar">_</button>
    </div>
    <div id="po-bar-result" style="display:none">
      <div id="po-bar-result-text"></div>
      <div id="po-bar-result-actions">
        <button id="po-bar-copy">Copy</button>
        <button id="po-bar-close-result">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(floatingBar);
  bindBarEvents();
}

function removeFloatingBar() {
  if (floatingBar) {
    floatingBar.remove();
    floatingBar = null;
  }
}

function bindBarEvents() {
  const collapseBtn = document.getElementById("po-bar-collapse");
  const inner = document.getElementById("po-bar-inner");
  let collapsed = false;

  collapseBtn.addEventListener("click", () => {
    collapsed = !collapsed;
    if (collapsed) {
      inner.classList.add("po-collapsed");
      collapseBtn.textContent = "+";
    } else {
      inner.classList.remove("po-collapsed");
      collapseBtn.textContent = "_";
    }
  });

  document.getElementById("po-bar-rewrite").addEventListener("click", () => {
    const sel = window.getSelection()?.toString()?.trim();
    if (!sel) return showBarResult("Select text on the page first.");

    const tone = document.getElementById("po-bar-tone").value;
    chrome.runtime.sendMessage(
      {
        type: "FLOATING_BAR_ACTION",
        action: "rewrite",
        text: sel,
        tone,
      },
      handleBarResponse,
    );
    showBarResult("Processing...");
  });

  document.getElementById("po-bar-summarize").addEventListener("click", () => {
    const sel = window.getSelection()?.toString()?.trim();
    if (!sel) return showBarResult("Select text on the page first.");

    chrome.runtime.sendMessage(
      {
        type: "FLOATING_BAR_ACTION",
        action: "summarize",
        text: sel,
      },
      handleBarResponse,
    );
    showBarResult("Processing...");
  });

  document.getElementById("po-bar-copy").addEventListener("click", () => {
    const text = document.getElementById("po-bar-result-text").textContent;
    navigator.clipboard.writeText(text);
    document.getElementById("po-bar-copy").textContent = "Copied!";
    setTimeout(() => {
      document.getElementById("po-bar-copy").textContent = "Copy";
    }, 1500);
  });

  document
    .getElementById("po-bar-close-result")
    .addEventListener("click", () => {
      document.getElementById("po-bar-result").style.display = "none";
    });
}

function showBarResult(text) {
  const result = document.getElementById("po-bar-result");
  const resultText = document.getElementById("po-bar-result-text");
  resultText.textContent = text;
  result.style.display = "block";
}

function handleBarResponse(response) {
  if (!response) return showBarResult("Error: No response from extension.");
  if (response.error) return showBarResult("Error: " + response.error);
  showBarResult(response.content);
}

// ===== Message Listener =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "GET_SELECTION": {
      const text = window.getSelection()?.toString()?.trim() || "";
      sendResponse({ text });
      break;
    }

    case "REPLACE_SELECTION": {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(message.text));
        selection.removeAllRanges();
      }
      sendResponse({ success: true });
      break;
    }

    case "TOGGLE_FLOATING_BAR": {
      if (message.visible) {
        createFloatingBar();
      } else {
        removeFloatingBar();
      }
      sendResponse({ success: true });
      break;
    }
  }
  return true;
});

// ===== Initialize =====
chrome.storage.local.get({ floatingBar: true }, (data) => {
  if (data.floatingBar) {
    createFloatingBar();
  }
});
