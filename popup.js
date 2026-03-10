let nextCloudSettings = {
    save_destination: 'local',
    user: null,
    pass: null,
    dir: null,
    schemeHost: null,
    video_file_format: 'webm',
    bitrix24_webhook_url: null,
    bitrix24_storage_type: 'personal',
    bitrix24_folder_name: 'screen-recordings',
    paused: false,
    recording: false,
    with_sound: false
};

document.addEventListener('DOMContentLoaded', async () => {
    const settingsItem = await chrome.storage.sync.get(["next_cloud_settings"]);
    if(settingsItem && settingsItem.hasOwnProperty('next_cloud_settings'))
    {
        nextCloudSettings = settingsItem.next_cloud_settings;
    }

    _initUi();
});

function _initUi() {
    // Links
    [
        'logo-link'
    ].forEach((id) => {
        document.getElementById(id).setAttribute('href',  chrome.i18n.getMessage(id.replace(/-/g, '_')));
    });
    // Inner text
    [
        'settings-btn',
        'save-btn',
        'cancel-btn',
        'rec-no-sound-btn',
        'rec-with-sound-btn',
        'pause',
        'end',
        'save-destination-label',
        'select-codec',
        'nc-settings-info',
        'bitrix24-settings-info',
        'bitrix24-webhook-label',
        'bitrix24-storage-type-label',
        'bitrix24-folder-label',
        'footer-text',
        'settings-check-btn',
        'pass-help'
    ].forEach(function (id) {
        const el = document.getElementById(id);
        if (el && id !== 'pass-help') {
            el.innerText = chrome.i18n.getMessage(id.replace(/-/g, '_'));
        }
    });

    // Placeholders
    [
        'input-address',
        'input-dir',
        'input-username',
        'input-pass',

    ].forEach(function (id) {
        document.getElementById(id).setAttribute('placeholder', chrome.i18n.getMessage(id.replace(/-/g, '_')));
    });

    _bindSettingsButton();
    _bindRecordButton();
    _bindPauseButton();
    _bindEndButton();
    _bindSettingsForm();

    if(nextCloudSettings.recording)
    {
        _showRecordingUi();
    }
    else
    {
        _showInitUi();
    }

    if(nextCloudSettings.paused)
    {
        _showPausedUi();
    }
}

function _originFromHost(schemeHost) {
    const s = (schemeHost || '').trim().replace(/\/+$/, '');
    if (!s) return null;
    try {
        const url = s.startsWith('http') ? new URL(s) : new URL('https://' + s);
        return url.origin;
    } catch (e) {
        return null;
    }
}

function _restoreSettingsFormFrom(settings) {
    ['save_destination', 'schemeHost', 'dir', 'user', 'pass', 'video_file_format', 'bitrix24_webhook_url', 'bitrix24_storage_type', 'bitrix24_folder_name'].forEach((key) => {
        const el = document.querySelector('[data-map="' + key + '"]');
        if (el && settings[key] != null) el.value = settings[key];
    });
    _toggleDestinationBlocks(settings.save_destination);
}

function _toggleDestinationBlocks(destination) {
    const blockNextcloud = document.getElementById('block-nextcloud');
    const blockBitrix24 = document.getElementById('block-bitrix24');
    blockNextcloud.classList.toggle('d-none', destination !== 'nextcloud');
    blockBitrix24.classList.toggle('d-none', destination !== 'bitrix24');
}

