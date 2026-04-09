(function () {
  "use strict";

  let lastEmailId = null;
  let autoScanEnabled = true;
  let isScanning = false;

  chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (response) => {
    if (response && response.success) {
      autoScanEnabled = response.autoScan !== false;
    }
  });

  function extractGmailEmail() {
    const subjectEl = document.querySelector("h2.hP");
    const senderEl = document.querySelector(".gD");
    const bodyEl = document.querySelector(".a3s.aiL");
    const subject = subjectEl ? subjectEl.innerText.trim() : "";
    const sender = senderEl ? (senderEl.getAttribute("email") || senderEl.innerText || "").trim() : "";
    const senderDomain = sender.includes("@") ? sender.split("@")[1] : "";
    const body = bodyEl ? bodyEl.innerText.trim().slice(0, 4000) : "";
    return { subject, sender, senderDomain, body, emailId: `${subject}|${sender}` };
  }

  function extractOutlookEmail() {
    const subjectEl = document.querySelector("[data-testid='subject']") || document.querySelector("[role='heading']");
    const senderEl = document.querySelector("[data-testid='senderDetails']");
    const bodyEl = document.querySelector("[data-testid='messageBody']");
    const subject = subjectEl ? subjectEl.innerText.trim() : "";
    const sender = senderEl ? senderEl.innerText.trim() : "";
    const senderDomain = sender.includes("@") ? sender.split("@")[1]?.split(">")[0]?.trim() || "" : "";
    const body = bodyEl ? bodyEl.innerText.trim().slice(0, 4000) : "";
    return { subject, sender, senderDomain, body, emailId: `${subject}|${sender}` };
  }

  function extractEmailData() {
    if (location.hostname === "mail.google.com") {
      return extractGmailEmail();
    }
    return extractOutlookEmail();
  }

  function checkForNewEmail() {
    if (!autoScanEnabled || isScanning) {
      return;
    }

    const data = extractEmailData();
    if (!data.subject && !data.body) {
      return;
    }
    if (data.emailId === lastEmailId) {
      return;
    }

    lastEmailId = data.emailId;
    triggerScan(data, true);
  }

  function triggerScan(data, isAuto, callback) {
    if (isScanning) {
      return;
    }

    const emailData = data || extractEmailData();
    if (!emailData.subject && !emailData.body) {
      if (!isAuto) {
        showBanner({
          riskLevel: "error",
          summary: "Open an email first, then run EmailGuard.",
          flags: [],
          recommendation: ""
        });
      }
      if (typeof callback === "function") {
        callback({
          success: false,
          result: {
            riskLevel: "error",
            summary: "Open an email first, then run EmailGuard.",
            flags: [],
            recommendation: ""
          }
        });
      }
      return;
    }

    isScanning = true;
    if (!isAuto) {
      showBanner({
        riskLevel: "loading",
        summary: "Analyzing this email with Etherius EmailGuard...",
        flags: [],
        recommendation: ""
      });
    }

    chrome.runtime.sendMessage({ type: "ANALYZE_EMAIL", data: emailData }, (response) => {
      isScanning = false;
      if (chrome.runtime.lastError || !response || !response.success) {
        const message = response?.error || "EmailGuard could not complete the scan.";
        if (isAuto) {
          showMiniIndicator("warning", "Scan unavailable");
        } else {
          showBanner({
            riskLevel: "error",
            summary: message,
            flags: [],
            recommendation: "Reload the mail tab and try again."
          });
        }
        if (typeof callback === "function") {
          callback({
            success: false,
            result: {
              riskLevel: "error",
              summary: message,
              flags: [],
              recommendation: "Reload the mail tab and try again."
            }
          });
        }
        return;
      }

      const result = response.result;
      if (typeof callback === "function") {
        callback({
          success: true,
          result
        });
      }
      if (isAuto && result.riskLevel === "safe") {
        showMiniIndicator("safe", `${result.score}/100 safe`);
        return;
      }
      showBanner(result);
    });
  }

  function showMiniIndicator(level, text) {
    const existing = document.getElementById("eg-mini");
    if (existing) {
      existing.remove();
    }

    const indicator = document.createElement("div");
    indicator.id = "eg-mini";
    indicator.dataset.level = level;
    indicator.innerHTML = `
      <span class="eg-mini-mark">${level === "safe" ? "OK" : "!"}</span>
      <span class="eg-mini-text">${text}</span>
    `;
    document.body.appendChild(indicator);
    setTimeout(() => indicator.remove(), 4000);
  }

  function showBanner(result) {
    const existing = document.getElementById("eg-banner");
    if (existing) {
      existing.remove();
    }

    const config = {
      safe: { label: "SAFE", icon: "OK" },
      suspicious: { label: "SUSPICIOUS", icon: "SCAN" },
      warning: { label: "WARNING", icon: "ALERT" },
      danger: { label: "DANGER", icon: "BLOCK" },
      loading: { label: "SCANNING", icon: "..." },
      error: { label: "ERROR", icon: "X" },
      limit: { label: "LIMIT", icon: "CAP" }
    };
    const ui = config[result.riskLevel] || config.suspicious;
    const flags = Array.isArray(result.flags) ? result.flags.slice(0, 5) : [];

    const banner = document.createElement("div");
    banner.id = "eg-banner";
    banner.dataset.level = result.riskLevel || "suspicious";
    banner.innerHTML = `
      <div class="eg-inner">
        <div class="eg-head">
          <span class="eg-brand">ETHERIUS EMAILGUARD</span>
          <span class="eg-chip">${ui.icon} ${ui.label}</span>
          <button class="eg-close" type="button" aria-label="Dismiss">x</button>
        </div>
        ${typeof result.score === "number" ? `
          <div class="eg-score-row">
            <div class="eg-track"><div class="eg-fill" style="width:${Math.max(0, Math.min(100, result.score))}%"></div></div>
            <span class="eg-score">${result.score}/100</span>
          </div>
        ` : ""}
        ${result.isInternshipScam ? `<div class="eg-badge">Fake Internship Scam Pattern Detected</div>` : ""}
        <p class="eg-summary">${escapeHtml(result.summary || "")}</p>
        ${flags.length ? `<div class="eg-flags">${flags.map((flag) => `<span class="eg-flag">${escapeHtml(typeof flag === "string" ? flag : flag.detail || "")}</span>`).join("")}</div>` : ""}
        ${result.recommendation ? `<p class="eg-recommendation">${escapeHtml(result.recommendation)}</p>` : ""}
        ${typeof result.remainingScans === "number" ? `<div class="eg-foot">Free scans remaining today: <strong>${result.remainingScans}</strong></div>` : ""}
      </div>
    `;

    banner.querySelector(".eg-close")?.addEventListener("click", () => banner.remove());
    document.body.appendChild(banner);

    if (result.riskLevel === "safe") {
      setTimeout(() => banner.remove(), 6000);
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return;
    }
    if (message.type === "MANUAL_SCAN") {
      triggerScan(null, false, (payload) => sendResponse(payload));
      return true;
    }
    if (message.type === "UPDATE_AUTOSCAN") {
      autoScanEnabled = Boolean(message.value);
    }
  });

  const observer = new MutationObserver(() => {
    setTimeout(checkForNewEmail, 800);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(checkForNewEmail, 2000);
})();
