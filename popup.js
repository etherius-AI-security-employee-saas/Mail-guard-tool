const resultEl = document.getElementById("result");
const scanButton = document.getElementById("scanButton");
const autoScanToggle = document.getElementById("autoScanToggle");
const localAiToggle = document.getElementById("localAiToggle");
const modeSelect = document.getElementById("modeSelect");
const modeStat = document.getElementById("modeStat");
const scanModePill = document.getElementById("scanModePill");
const licenseInput = document.getElementById("licenseInput");
const licenseStatus = document.getElementById("licenseStatus");
const historyList = document.getElementById("historyList");
const totalScans = document.getElementById("totalScans");
const historyCount = document.getElementById("historyCount");
const engineStatus = document.getElementById("engineStatus");

const RISK = {
  safe: { label: "SAFE", className: "safe" },
  suspicious: { label: "SUSPICIOUS", className: "warning" },
  warning: { label: "WARNING", className: "warning" },
  danger: { label: "DANGER", className: "danger" },
  loading: { label: "SCANNING", className: "" },
  error: { label: "ERROR", className: "danger" },
  limit: { label: "LIMIT", className: "warning" }
};

chrome.storage.local.get(["autoScan", "licenseKey", "scanCount", "history", "protectionMode", "localAiEnabled"], (data) => {
  autoScanToggle.checked = data.autoScan !== false;
  localAiToggle.checked = data.localAiEnabled !== false;
  modeSelect.value = data.protectionMode || "balanced";
  updateModeUi(modeSelect.value);
  licenseInput.value = data.licenseKey || "";
  totalScans.textContent = data.scanCount || 0;
  renderHistory(data.history || []);
});

scanButton.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isSupported = tab && (
    tab.url.includes("mail.google.com") ||
    tab.url.includes("outlook.live.com") ||
    tab.url.includes("outlook.office.com")
  );

  if (!isSupported) {
    renderResult({
      riskLevel: "error",
      summary: "Open Gmail or Outlook, then select an email before running EmailGuard.",
      flags: [],
      reasons: [],
      recommendation: ""
    });
    return;
  }

  setBusy(true);
  renderResult({
    riskLevel: "loading",
    summary: "Deep scanning this email with the local AI engine and cloud verification.",
    flags: [],
    reasons: [],
    recommendation: ""
  });

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "MANUAL_SCAN" });
    if (response?.result) {
      renderResult(response.result);
      updateEngine(response.result.engineStatus || "online");
    }
    refreshMetrics();
  } catch (_error) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
      setTimeout(async () => {
        try {
          const retryResponse = await chrome.tabs.sendMessage(tab.id, { type: "MANUAL_SCAN" });
          if (retryResponse?.result) {
            renderResult(retryResponse.result);
            updateEngine(retryResponse.result.engineStatus || "online");
          }
          refreshMetrics();
        } catch (_retryError) {
          renderResult({
            riskLevel: "error",
            summary: "EmailGuard could not attach to this mail tab. Reload the page and try again.",
            flags: [],
            reasons: [],
            recommendation: ""
          });
          updateEngine("degraded");
        } finally {
          setBusy(false);
        }
      }, 450);
      return;
    } catch (_secondError) {
      renderResult({
        riskLevel: "error",
        summary: "EmailGuard could not attach to this mail tab. Reload the page and try again.",
        flags: [],
        reasons: [],
        recommendation: ""
      });
      updateEngine("degraded");
    }
  }

  setBusy(false);
});

autoScanToggle.addEventListener("change", () => {
  const enabled = autoScanToggle.checked;
  chrome.storage.local.set({ autoScan: enabled });
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "UPDATE_AUTOSCAN", value: enabled }, () => {});
    }
  });
});

localAiToggle.addEventListener("change", () => {
  chrome.storage.local.set({ localAiEnabled: localAiToggle.checked }, () => {
    licenseStatus.textContent = localAiToggle.checked
      ? "Local AI decision engine enabled."
      : "Local AI decision engine disabled.";
    licenseStatus.className = "license-status";
    updateEngine(localAiToggle.checked ? "online" : "cloud-first");
  });
});