function _bindSettingsForm()
{
    const checkResult = document.getElementById('nc-check-result');
    checkResult.classList.remove('text-red');

    const saveDestinationSelect = document.getElementById('save-destination-select');
    if (saveDestinationSelect) {
        const localOpt = saveDestinationSelect.querySelector('option[value="local"]');
        const nextcloudOpt = saveDestinationSelect.querySelector('option[value="nextcloud"]');
        const bitrix24Opt = saveDestinationSelect.querySelector('option[value="bitrix24"]');
        if (localOpt) localOpt.textContent = chrome.i18n.getMessage('save_destination_local');
        if (nextcloudOpt) nextcloudOpt.textContent = chrome.i18n.getMessage('save_destination_nextcloud');
        if (bitrix24Opt) bitrix24Opt.textContent = chrome.i18n.getMessage('save_destination_bitrix24');
        saveDestinationSelect.value = nextCloudSettings.save_destination || 'local';
        saveDestinationSelect.addEventListener('change', function () {
            nextCloudSettings.save_destination = saveDestinationSelect.value;
            _toggleDestinationBlocks(nextCloudSettings.save_destination);
            updateSettings();
        });
    }
    _toggleDestinationBlocks(nextCloudSettings.save_destination || 'local');

    var bitrix24StorageSelect = document.getElementById('bitrix24-storage-type');
    if (bitrix24StorageSelect && !bitrix24StorageSelect.querySelector('option')) {
        var optPersonal = document.createElement('option');
        optPersonal.value = 'personal';
        optPersonal.textContent = chrome.i18n.getMessage('bitrix24_storage_personal');
        var optCommon = document.createElement('option');
        optCommon.value = 'common';
        optCommon.textContent = chrome.i18n.getMessage('bitrix24_storage_common');
        bitrix24StorageSelect.appendChild(optPersonal);
        bitrix24StorageSelect.appendChild(optCommon);
        bitrix24StorageSelect.addEventListener('change', function () {
            nextCloudSettings.bitrix24_storage_type = bitrix24StorageSelect.value;
            updateSettings();
        });
    }
    if (bitrix24StorageSelect) bitrix24StorageSelect.value = nextCloudSettings.bitrix24_storage_type || 'personal';
    var bitrix24FolderInput = document.getElementById('input-bitrix24-folder');
    if (bitrix24FolderInput && !bitrix24FolderInput.placeholder) {
        bitrix24FolderInput.placeholder = 'screen-recordings';
    }

    let schemeHost = document.getElementById('input-address');
    let ncDir = document.getElementById('input-dir');
    let ncUser = document.getElementById('input-username');
    let ncPass = document.getElementById('input-pass');
    let formatSelector = document.getElementById('video-file-format-selector');
    let bitrix24Webhook = document.getElementById('input-bitrix24-webhook');

    const formNodes = [schemeHost, ncDir, ncUser, ncPass, formatSelector, bitrix24Webhook, bitrix24StorageSelect, bitrix24FolderInput].filter(Boolean);
    formNodes.forEach((node) => {
        if (!node) return;
        let key = node.getAttribute('data-map');
        if (!key) return;
        if (nextCloudSettings.hasOwnProperty(key) && nextCloudSettings[key] != null && nextCloudSettings[key] !== '')
        {
            node.value = nextCloudSettings[key];
        }
        if (key === 'bitrix24_folder_name' && (!nextCloudSettings[key] || nextCloudSettings[key] === '')) {
            node.value = 'screen-recordings';
        }
        node.addEventListener('keyup', function () {
            nextCloudSettings[key] = node.value;
            updateSettings();
        });
        node.addEventListener('change', function () {
            nextCloudSettings[key] = node.value;
            updateSettings();
        });
    });

    const passHelpEl = document.getElementById('pass-help');
    if (nextCloudSettings.schemeHost) {
        const url = (nextCloudSettings.schemeHost + '/settings/user/security').replace(/^\/+/, '');
        const safeHref = url.startsWith('http') ? url : 'https://' + url.replace(/^\/+/, '');
        const link = document.createElement('a');
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.href = safeHref;
        link.textContent = chrome.i18n.getMessage('pass_help_link_text');
        passHelpEl.textContent = '';
        passHelpEl.appendChild(document.createTextNode(chrome.i18n.getMessage('pass_help_prefix') + ' '));
        passHelpEl.appendChild(link);
    } else {
        passHelpEl.textContent = chrome.i18n.getMessage('pass_help');
    }

    formatSelector.addEventListener('change', function (e) {
        nextCloudSettings.video_file_format = e.target.value;
        updateSettings();
    });

    let checkBtn = document.getElementById('settings-check-btn');
    if (checkBtn) checkBtn.addEventListener('click', async () => {
        const origin = _originFromHost(nextCloudSettings.schemeHost);
        if (origin) {
            try {
                await chrome.permissions.request({ origins: [origin + '/*'] });
            } catch (e) { /* ignore */ }
        }
        const authHeader = btoa(nextCloudSettings.user + ":" + nextCloudSettings.pass);
        const baseUri = nextCloudSettings.schemeHost + '/remote.php/dav/files/' + nextCloudSettings.user + nextCloudSettings.dir;
        const propertyRequestBody = `<?xml version="1.0"?>
<d:propfind  xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:prop>
        <oc:fileid />
        <d:getlastmodified />
  </d:prop>
</d:propfind>`;
        fetch(baseUri, {
            method: 'PROPFIND',
            cache: "no-cache",
            headers: {
                "Accept": "text/plain",
                "Depth": 1,
                "Content-Type": "application/xml",
                "Authorization": "Basic " + authHeader
            },
            body: propertyRequestBody
        }).then((response) => {
            response.text().then(text => {
                if (response.status < 400) {
                    checkResult.innerText = chrome.i18n.getMessage('nc_check_ok');
                } else {
                    checkResult.innerText = chrome.i18n.getMessage('nc_check_error');
                    checkResult.classList.add('text-red');
                }
            });
        }, (reason => {
            checkResult.innerText = chrome.i18n.getMessage('nc_check_error');
            checkResult.classList.add('text-red');
        }));
    });

    const bitrix24CheckBtn = document.getElementById('bitrix24-check-btn');
    const bitrix24CheckResult = document.getElementById('bitrix24-check-result');
    if (bitrix24CheckBtn && bitrix24CheckResult) {
        bitrix24CheckBtn.textContent = chrome.i18n.getMessage('settings_check_btn');
        bitrix24CheckBtn.addEventListener('click', async () => {
            const baseUrl = (nextCloudSettings.bitrix24_webhook_url || '').trim().replace(/\/+$/, '');
            if (!baseUrl) {
                bitrix24CheckResult.textContent = chrome.i18n.getMessage('bitrix24_check_error');
                bitrix24CheckResult.classList.add('text-red');
                return;
            }
            try {
                const origin = new URL(baseUrl).origin;
                await chrome.permissions.request({ origins: [origin + '/*'] });
            } catch (e) { /* ignore */ }
            const url = baseUrl + (baseUrl.endsWith('/') ? '' : '/') + 'disk.storage.getlist';
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            const data = await res.json();
            if (data.result && Array.isArray(data.result)) {
                bitrix24CheckResult.textContent = chrome.i18n.getMessage('nc_check_ok');
                bitrix24CheckResult.classList.remove('text-red');
            } else {
                bitrix24CheckResult.textContent = (data.error_description || data.error || chrome.i18n.getMessage('nc_check_error'));
                bitrix24CheckResult.classList.add('text-red');
            }
        });
    }
}

