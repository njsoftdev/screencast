document.addEventListener('DOMContentLoaded', () => {
    document.title = chrome.i18n.getMessage('view');
    chrome.storage.local.get(["blob"]).then((result) => {
        document.getElementById('video').setAttribute('src', result.blob);

    });
});
