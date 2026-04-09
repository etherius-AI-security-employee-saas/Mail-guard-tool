const DEFAULT_SETTINGS = {
  autoScan: true,
  licenseKey: "",
  protectionMode: "balanced",
  localAiEnabled: true,
  scanCount: 0,
  history: []
};

const ETHERIUS_API = "https://etherius-api.vercel.app/api/scan";
const API_TIMEOUT_MS = 4800;
const HISTORY_LIMIT = 25;
const TRUSTED_DOMAINS = [
  "google.com",
  "microsoft.com",
  "linkedin.com",
  "github.com",
  "amazon.com",
  "apple.com",
  "adobe.com",
  "oracle.com",
  "salesforce.com",
  "deloitte.com",
  "accenture.com",
  "tcs.com",
  "infosys.com",
  "wipro.com"
];

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
    chrome.storage.local.get(["autoScan", "licenseKey", "protectionMode", "localAiEnabled", "scanCount", "history"], (data) => {
      sendResponse({
        success: true,
        autoScan: data.autoScan !== false,
        licenseKey: data.licenseKey || "",
        protectionMode: data.protectionMode || "balanced",
        localAiEnabled: data.localAiEnabled !== false,
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
  const localResult = settings.localAiEnabled !== false
    ? runLocalDecisionEngine(sanitized, settings.protectionMode)
    : defaultLocalResult();

  let cloudResult = null;
  let cloudFailureReason = "";
  try {
    cloudResult = await fetchCloudDecision(sanitized, settings.licenseKey);
  } catch (error) {
    cloudFailureReason = error.message;
  }

  const finalResult = combineDecisionEngines(localResult, cloudResult, settings.protectionMode, cloudFailureReason);
  await saveToHistory(sanitized, finalResult);
  await incrementScanCount();
  return finalResult;
}

async function fetchCloudDecision(sanitized, licenseKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(ETHERIUS_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(licenseKey ? { "X-License-Key": licenseKey } : {})
      },
      body: JSON.stringify(sanitized),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Cloud scan timed out. Local AI engine completed the review.");
    }
    throw new Error("Cloud scan is unavailable right now. Local AI engine completed the review.");
  } finally {
    clearTimeout(timeoutId);
  }

  let data = {};
  try {
    data = await response.json();
  } catch (_error) {
    data = {};
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(data.message || "Daily scan limit reached. Local AI engine completed the review.");
    }
    throw new Error(data.message || `Cloud scan returned ${response.status}. Local AI engine completed the review.`);
  }

  const result = normalizeCloudResult(data.result || {});
  if (typeof data.remainingScans === "number") {
    result.remainingScans = data.remainingScans;
  }
  return result;
}

function sanitizeEmailData(emailData) {
  const input = emailData || {};
  const sender = String(input.sender || "").trim();
  const subject = String(input.subject || "").trim();
  const body = String(input.body || "").trim().slice(0, 6000);
  const senderDomain = String(input.senderDomain || getDomainFromEmail(sender)).trim().toLowerCase();
  const senderName = String(input.senderName || "").trim();
  const replyTo = String(input.replyTo || "").trim();
  const returnPath = String(input.returnPath || "").trim();
  const urls = Array.isArray(input.urls) ? input.urls.slice(0, 25).map((value) => String(value || "").trim()).filter(Boolean) : [];
  const attachments = Array.isArray(input.attachments) ? input.attachments.slice(0, 10).map((value) => String(value || "").trim()).filter(Boolean) : [];

  return {
    subject,
    sender,
    senderName,
    senderDomain,
    replyTo,
    returnPath,
    body,
    urls,
    attachments
  };
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["autoScan", "licenseKey", "protectionMode", "localAiEnabled"], (settings) => {
      resolve({
        autoScan: settings.autoScan !== false,
        licenseKey: settings.licenseKey || "",
        protectionMode: settings.protectionMode || "balanced",
        localAiEnabled: settings.localAiEnabled !== false
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
        time: new Date().toISOString(),
        summary: result.summary || "",
        verdict: result.verdict || ""
      });
      chrome.storage.local.set({ history: history.slice(0, HISTORY_LIMIT) }, resolve);
    });
  });
}

function normalizeCloudResult(result) {
  return {
    source: "cloud",
    riskLevel: String(result.riskLevel || "suspicious").toLowerCase(),
    summary: String(result.summary || "Cloud analysis found suspicious email traits."),
    recommendation: String(result.recommendation || ""),
    flags: Array.isArray(result.flags) ? result.flags : [],
    reasons: Array.isArray(result.reasons) ? result.reasons : [],
    verdict: String(result.verdict || ""),
    score: Number.isFinite(Number(result.score)) ? Number(result.score) : 0,
    isInternshipScam: Boolean(result.isInternshipScam)
  };
}

