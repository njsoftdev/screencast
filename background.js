const RECORDING_FLAG_KEY = 'nj_screencast_recording';

const startRecording = async (request) => {
  const msg = request && request.name;
  const withSound = msg === 'initiateRecording';
  await chrome.storage.local.set({ [RECORDING_FLAG_KEY]: { active: true, with_sound: withSound } });

  const settings = request.settings || (await chrome.storage.sync.get(['next_cloud_settings'])).next_cloud_settings || {};
  const next = { ...settings, recording: true, paused: false, with_sound: withSound };
  await chrome.storage.sync.set({ next_cloud_settings: next });

  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true, currentWindow: true });
  const currentTab = tabs[0];

  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL('recorder.html'),
    pinned: true,
    active: true,
  });

  chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
    if (tabId === tab.id && info.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(function () {
        var payload = {
          name: withSound ? 'startRecording' : 'startRecordingNoSound',
          body: { currentTab: currentTab },
        };
        chrome.tabs.sendMessage(tabId, payload).then(function () {}).catch(function () {});
      }, 500);
    }
  });
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.name === 'initiateRecording' || request.name === 'initiateRecordingNoSound') {
    startRecording(request);
    return;
  }
  if (request.name === 'stopRecording') {
    chrome.storage.local.remove(RECORDING_FLAG_KEY);
    return;
  }
  if (request.name === 'recordingCanceled') {
    chrome.storage.local.remove(RECORDING_FLAG_KEY);
    return;
  }
  if (request.name === 'ensureNextcloudPermission') {
    const origin = (request.origin || '').trim();
    if (!origin) {
      sendResponse({ ok: false });
      return;
    }
    const url = origin.endsWith('/') ? origin.slice(0, -1) : origin;
    const perm = url + '/*';
    chrome.permissions.contains({ origins: [perm] }).then((has) => {
      if (has) {
        sendResponse({ ok: true });
        return;
      }
      chrome.permissions.request({ origins: [perm] }).then((granted) => {
        sendResponse({ ok: granted });
      }).catch(() => sendResponse({ ok: false }));
    });
    return true;
  }
  if (request.name === 'nextCloudUploadSuccess' || request.name === 'nextCloudUploadFileError' || request.name === 'captureFinished') {
    chrome.storage.local.remove(RECORDING_FLAG_KEY);
    sendResponse({ received: true });
  }
});