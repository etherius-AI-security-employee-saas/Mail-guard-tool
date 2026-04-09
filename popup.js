const resultEl = document.getElementById("result");
const scanButton = document.getElementById("scanButton");
const autoScanToggle = document.getElementById("autoScanToggle");
const licenseInput = document.getElementById("licenseInput");
const licenseStatus = document.getElementById("licenseStatus");
const historyList = document.getElementById("historyList");
const totalScans = document.getElementById("totalScans");
const historyCount = document.getElementById("historyCount");

const RISK = {
  safe: { label: "SAFE", className: "safe" },
  suspicious: { label: "SUSPICIOUS", className: "warning" },
  warning: { label: "WARNING", className: "warning" },
  danger: { label: "DANGER", className: "danger" },
  loading: { label: "SCANNING", className: "" },
  error: { label: "ERROR", className: "danger" },
  limit: { label: "LIMIT", className: "warning" }
};

chrome.storage.local.get(["autoScan", "licenseKey", "scanCount", "history"], (data) => {
  autoScanToggle.checked = data.autoScan !== false;
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
      recommendation: ""
    });
    return;
  }

  scanButton.disabled = true;
  scanButton.textContent = "Analyzing...";
  renderResult({
    riskLevel: "loading",
    summary: "EmailGuard is analyzing the currently opened message.",
    flags: [],
    recommendation: ""
  });

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "MANUAL_SCAN" });
    if (response?.result) {
      renderResult(response.result);
    }
    refreshMetrics();
  } catch (error) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
      setTimeout(async () => {
        try {
          const retryResponse = await chrome.tabs.sendMessage(tab.id, { type: "MANUAL_SCAN" });
          if (retryResponse?.result) {
            renderResult(retryResponse.result);
          }
          refreshMetrics();
        } catch (_retryError) {
          renderResult({
            riskLevel: "error",
            summary: "EmailGuard could not attach to this mail tab. Reload the page and try again.",
            flags: [],
            recommendation: ""
          });
        }
      }, 500);
    } catch (secondError) {
      renderResult({
        riskLevel: "error",
        summary: "EmailGuard could not attach to this mail tab. Reload the page and try again.",
        flags: [],
        recommendation: ""
      });
    }
  }

  setTimeout(() => {
    scanButton.disabled = false;
    scanButton.textContent = "Scan Current Email";
  }, 4000);
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

document.getElementById("saveLicenseButton").addEventListener("click", () => {
  const key = licenseInput.value.trim();
  chrome.storage.local.set({ licenseKey: key }, () => {
    licenseStatus.textContent = key ? "License key saved." : "License key cleared.";
    licenseStatus.className = `license-status ${key ? "safe" : ""}`;
  });
});

function refreshMetrics() {
  chrome.storage.local.get(["scanCount", "history"], (data) => {
    totalScans.textContent = data.scanCount || 0;
    renderHistory(data.history || []);
  });
}

function renderResult(result) {
  const ui = RISK[result.riskLevel] || RISK.suspicious;
  const flags = Array.isArray(result.flags) ? result.flags.slice(0, 4) : [];
  resultEl.className = "result show";
  resultEl.innerHTML = `
    <div class="result-head">
      <span class="${ui.className}">${ui.label}</span>
      ${typeof result.score === "number" ? `<span class="result-score">${result.score}/100</span>` : ""}
    </div>
    <p class="result-summary">${escapeHtml(result.summary || "")}</p>
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