function defaultLocalResult() {
  return {
    source: "local",
    score: 0,
    riskLevel: "safe",
    summary: "No local AI indicators were triggered.",
    recommendation: "No action needed.",
    flags: [],
    reasons: [],
    verdict: "No immediate threat pattern detected.",
    isInternshipScam: false,
    confidence: "low"
  };
}

function runLocalDecisionEngine(emailData, protectionMode) {
  const subject = `${emailData.subject} ${emailData.senderName}`.toLowerCase();
  const body = emailData.body.toLowerCase();
  const sender = emailData.sender.toLowerCase();
  const senderDomain = emailData.senderDomain.toLowerCase();
  const replyDomain = getDomainFromEmail(emailData.replyTo.toLowerCase());
  const returnPathDomain = getDomainFromEmail(emailData.returnPath.toLowerCase());

  const reasons = [];
  const flags = [];
  let score = 0;
  let isInternshipScam = false;

  const weightedPatterns = [
    {
      name: "credential request",
      weight: 24,
      test: /(verify (your )?(account|password)|reset your password|login to avoid|confirm your mailbox|webmail update|security alert)/i,
      detail: "Credential-harvest language detected"
    },
    {
      name: "urgent pressure",
      weight: 12,
      test: /(urgent|immediately|within 24 hours|final warning|act now|avoid suspension|limited time)/i,
      detail: "High-pressure urgency language detected"
    },
    {
      name: "payment pressure",
      weight: 22,
      test: /(pay|payment|processing fee|registration fee|security deposit|advance fee|wire transfer|upi|bank account)/i,
      detail: "Payment or fee pressure detected"
    },
    {
      name: "attachment lure",
      weight: 18,
      test: /(open the attached|download attachment|invoice attached|payment advice attached|resume attached|document attached)/i,
      detail: "Attachment lure language detected"
    },
    {
      name: "job scam",
      weight: 26,
      test: /(internship|job offer|offer letter|hr team|campus drive|training fee|joining kit|selection confirmation)/i,
      detail: "Internship or offer scam language detected"
    },
    {
      name: "credential secrecy",
      weight: 18,
      test: /(confidential|do not tell|keep this secret|share otp|verification code|one-time password|otp)/i,
      detail: "Secrecy or OTP abuse pattern detected"
    }
  ];

  for (const pattern of weightedPatterns) {
    if (pattern.test.test(`${subject} ${body}`)) {
      score += pattern.weight;
      reasons.push(pattern.detail);
      flags.push({ type: pattern.name, detail: pattern.detail, weight: pattern.weight });
      if (pattern.name === "job scam") {
        isInternshipScam = true;
      }
    }
  }

  if (replyDomain && senderDomain && replyDomain !== senderDomain) {
    score += 20;
    reasons.push("Reply-to domain does not match visible sender domain");
    flags.push({ type: "reply-mismatch", detail: `${replyDomain} differs from ${senderDomain}`, weight: 20 });
  }

  if (returnPathDomain && senderDomain && returnPathDomain !== senderDomain) {
    score += 16;
    reasons.push("Return-path domain differs from the displayed sender");
    flags.push({ type: "return-path-mismatch", detail: `${returnPathDomain} differs from ${senderDomain}`, weight: 16 });
  }

  if (senderDomain && looksSuspiciousDomain(senderDomain)) {
    score += 22;
    reasons.push("Sender domain looks suspicious or impersonation-oriented");
    flags.push({ type: "domain-risk", detail: `Sender domain ${senderDomain} triggered domain-risk heuristics`, weight: 22 });
  }

  if (emailData.urls.length) {
    const urlSignals = analyzeUrls(emailData.urls, senderDomain);
    score += urlSignals.score;
    reasons.push(...urlSignals.reasons);
    flags.push(...urlSignals.flags);
  }

  if (emailData.attachments.length) {
    const dangerousAttachment = emailData.attachments.find((name) => /\.(zip|exe|scr|iso|hta|js|jar|bat|cmd|xlsm|docm)$/i.test(name));
    if (dangerousAttachment) {
      score += 18;
      reasons.push("Potentially dangerous attachment type detected");
      flags.push({ type: "attachment-risk", detail: `Attachment ${dangerousAttachment} may be unsafe`, weight: 18 });
    }
  }

  if (sender.includes("no-reply") && /(reply to this email|respond with|contact recruiter)/i.test(body)) {
    score += 10;
    reasons.push("Behavior mismatch between no-reply sender and requested response action");
    flags.push({ type: "sender-behavior-mismatch", detail: "No-reply sender requests direct response", weight: 10 });
  }

  if (TRUSTED_DOMAINS.some((trusted) => senderDomain.endsWith(trusted)) === false && /(google|microsoft|linkedin|github|amazon|apple|oracle|adobe|hr team)/i.test(`${subject} ${body}`)) {
    score += 14;
    reasons.push("Brand reference detected without a trusted sender domain");
    flags.push({ type: "brand-spoof", detail: "Known brand referenced from untrusted domain", weight: 14 });
  }

  const normalizedScore = clamp(adjustForMode(score, protectionMode), 0, 100);
  const riskLevel = scoreToRiskLevel(normalizedScore);
  const summary = buildSummary(riskLevel, normalizedScore, isInternshipScam, reasons);
  const recommendation = buildRecommendation(riskLevel, isInternshipScam);
  const verdict = buildVerdict(riskLevel, reasons);

  return {
    source: "local",
    score: normalizedScore,
    riskLevel,
    summary,
    recommendation,
    flags: flags.slice(0, 8),
    reasons: reasons.slice(0, 6),
    verdict,
    isInternshipScam,
    confidence: normalizedScore >= 75 ? "high" : normalizedScore >= 45 ? "medium" : "low"
  };
}

