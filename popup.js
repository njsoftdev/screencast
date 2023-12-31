let nextCloudSettings = {
    user: null,
    pass: null,
    dir: null,
    schemeHost: null,
    video_file_format: 'webp',
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
        'rec-no-sound-btn',
        'rec-with-sound-btn',
        'pause',
        'end',
        'select-codec',
        'nc-settings-info',
        'footer-text',
        'settings-check-btn',
        'pass-help'
    ].forEach(function (id) {
        document.getElementById(id).innerText = chrome.i18n.getMessage(id.replace(/-/g, '_'));
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

function _bindSettingsForm()
{
    const checkResult = document.getElementById('nc-check-result');
    checkResult.classList.remove('text-red');

    let schemeHost = document.getElementById('input-address');
    let ncDir = document.getElementById('input-dir');
    let ncUser = document.getElementById('input-username');
    let ncPass = document.getElementById('input-pass');
    let formatSelector = document.getElementById('video-file-format-selector');

    [schemeHost, ncDir, ncUser, ncPass, formatSelector].forEach((node) => {
        let key = node.getAttribute('data-map');
        if(nextCloudSettings.hasOwnProperty(key) && nextCloudSettings[key] !== null && nextCloudSettings[key] !== '')
        {
            node.value = nextCloudSettings[key];
        }
        node.addEventListener('keyup', function () {

            nextCloudSettings[key] = node.value;
            updateSettings();
        });
    });

    if(nextCloudSettings.schemeHost)
    {
        document.getElementById('pass-help').innerHTML = chrome.i18n.getMessage('pass_help_w_link').replace('link', '"'+nextCloudSettings.schemeHost+'/settings/user/security"');
    }

    formatSelector.addEventListener('change', function (e) {
        nextCloudSettings.video_file_format = e.target.value;
        updateSettings();
    });

    let checkBtn = document.getElementById('settings-check-btn');
    checkBtn.addEventListener('click', async () => {
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
        link.innerText = chrome.i18n.getMessage('Link');

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
    let contentMain = document.getElementById('content-main');
    let contentSettings = document.getElementById('content-settings')
    let footer = document.getElementById('footer');
    let result = document.getElementById('result');

    btn.addEventListener('click', async () => {
        setTimeout(() => {
            btn.classList.add('d-none');
            contentMain.classList.add('d-none');
            footer.classList.add('d-none');
            result.classList.add('d-none');

            saveBtn.classList.remove('d-none');
            contentSettings.classList.remove('d-none');
        }, 300);
    });

    saveBtn.addEventListener('click', async () => {
        setTimeout(() => {
            saveBtn.classList.add('d-none');
            contentSettings.classList.add('d-none');

            btn.classList.remove('d-none');
            contentMain.classList.remove('d-none');
            footer.classList.remove('d-none');
            _showResultLink();
        }, 300);
    })
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

function _showError(msg)
{
    let contentError = document.getElementById('content-error');
    let contentMain = document.getElementById('content-main');
    let contentRecord = document.getElementById('content-record');
    let footerText = document.getElementById('footer-text');
    let uploadProgress = document.getElementById('upload-progress');

    contentError.innerText = chrome.i18n.getMessage('error');
    footerText.innerText = chrome.i18n.getMessage('error');

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
    if(message.name === 'nextCloudUploadFileError')
    {
        _showError(message.data);
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