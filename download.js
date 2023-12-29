document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(["blob"]).then((result) => {
        document.getElementById('video').setAttribute('src', result.blob);

    });
});