function analyzeUrls(urls, senderDomain) {
  const reasons = [];
  const flags = [];
  let score = 0;

  urls.forEach((url) => {
    let hostname = "";
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch (_error) {
      return;
    }

    if (!hostname) {
      return;
    }

    if (hostname !== senderDomain && senderDomain && !hostname.endsWith(senderDomain)) {
      score += 8;
      reasons.push(`Embedded link points to ${hostname}, not the sender domain`);
      flags.push({ type: "link-mismatch", detail: `${hostname} differs from sender domain ${senderDomain}`, weight: 8 });
    }

    if (looksSuspiciousDomain(hostname)) {
      score += 16;
      reasons.push(`Suspicious link domain detected: ${hostname}`);
      flags.push({ type: "link-risk", detail: `${hostname} triggered risky-domain heuristics`, weight: 16 });
    }

    if (/@|%40|bit\.ly|tinyurl|rb\.gy|cutt\.ly|t\.co/i.test(url)) {
      score += 10;
      reasons.push("Redirect-style or obfuscated link detected");
      flags.push({ type: "redirect-link", detail: "Shortened or obfuscated link was found", weight: 10 });
    }
  });

  return { score, reasons, flags };
}

function looksSuspiciousDomain(domain) {
  if (!domain) {
    return false;
  }

  const suspiciousTlds = [".top", ".xyz", ".click", ".site", ".live", ".buzz", ".cam", ".shop"];
  if (suspiciousTlds.some((tld) => domain.endsWith(tld))) {
    return true;
  }

  if (/[0-9]/.test(domain) && /[-]{2,}/.test(domain)) {
    return true;
  }

  if (/(secure|verify|update|account|wallet|career|intern|hr|pay|login|support)/i.test(domain) && !TRUSTED_DOMAINS.some((trusted) => domain.endsWith(trusted))) {
    return true;
  }

  return false;
}

function adjustForMode(score, protectionMode) {
  if (protectionMode === "strict") {
    return Math.min(100, Math.round(score * 1.15));
  }
  if (protectionMode === "relaxed") {
    return Math.round(score * 0.9);
  }
  return score;
}

function scoreToRiskLevel(score) {
  if (score >= 76) {
    return "danger";
  }
  if (score >= 52) {
    return "warning";
  }
  if (score >= 26) {
    return "suspicious";
  }
  return "safe";
}

function buildSummary(riskLevel, score, isInternshipScam, reasons) {
  if (isInternshipScam) {
    return `This email strongly resembles a fake internship or fake opportunity scam. Local AI flagged ${reasons[0] || "multiple scam indicators"} with a risk score of ${score}/100.`;
  }

  if (riskLevel === "danger") {
    return `This email shows multiple high-risk phishing or fraud signals. Local AI marked it as dangerous with a score of ${score}/100.`;
  }
  if (riskLevel === "warning") {
    return `This email carries enough red-team style indicators to be treated carefully. Local AI scored it ${score}/100.`;
  }
  if (riskLevel === "suspicious") {
    return `This email contains suspicious patterns that deserve verification before clicking or replying. Local AI scored it ${score}/100.`;
  }
  return `No major phishing or scam indicators were triggered in the quick local analysis. Local AI scored it ${score}/100.`;
}