function _showLoading()
{
    let settingsBtn = document.getElementById('settings-btn');
    let contentMain = document.getElementById('content-main');
    let contentRecord = document.getElementById('content-record');
    let resultNode = document.getElementById('result');
    let footerText = document.getElementById('footer-text');
    let uploadProgress = document.getElementById('indicator');

    settingsBtn.classList.add('d-none');
    contentMain.classList.add('d-none');
    resultNode.classList.add('d-none');
    contentRecord.classList.add('d-none');
    uploadProgress.classList.remove('d-none');

    footerText.innerText =  chrome.i18n.getMessage('next_cloud_file_uploading');
}

async function _showInitUi()
{
    chrome.action.setTitle({title: ``});
    chrome.action.setBadgeText({text:  ``});

    let saveBtn = document.getElementById('save-btn');
    let contentSettings = document.getElementById('content-settings');
    let contentMain = document.getElementById('content-main');
    let footer = document.getElementById('footer');
    let uploadProgress = document.getElementById('indicator');

    saveBtn.classList.add('d-none');
    uploadProgress.classList.add('d-none');
    contentSettings.classList.add('d-none');

    contentMain.classList.remove('d-none');
    footer.classList.remove('d-none');

    [
        'rec-no-sound-btn',
        'rec-with-sound-btn',
        'settings-btn',
        'footer-text',
    ].forEach((id) => {
        document.getElementById(id).classList.remove('d-none');
    });

    document.getElementById('content-record').classList.add('d-none');
    document.getElementById('footer-text').innerText = chrome.i18n.getMessage('footer_text');
    document.getElementById('pause').innerText = chrome.i18n.getMessage('pause');


    let lastNcLink = '';
    let resultContainer = document.getElementById('result');
    let link            = document.getElementById('link');
    let linkDt            = document.getElementById('link-dt');

    const lastScreencastLink = await chrome.storage.sync.get(["nc_last_link", "nc_last_link_date"]);
    if(lastScreencastLink && lastScreencastLink.hasOwnProperty('nc_last_link') && lastScreencastLink.nc_last_link !== '')
    {
        lastNcLink = lastScreencastLink.nc_last_link;
        resultContainer.classList.remove('d-none');
        link.classList.remove('d-none');
        link.setAttribute('href', lastNcLink);
        link.innerText = chrome.i18n.getMessage('link');

        if(lastScreencastLink.hasOwnProperty('nc_last_link_date'))
        {
            linkDt.classList.remove('d-none');
            linkDt.innerText = lastScreencastLink.nc_last_link_date;
        }
    }

    if(lastNcLink === 'local')
    {
        chrome.storage.local.get(["blob"]).then((result) => {
            link.addEventListener('click', function (e) {
                e.preventDefault();
                const tab = chrome.tabs.create({
                    url: chrome.runtime.getURL('download.html'),
                    pinned: false,
                    active: true,
                });
                return false;

            });
        });
    }

}

