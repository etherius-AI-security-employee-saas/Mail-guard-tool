const startButton = document.getElementById("startButton");
const optionsButton = document.getElementById("optionsButton");

startButton?.addEventListener("click", () => {
  chrome.storage.local.set({ onboarded: true, autoScan: true }, () => {
    window.close();
  });
});

optionsButton?.addEventListener("click", () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  }
});