document.getElementById("saveModeButton").addEventListener("click", () => {
  const value = modeSelect.value;
  chrome.storage.local.set({ protectionMode: value }, () => {
    updateModeUi(value);
    licenseStatus.textContent = `Protection mode saved: ${toLabel(value)}.`;
    licenseStatus.className = "license-status";
  });
});

document.getElementById("saveLicenseButton").addEventListener("click", () => {
  const key = licenseInput.value.trim();
  chrome.storage.local.set({ licenseKey: key }, () => {
    licenseStatus.textContent = key ? "License key saved." : "License key cleared.";
    licenseStatus.className = `license-status ${key ? "safe" : ""}`;
  });
});

function setBusy(busy) {
  scanButton.disabled = busy;
  scanButton.textContent = busy ? "Scanning..." : "Scan Current Email";
}

function refreshMetrics() {
  chrome.storage.local.get(["scanCount", "history"], (data) => {
    totalScans.textContent = data.scanCount || 0;
    renderHistory(data.history || []);
  });
}

function updateEngine(state) {
  const labels = {
    online: "Online",
    degraded: "Degraded",
    "local-ai-only": "Local AI",
    "local-plus-cloud": "Hybrid AI",
    "cloud-first": "Cloud First"
  };
  const normalized = String(state || "online").replaceAll(" / cached", "");
  engineStatus.textContent = labels[normalized] || normalized.replaceAll("-", " ").toUpperCase();
}

function updateModeUi(value) {
  const compact = {
    strict: "STR",
    balanced: "BAL",
    relaxed: "RLX"
  };
  modeStat.textContent = compact[value] || "BAL";
  scanModePill.textContent = toLabel(value);
}

function toLabel(value) {
  return String(value || "balanced").charAt(0).toUpperCase() + String(value || "balanced").slice(1);
}

function renderResult(result) {
  const ui = RISK[result.riskLevel] || RISK.suspicious;
  const flags = Array.isArray(result.flags) ? result.flags.slice(0, 4) : [];
  const reasons = Array.isArray(result.reasons) ? result.reasons.slice(0, 3) : [];
  resultEl.className = "result show";
  resultEl.innerHTML = `
    <div class="result-head">
      <span class="${ui.className}">${ui.label}</span>
      ${typeof result.score === "number" ? `<span class="result-score">${result.score}/100</span>` : ""}
    </div>
    <p class="result-summary">${escapeHtml(result.summary || "")}</p>
    ${result.isInternshipScam ? `<div class="verdict">High-priority internship or opportunity scam indicators were detected. Treat this email as untrusted until independently verified.</div>` : ""}
    ${result.verdict ? `<div class="verdict">${escapeHtml(result.verdict)}</div>` : ""}
    ${reasons.length ? `<div class="reason-list">${reasons.map((reason) => `<div class="reason">${escapeHtml(reason)}</div>`).join("")}</div>` : ""}
    ${result.recommendation ? `<div class="hint">${escapeHtml(result.recommendation)}</div>` : ""}
    ${flags.length ? `<div class="flags">${flags.map((flag) => `<span class="flag">${escapeHtml(typeof flag === "string" ? flag : flag.detail || "")}</span>`).join("")}</div>` : ""}
  `;
}

function renderHistory(history) {
  historyCount.textContent = history.length;
  if (!history.length) {
    historyList.innerHTML = `<div class="empty">No scans yet. Open an email to begin using EmailGuard.</div>`;
    return;
  }

  historyList.innerHTML = history.slice(0, 6).map((item) => `
    <div class="history-item">
      <span class="history-mark ${escapeHtml(item.riskLevel || "suspicious")}"></span>
      <span class="history-subject" title="${escapeHtml(item.subject || "(no subject)")}">${escapeHtml(item.subject || "(no subject)")}</span>
      <span class="history-score">${Number(item.score || 0)}</span>
    </div>
  `).join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
