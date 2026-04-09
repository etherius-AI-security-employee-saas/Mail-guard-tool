const autoScanToggle = document.getElementById("autoScanToggle");
const localAiToggle = document.getElementById("localAiToggle");
const onboardedToggle = document.getElementById("onboardedToggle");
const modeSelect = document.getElementById("modeSelect");
const saveModeButton = document.getElementById("saveModeButton");
const licenseInput = document.getElementById("licenseInput");
const saveButton = document.getElementById("saveButton");
const clearButton = document.getElementById("clearButton");
const status = document.getElementById("status");

chrome.storage.local.get(["autoScan", "localAiEnabled", "onboarded", "licenseKey", "protectionMode"], (data) => {
  autoScanToggle.checked = data.autoScan !== false;
  localAiToggle.checked = data.localAiEnabled !== false;
  onboardedToggle.checked = data.onboarded === true;
  licenseInput.value = data.licenseKey || "";
  modeSelect.value = data.protectionMode || "balanced";
});

saveButton?.addEventListener("click", () => {
  chrome.storage.local.set({
    autoScan: autoScanToggle.checked,
    localAiEnabled: localAiToggle.checked,
    onboarded: onboardedToggle.checked,
    licenseKey: licenseInput.value.trim()
  }, () => {
    status.textContent = "Settings saved successfully.";
    status.className = "status success";
  });
});

saveModeButton?.addEventListener("click", () => {
  chrome.storage.local.set({ protectionMode: modeSelect.value }, () => {
    status.textContent = `Protection mode saved: ${modeSelect.value}.`;
    status.className = "status success";
  });
});

clearButton?.addEventListener("click", () => {
  licenseInput.value = "";
  chrome.storage.local.set({ licenseKey: "" }, () => {
    status.textContent = "License key cleared.";
    status.className = "status";
  });
});
