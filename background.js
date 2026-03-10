const startRecording = async (msg) => {
  await chrome.tabs.query({'active': true, 'lastFocusedWindow': true, 'currentWindow': true}, async function (tabs) {
    // Get current tab to focus on it after start recording on recording screen tab
    const currentTab = tabs[0];

    // Create recording screen tab
    const tab = await chrome.tabs.create({
      url: chrome.runtime.getURL('recorder.html'),
      pinned: true,
      active: true,
    });

    // Wait for recording screen tab to be loaded and send message to it with the currentTab.
    // Small delay so recorder.js has time to register its onMessage listener.
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(function () {
          var payload = {
            name: msg === 'initiateRecording' ? 'startRecording' : 'startRecordingNoSound',
            body: { currentTab: currentTab },
          };
          chrome.tabs.sendMessage(tabId, payload).then(function () {
            // delivered
          }).catch(function () {
            // Recorder tab closed or listener not ready; ignore
          });
        }, 500);
      }
    });
  });
};

// Listen for startRecording message from popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.name === 'initiateRecording' || request.name === 'initiateRecordingNoSound') {
    startRecording(request.name);
    return;
  }
  // Handle upload status when popup is closed (state is stored by recorder/popup)
  if (request.name === 'nextCloudUploadSuccess' || request.name === 'nextCloudUploadFileError' || request.name === 'captureFinished') {
    sendResponse({ received: true });
  }
});