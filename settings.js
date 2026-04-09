const autoScanToggle = document.getElementById("autoScanToggle");
const onboardedToggle = document.getElementById("onboardedToggle");
const licenseInput = document.getElementById("licenseInput");
const saveButton = document.getElementById("saveButton");
const clearButton = document.getElementById("clearButton");
const status = document.getElementById("status");

chrome.storage.local.get(["autoScan", "onboarded", "licenseKey"], (data) => {
  autoScanToggle.checked = data.autoScan !== false;
  onboardedToggle.checked = data.onboarded === true;
  licenseInput.value = data.licenseKey || "";
});

saveButton?.addEventListener("click", () => {
  chrome.storage.local.set({
    autoScan: autoScanToggle.checked,
    onboarded: onboardedToggle.checked,
    licenseKey: licenseInput.value.trim()
  }, () => {
    status.textContent = "Settings saved successfully.";
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
