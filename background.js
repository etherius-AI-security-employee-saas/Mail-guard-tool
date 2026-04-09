const DEFAULT_SETTINGS = {
  autoScan: true,
  licenseKey: "",
  scanCount: 0,
  history: []
};

const ETHERIUS_API = "https://etherius-api.vercel.app/api/scan";

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS), (stored) => {
    const patch = {};
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (typeof stored[key] === "undefined") {
        patch[key] = value;
      }
    }
    if (Object.keys(patch).length) {
      chrome.storage.local.set(patch);
    }
  });

  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    sendResponse({ success: false, error: "Invalid extension request." });
    return false;
  }

  if (message.type === "ANALYZE_EMAIL") {
    analyzeEmail(message.data)
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === "GET_SETTINGS") {
    chrome.storage.local.get(["autoScan", "licenseKey", "scanCount", "history"], (data) => {
      sendResponse({
        success: true,
        autoScan: data.autoScan !== false,
        licenseKey: data.licenseKey || "",
        scanCount: data.scanCount || 0,
        history: data.history || []
      });
    });
    return true;
  }

  if (message.type === "SAVE_SETTINGS") {
    const nextSettings = message.settings || {};
    chrome.storage.local.set(nextSettings, () => sendResponse({ success: true }));
    return true;
  }

  sendResponse({ success: false, error: `Unsupported message type: ${message.type}` });
  return false;
});

async function analyzeEmail(emailData) {
  const sanitized = sanitizeEmailData(emailData);
  if (!sanitized.subject && !sanitized.body) {
    throw new Error("Open an email first, then run EmailGuard.");
  }

  const settings = await getSettings();
  let response;
  try {
    response = await fetch(ETHERIUS_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.licenseKey ? { "X-License-Key": settings.licenseKey } : {})
      },
      body: JSON.stringify(sanitized)
    });
  } catch (error) {
    throw new Error("EmailGuard could not reach the scan service. Check your connection and try again.");
  }

  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(data.message || "Daily scan limit reached. Add a license key for higher-volume scanning.");
    }
    throw new Error(data.message || `Scan service returned ${response.status}.`);
  }

  const result = normalizeResult(data.result || {});
  await saveToHistory(sanitized, result);
  await incrementScanCount();
  return {
    ...result,
    remainingScans: typeof data.remainingScans === "number" ? data.remainingScans : undefined
  };
}

function sanitizeEmailData(emailData) {
  const input = emailData || {};
  return {
    subject: String(input.subject || "").trim(),
    sender: String(input.sender || "").trim(),
    senderDomain: String(input.senderDomain || "").trim(),
    body: String(input.body || "").trim().slice(0, 4000)
  };
}

function normalizeResult(result) {
  return {
    riskLevel: String(result.riskLevel || "suspicious").toLowerCase(),
    summary: String(result.summary || "EmailGuard detected suspicious email patterns."),
    recommendation: String(result.recommendation || ""),
    flags: Array.isArray(result.flags) ? result.flags : [],
    isInternshipScam: Boolean(result.isInternshipScam),
    score: Number.isFinite(Number(result.score)) ? Number(result.score) : 0
  };
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["autoScan", "licenseKey"], (settings) => {
      resolve({
        autoScan: settings.autoScan !== false,
        licenseKey: settings.licenseKey || ""
      });
    });
  });
}

function incrementScanCount() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["scanCount"], (data) => {
      const nextCount = (data.scanCount || 0) + 1;
      chrome.storage.local.set({ scanCount: nextCount }, resolve);
    });
  });
}

function saveToHistory(emailData, result) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["history"], (data) => {
      const history = data.history || [];
      history.unshift({
        subject: emailData.subject || "(no subject)",
        sender: emailData.sender || "",
        riskLevel: result.riskLevel,
        score: result.score,
        time: new Date().toISOString()
      });
      chrome.storage.local.set({ history: history.slice(0, 20) }, resolve);
    });
  });
}