function buildRecommendation(riskLevel, isInternshipScam) {
  if (isInternshipScam) {
    return "Do not pay fees, do not share personal documents, and verify the internship or recruiter through an official company or college source.";
  }
  if (riskLevel === "danger") {
    return "Do not click links or open attachments. Verify the sender through a trusted channel and report the message immediately.";
  }
  if (riskLevel === "warning") {
    return "Verify the sender identity and inspect linked domains carefully before taking any action.";
  }
  if (riskLevel === "suspicious") {
    return "Pause before clicking. Confirm the request independently if money, passwords, or urgent action is involved.";
  }
  return "No immediate action is needed, but keep normal email caution in place.";
}

function buildVerdict(riskLevel, reasons) {
  if (riskLevel === "danger") {
    return `Red-team style indicators suggest likely fraud or phishing. Strongest signal: ${reasons[0] || "multiple coordinated risk flags"}.`;
  }
  if (riskLevel === "warning") {
    return `Email requires human verification. Strongest signal: ${reasons[0] || "moderate suspicious activity"}.`;
  }
  if (riskLevel === "suspicious") {
    return `Email is not clean enough to trust immediately. Strongest signal: ${reasons[0] || "minor suspicious pattern"}.`;
  }
  return "No critical indicators detected by the local decision engine.";
}

function combineDecisionEngines(localResult, cloudResult, protectionMode, cloudFailureReason) {
  if (!cloudResult) {
    return {
      ...localResult,
      source: "local-fallback",
      engineStatus: "local-ai-only",
      summary: localResult.summary,
      recommendation: localResult.recommendation,
      verdict: `${localResult.verdict} ${cloudFailureReason ? `Cloud note: ${cloudFailureReason}` : ""}`.trim()
    };
  }

  const localWeight = protectionMode === "strict" ? 0.58 : 0.5;
  const cloudWeight = 1 - localWeight;
  const mergedScore = clamp(Math.round((localResult.score * localWeight) + (cloudResult.score * cloudWeight)), 0, 100);
  const mergedRisk = higherRiskLevel(localResult.riskLevel, cloudResult.riskLevel, mergedScore);
  const mergedReasons = [...new Set([...(localResult.reasons || []), ...(cloudResult.reasons || []), ...extractFlagDetails(cloudResult.flags)])].slice(0, 6);
  const mergedFlags = [...localResult.flags, ...normalizeFlags(cloudResult.flags)].slice(0, 8);
  const isInternshipScam = Boolean(localResult.isInternshipScam || cloudResult.isInternshipScam);

  return {
    source: "hybrid-ai",
    engineStatus: "local-plus-cloud",
    score: mergedScore,
    riskLevel: mergedRisk,
    summary: choosePreferredSummary(localResult, cloudResult, mergedRisk, mergedScore, isInternshipScam),
    recommendation: cloudResult.recommendation || localResult.recommendation,
    flags: mergedFlags,
    reasons: mergedReasons,
    verdict: buildVerdict(mergedRisk, mergedReasons),
    isInternshipScam,
    remainingScans: cloudResult.remainingScans
  };
}

function choosePreferredSummary(localResult, cloudResult, riskLevel, score, isInternshipScam) {
  if (isInternshipScam && localResult.summary) {
    return localResult.summary;
  }
  if (cloudResult.summary && cloudResult.summary.length > 20) {
    return `${cloudResult.summary} Hybrid score: ${score}/100.`;
  }
  return buildSummary(riskLevel, score, isInternshipScam, localResult.reasons || []);
}

function higherRiskLevel(localRisk, cloudRisk, score) {
  const order = ["safe", "suspicious", "warning", "danger"];
  const localIndex = order.indexOf(localRisk);
  const cloudIndex = order.indexOf(cloudRisk);
  const best = Math.max(localIndex, cloudIndex);
  if (best >= 0) {
    return order[best];
  }
  return scoreToRiskLevel(score);
}

function extractFlagDetails(flags) {
  if (!Array.isArray(flags)) {
    return [];
  }
  return flags.map((flag) => {
    if (typeof flag === "string") {
      return flag;
    }
    return flag?.detail || flag?.reason || "";
  }).filter(Boolean);
}

function normalizeFlags(flags) {
  if (!Array.isArray(flags)) {
    return [];
  }
  return flags.map((flag) => {
    if (typeof flag === "string") {
      return { type: "cloud-signal", detail: flag, weight: 0 };
    }
    return {
      type: flag.type || "cloud-signal",
      detail: flag.detail || flag.reason || "Cloud analysis flag",
      weight: Number(flag.weight || 0)
    };
  });
}

function getDomainFromEmail(value) {
  const match = String(value || "").match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i);
  return match ? match[1].toLowerCase() : "";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