function _bindPauseButton()
{
    document.getElementById('pause').addEventListener('click', async () => {
        if(nextCloudSettings.paused)
        {
            nextCloudSettings.paused = false;
        }
        else
        {
            nextCloudSettings.paused = true;
        }

        updateSettings(() => {
            pauseRecording();
            _showPausedUi();
        });
    });
}

function _bindEndButton()
{
    document.getElementById('end').addEventListener('click', async () => {

        nextCloudSettings.recording = false;
        nextCloudSettings.paused = false;
        nextCloudSettings.with_sound = false;

        updateSettings(() => {
            stopRecording();
            _showLoading();
        });
    });
}

function _bindRecordButton() {
    document.querySelectorAll('.js-rec-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            let withSound =  btn.getAttribute('data-sound') * 1;

            nextCloudSettings.paused = false;
            nextCloudSettings.recording = true;
            nextCloudSettings.with_sound = true;

            updateSettings(() => {
                if(withSound) {
                    startRecording();
                    _showRecordingUi(true);
                } else {
                    startRecordingNoSound();
                    _showRecordingUi();
                }
            });
        });
    });
}

function _showRecordingUi(withSound)
{
    chrome.action.setBadgeText({text:  chrome.i18n.getMessage('rec')});
    chrome.action.setBadgeBackgroundColor({color: '#eb1e3e'});
    chrome.action.setTitle({title: chrome.i18n.getMessage('recording')});

    [
        'rec-no-sound-btn',
        'rec-with-sound-btn',
        'settings-btn'
    ].forEach((id) => {
        document.getElementById(id).classList.add('d-none');
    });

    document.getElementById('content-main').classList.add('d-none');
    document.getElementById('content-record').classList.remove('d-none');

    document.getElementById('footer-text').innerText = chrome.i18n.getMessage(withSound ? 'recording_footer_text_s' : 'recording_footer_text_no_s');
}

function _showPausedUi()
{
    let pauseBtn = document.getElementById('pause');
    let footerText = document.getElementById('footer-text');
    if(nextCloudSettings.paused)
    {
        pauseBtn.innerText = chrome.i18n.getMessage("resume");
        footerText.innerText = chrome.i18n.getMessage('recording_footer_text_paused');

        chrome.action.setBadgeText({text: chrome.i18n.getMessage('pause')});
        chrome.action.setTitle({title: ``});
        chrome.action.setBadgeBackgroundColor({color: '#eb881e'});
    }
    else
    {
        pauseBtn.innerText = chrome.i18n.getMessage("pause");
        footerText.innerText = chrome.i18n.getMessage(nextCloudSettings.with_sound ? 'recording_footer_text_s' : 'recording_footer_text_no_s');

        chrome.action.setBadgeText({text:  chrome.i18n.getMessage('rec')});
        chrome.action.setBadgeBackgroundColor({color: '#eb1e3e'});
        chrome.action.setTitle({title: chrome.i18n.getMessage('recording')});
    }
}

function _bindSettingsButton() {
    let btn = document.getElementById('settings-btn');
    let saveBtn = document.getElementById('save-btn');
    let cancelBtn = document.getElementById('cancel-btn');
    let contentMain = document.getElementById('content-main');
    let contentSettings = document.getElementById('content-settings');
    let footer = document.getElementById('footer');
    let result = document.getElementById('result');

    function closeSettings(restoreFromStorage) {
        saveBtn.classList.add('d-none');
        cancelBtn.classList.add('d-none');
        contentSettings.classList.add('d-none');
        btn.classList.remove('d-none');
        contentMain.classList.remove('d-none');
        footer.classList.remove('d-none');
        if (restoreFromStorage) {
            chrome.storage.sync.get(['next_cloud_settings']).then((item) => {
                if (item && item.next_cloud_settings) {
                    nextCloudSettings = item.next_cloud_settings;
                    _restoreSettingsFormFrom(nextCloudSettings);
                }
                _showResultLink();
            });
        } else {
            _showResultLink();
        }
    }

    btn.addEventListener('click', async () => {
        setTimeout(() => {
            btn.classList.add('d-none');
            contentMain.classList.add('d-none');
            footer.classList.add('d-none');
            result.classList.add('d-none');
            saveBtn.classList.remove('d-none');
            cancelBtn.classList.remove('d-none');
            contentSettings.classList.remove('d-none');
        }, 300);
    });

    saveBtn.addEventListener('click', async () => {
        if (nextCloudSettings.save_destination === 'nextcloud' && nextCloudSettings.schemeHost) {
            const origin = _originFromHost(nextCloudSettings.schemeHost);
            if (origin) {
                try {
                    await chrome.permissions.request({ origins: [origin + '/*'] });
                } catch (e) { /* user denied or invalid */ }
            }
        }
        if (nextCloudSettings.save_destination === 'bitrix24' && nextCloudSettings.bitrix24_webhook_url) {
            try {
                const baseUrl = (nextCloudSettings.bitrix24_webhook_url || '').trim().replace(/\/+$/, '');
                if (baseUrl) {
                    const origin = new URL(baseUrl.startsWith('http') ? baseUrl : 'https://' + baseUrl).origin;
                    await chrome.permissions.request({ origins: [origin + '/*'] });
                }
            } catch (e) { /* ignore */ }
        }
        setTimeout(() => closeSettings(false), 300);
    });

    cancelBtn.addEventListener('click', async () => {
        setTimeout(() => closeSettings(true), 300);
    });
}

function _showResultLink() {
    let result = document.getElementById('result');
    let linkDt = document.getElementById('link-dt');
    let link = document.getElementById('link');

    if(linkDt.innerText !== '' && link.innerText !== '')
    {
        result.classList.remove('d-none');
    }
}

function _showError(i18nKey)
{
    let contentError = document.getElementById('content-error');
    let contentMain = document.getElementById('content-main');
    let contentRecord = document.getElementById('content-record');
    let footerText = document.getElementById('footer-text');
    let uploadProgress = document.getElementById('upload-progress');

    const msg = i18nKey ? chrome.i18n.getMessage(i18nKey) : chrome.i18n.getMessage('error');
    contentError.innerText = msg;
    footerText.innerText = msg;

    footerText.classList.add('d-none');
    uploadProgress.classList.add('d-none');
    contentMain.classList.add('d-none');
    contentRecord.classList.add('d-none');
    contentError.classList.remove('d-none');
}

function updateSettings(cb) {
    chrome.storage.sync.set({next_cloud_settings: nextCloudSettings}).then(() => {
        if(cb)
        {
            cb();
        }
    });
}

const startRecording = () => {
    chrome.runtime.sendMessage({ name: 'initiateRecording' });
};

const startRecordingNoSound = () => {
    chrome.runtime.sendMessage({ name: 'initiateRecordingNoSound' });
};

const stopRecording = () => {

    chrome.runtime.sendMessage({ name: 'stopRecording' });
};

const pauseRecording = () => {
    if(nextCloudSettings.paused === true)
    {
        chrome.action.setBadgeText({text:  chrome.i18n.getMessage('rec')});
        chrome.action.setBadgeBackgroundColor({color: '#eb1e3e'});
        chrome.action.setTitle({title: chrome.i18n.getMessage('recording')});
    }
    else
    {

    }

    chrome.runtime.sendMessage({ name: 'pauseRecording' });
};


chrome.runtime.onMessage.addListener((message) => {
    let progressTextNode = document.getElementById('footer-text');
    let uploadProgressNode = document.getElementById('upload-progress');
    if (message.name === 'recordingCanceled') {
        nextCloudSettings.recording = false;
        nextCloudSettings.paused = false;
        nextCloudSettings.with_sound = false;
        updateSettings(() => _showInitUi());
        return;
    }
    if(message.name === 'nextCloudUploadFileError')
    {
        let i18nKey = 'upload_file_error';
        if (message.data === 'fetch_link_error') i18nKey = 'fetch_video_player_link_error';
        else if (message.data === 'bitrix24_upload_error') i18nKey = 'bitrix24_upload_error';
        _showError(i18nKey);
    }
    // Начало загрузки в nextcloud
    else if(message.name === 'beforeNextCloudUploadStart')
    {
        _showLoading();
        // Если понадобится выводить размер загружаемого файла
        // uploadFileSize = message.data;
    }
    // Файл загружен, ожидание получения ответа на запрос о файлах
    else if(message.name === 'nextCloudUploadWaitFetchLink')
    {
        _showLoading();
        progressTextNode.innerText = chrome.i18n.getMessage('next_cloud_wait_fetch_link');//'Upload completed. Wait for link...';
    }
    // Момент получения ссылки на файл -> считается финальным этапом
    else if(message.name === 'nextCloudUploadSuccess' || message.name === 'captureFinished')
    {
        _showInitUi();
        progressTextNode.innerText = chrome.i18n.getMessage('footer_text');
    }
    // Процесс загрузки файла в nextcloud...
    else if(message.name === 'nextCloudUploadProgress')
    {
        _showLoading();
        uploadProgressNode.value = message.data;
    }
});