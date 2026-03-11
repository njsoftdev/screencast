var paused = false;
var mediaRecorder = null;
var chunks = [];
var canvasAnimationId = null;
var cameraStream = null;
chrome.runtime.onMessage.addListener((message) => {
  if (message.name === 'startRecording') {
    startRecording(message.body.currentTab.id)
  }
  if (message.name === 'startRecordingNoSound') {
    startRecording(message.body.currentTab.id, true)
  }
  if (message.name === 'stopRecording') {
    mediaRecorder.stop();
  }
  if(message.name === 'pauseRecording')
  {
      if(mediaRecorder)
      {
          if(paused === false)
          {
              mediaRecorder.pause();
              paused = true;
          }
          else
          {
              mediaRecorder.resume();
              paused = false;
          }
      }
  }
});

var dontCloseEl = document.getElementById('dont-close-window');
if (dontCloseEl) dontCloseEl.innerText = chrome.i18n.getMessage('dont_close_window');
var recordingTitleEl = document.getElementById('recording-title');
if (recordingTitleEl) recordingTitleEl.innerText = chrome.i18n.getMessage('recording');

function startRecording(currentTabId, noSound){
  // Prompt user to choose screen or window
  chrome.desktopCapture.chooseDesktopMedia(
    ['screen'],
    function (streamId) {
      if (streamId == null) {
        chrome.runtime.sendMessage({ name: 'recordingCanceled' });
        window.close();
        return;
      }
      if(noSound)
      {
          return recordScreen(currentTabId, streamId);
      }
      // Получим запись с микрофона
      navigator.mediaDevices.getUserMedia({audio: true, video: false}).then((audioStream) => {
          if(audioStream)
          {
            return recordScreen(currentTabId, streamId, audioStream);
          }

          return recordScreen(currentTabId, streamId);
      });

    })
}

async function recordScreen(currentTabId, streamId, audioStream)
{
    // Получим запись с экрана
    navigator.mediaDevices.getUserMedia({
        video: {
            mandatory: {
                chromeMediaSource: 'screen',
                chromeMediaSourceId: streamId
            }
        }
    }).then(async mediaStream => {
        const item = await chrome.storage.sync.get(['next_cloud_settings']);
        const settings = item && item.next_cloud_settings ? item.next_cloud_settings : {};
        if (item && item.hasOwnProperty('next_cloud_settings')) {
            nextCloud.setupFromStorage(settings);
        }
        if (settings.save_destination === 'bitrix24' && (settings.bitrix24_webhook_url || '').trim()) {
            bitrix24.setupFromStorage(settings);
        }

        var recordWithCamera = !!settings.record_with_camera; // use camera overlay regardless of save_destination (Nextcloud/Bitrix24/local)

        let sound = false;
        if(audioStream)
        {
            sound = true;
            // Добавляем аудио в запись экрана
            audioStream.getTracks().forEach(track => mediaStream.addTrack(track));
        }

        const videoMime = nextCloud.getVideoMime();
        if (!nextCloud.isCodecSupported(videoMime)) {
            mediaStream.getTracks().forEach(track => track.stop());
            if (audioStream) audioStream.getTracks().forEach(track => track.stop());
            _showError(chrome.i18n.getMessage('codec_not_supported'));
            chrome.runtime.sendMessage({ name: 'recordingCanceled' });
            return;
        }
        const options = { mimeType: videoMime };

        var streamForRecorder = mediaStream;
        // Если включена камера, пытаемся добавить картинку камеры поверх экрана через canvas
        if (recordWithCamera && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                var screenVideo = document.createElement('video');
                screenVideo.srcObject = mediaStream;
                screenVideo.muted = true;
                screenVideo.play();

                var camVideo = document.createElement('video');
                camVideo.srcObject = cameraStream;
                camVideo.muted = true;
                camVideo.play();

                var canvas = document.createElement('canvas');
                var screenTrack = mediaStream.getVideoTracks()[0];
                var trackSettings = screenTrack && screenTrack.getSettings ? screenTrack.getSettings() : {};
                canvas.width = trackSettings.width || 1280;
                canvas.height = trackSettings.height || 720;
                var ctx = canvas.getContext('2d');

                var mixedStream = canvas.captureStream(30);
                var canvasTrack = mixedStream.getVideoTracks()[0];
                var requestFrame = canvasTrack && typeof canvasTrack.requestFrame === 'function' ? canvasTrack.requestFrame.bind(canvasTrack) : null;
                mediaStream.getAudioTracks().forEach(function (track) {
                    mixedStream.addTrack(track);
                });

                await new Promise(function (resolve) {
                    function waitReady() {
                        if (screenVideo.readyState >= 2) {
                            resolve();
                            return;
                        }
                        setTimeout(waitReady, 50);
                    }
                    waitReady();
                });

                function drawFrame() {
                    if (screenVideo.readyState >= 2) {
                        ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
                    }
                    if (camVideo.readyState >= 2) {
                        var size = Math.floor(canvas.height * 0.25);
                        var x = canvas.width - size - 24;
                        var y = canvas.height - size - 24;
                        ctx.save();
                        ctx.beginPath();
                        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
                        ctx.clip();
                        ctx.drawImage(camVideo, x, y, size, size);
                        ctx.restore();
                    }
                    if (requestFrame) requestFrame();
                    canvasAnimationId = requestAnimationFrame(drawFrame);
                }
                drawFrame();
                streamForRecorder = mixedStream;
            } catch (e) {
                cameraStream = null;
            }
        }

        mediaRecorder = new MediaRecorder(streamForRecorder, options);

        chunks = [];

        mediaRecorder.ondataavailable = function(e) {
            if (e.data.size > 0) {
                chunks.push(e.data);
            }
        }

        mediaRecorder.onstop = async function(e) {
            mediaStream.getTracks().forEach(track => track.stop());
            if (cameraStream) {
                cameraStream.getTracks().forEach(function (t) { t.stop(); });
                cameraStream = null;
            }
            if (canvasAnimationId) {
                cancelAnimationFrame(canvasAnimationId);
                canvasAnimationId = null;
            }
            var item = await chrome.storage.sync.get(['next_cloud_settings']);
            var settingsOnStop = (item && item.next_cloud_settings) ? item.next_cloud_settings : {};
            if (item && item.next_cloud_settings) nextCloud.setupFromStorage(settingsOnStop);
            if ((settingsOnStop.save_destination === 'bitrix24') && (settingsOnStop.bitrix24_webhook_url || '').trim()) {
                bitrix24.setupFromStorage(settingsOnStop);
            }

            const blobFileSource = new Blob(chunks, {type: nextCloud.getVideoMime()});
            var blobFile = blobFileSource;
            var url = URL.createObjectURL(blobFileSource);
            try {
                const webMBuf = await fetch(URL.createObjectURL(blobFileSource)).then(res=> res.arrayBuffer());
                const decoder = new EBML.Decoder();
                const reader = new EBML.Reader();
                reader.drop_default_duration = false;
                var last_duration = 0;

                reader.addListener("duration", ({timecodeScale, duration})=>{
                    last_duration += duration;
                });

                const elms = decoder.decode(webMBuf);
                elms.forEach((elm)=>{ reader.read(elm); });
                reader.stop();

                const refinedMetadataBuf = EBML.tools.makeMetadataSeekable(reader.metadatas, last_duration, reader.cues);
                const body = webMBuf.slice(reader.metadataSize);

                blobFile = new Blob([refinedMetadataBuf, body], {type: nextCloud.getVideoMime()});
                url = URL.createObjectURL(blobFile);
            } catch (ebmlErr) {
                // EBML fix failed (e.g. canvas recording produces invalid VINT) — use raw blob
                console.warn('EBML duration fix skipped:', ebmlErr && ebmlErr.message);
            }
            const fileName = 'Screen-recording-'+Date.now()+(sound ? '-with-sound' : '-no-sound') + '.' + nextCloud.getVideoFileFormat();
            const saveDestination = settingsOnStop.save_destination || 'local';

            if (saveDestination === 'bitrix24' && bitrix24.hasSetup()) {
                chrome.runtime.sendMessage({ name: 'beforeNextCloudUploadStart', data: blobFile.size });
                bitrix24.uploadFile(blobFile, fileName).then(function (fileLink) {
                    const dt = new Intl.DateTimeFormat(undefined, {
                        year: "numeric", month: "short", day: "numeric",
                        hour: "numeric", minute: "numeric", second: "numeric"
                    }).format(new Date());
                    chrome.storage.sync.set({ nc_last_link: fileLink, nc_last_link_date: dt });
                    chrome.runtime.sendMessage({ name: 'nextCloudUploadSuccess', data: { url: fileLink, date_time: dt } });
                    _closeRecorder();
                }).catch(function (err) {
                    chrome.runtime.sendMessage({ name: 'nextCloudUploadFileError', data: 'bitrix24_upload_error' });
                    _downloadLocal(url, fileName);
                    _saveLocal(blobFile);
                    _showError(chrome.i18n.getMessage('bitrix24_upload_error'));
                    console.error('bitrix24_upload_error', err);
                });
                return;
            }

            if (saveDestination === 'nextcloud' && nextCloud.hasSetup()) {
                var origin = nextCloud.getOrigin();
                if (origin) {
                    chrome.runtime.sendMessage({ name: 'ensureNextcloudPermission', origin: origin }, function () {
                        _doNextcloudUpload(blobFile, url, fileName);
                    });
                } else {
                    _doNextcloudUpload(blobFile, url, fileName);
                }
                return;
            }

            _downloadLocal(url, fileName);
            _saveLocal(blobFile);
            _closeRecorder();
        };

        mediaRecorder.start();
    }).finally(async () => {
        // After all setup, focus on previous tab (where the recording was requested)
        await chrome.tabs.update(currentTabId, { active: true, selected: true })
    });
}

function _saveLocal(blobRaw)
{
    // Сохраняем чтобы локально было
    if(blobRaw)
    {
        let reader = new FileReader();
        reader.readAsDataURL(blobRaw);
        reader.onload = function() {
            chrome.storage.local.set({ blob: reader.result }).then(() => {});
            let dt = new Intl.DateTimeFormat(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "numeric",
                second: "numeric"
            }).format(new Date());

            chrome.storage.sync.set({nc_last_link: 'local', nc_last_link_date: dt});
            chrome.runtime.sendMessage({ name: 'captureFinished', data: { url: 'local', date_time: dt } });
        };
    }
}

function _downloadLocal(url, fileName)
{
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = fileName;
    window.document.body.appendChild(downloadLink);

    downloadLink.click();
}

function _closeRecorder()
{
    setTimeout(function () {
        window.close();
    }, 2000);
}

function _showError(msg) {
    alert(msg);
    document.getElementById('dont-close-window').innerText = msg;
}

function _doNextcloudUpload(blobFile, url, fileName) {
    chrome.runtime.sendMessage({ name: 'beforeNextCloudUploadStart', data: blobFile.size });
    nextCloud.uploadFile(blobFile, fileName)
        .then(function (response) {
            chrome.runtime.sendMessage({ name: 'nextCloudUploadWaitFetchLink', data: '' });
            return nextCloud.createPublicShareLink(fileName);
        })
        .then(function (link) {
            var dt = new Intl.DateTimeFormat(undefined, {
                year: "numeric", month: "short", day: "numeric",
                hour: "numeric", minute: "numeric", second: "numeric"
            }).format(new Date());
            chrome.storage.sync.set({ nc_last_link: link || '', nc_last_link_date: dt });
            chrome.runtime.sendMessage({ name: 'nextCloudUploadSuccess', data: { url: link || '', date_time: dt } });
            _closeRecorder();
        })
        .catch(function (reason) {
            const errMsg = reason && (reason.message || String(reason)) || 'upload_error';
            chrome.runtime.sendMessage({ name: 'nextCloudUploadFileError', data: errMsg });
            _downloadLocal(url, fileName);
            _saveLocal(blobFile);
            var displayMsg = chrome.i18n.getMessage('upload_file_error');
            if (errMsg && errMsg !== 'upload_error') displayMsg = displayMsg + ' ' + errMsg;
            _showError(displayMsg);
            console.error('upload_file_error', reason);
        });
}

function _base64BasicAuth(user, pass) {
    var creds = (user || '') + ':' + (pass || '');
    try {
        var bytes = new TextEncoder().encode(creds);
        var binary = '';
        for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    } catch (e) {
        return btoa(unescape(encodeURIComponent(creds)));
    }
}

let nextCloud = {
    ns: 'DAV:',
    getOrigin: function () {
        var host = (this.schemeHost || '').trim().replace(/\/+$/, '');
        if (!host) return '';
        try {
            var u = new URL(host.indexOf('://') >= 0 ? host : 'https://' + host);
            return u.origin;
        } catch (e) {
            return host.startsWith('http') ? host.split('/').slice(0, 3).join('/') : 'https://' + host;
        }
    },
    createPlayerLink: function (fileId) {
        return this.schemeHost + '/apps/files/?dir=' + (this.dir || '') + '&openfile=' + fileId
    },
    isCodecSupported: function (codec) {
        return MediaRecorder.isTypeSupported(codec) ? true : false;
    },
    getVideoFileFormat: function () {
        if(this.video_file_format === 'mpeg')
        {
            return "mp4";
        }

        return "webm";
    },
    getVideoMime: function () {
        if(this.video_file_format === 'mpeg')
        {
            return "video/mpeg";
        }
        else if(this.video_file_format === 'webm-vp8')
        {
            return "video/webm; codecs=vp8";
        }
        else if(this.video_file_format === 'webm-vp9')
        {
            return "video/webm; codecs=vp9";
        }
        else if(this.video_file_format === 'webm-h264')
        {
            return "video/webm; codecs=h264";
        }

        return "video/webm";
    },
    xmlParser: new DOMParser(),
    video_file_format: 'webm',
    user: '',
    pass: '',
    dir: '',
    schemeHost: '', //без trailing slah
    hasSetup: function () {
        return (this.schemeHost !== null && this.schemeHost !== '')
            && (this.pass !== null && this.pass !== '')
            && (this.user !== null && this.user !== '');
    },
    setupFromStorage: function (ncSettings) {
        /**
         * user: null,
         pass: null,
         dir: null,
         schemeHost: null
         */
        this.user = ncSettings.user;
        this.pass = ncSettings.pass;
        this.dir = ncSettings.dir;
        this.schemeHost = ncSettings.schemeHost;
        this.video_file_format = ncSettings.hasOwnProperty('video_file_format') ? ncSettings.video_file_format : 'webm';
    },
    base_uri: function () {
        var host = (this.schemeHost || '').trim().replace(/\/+$/, '');
        if (!host.match(/^https?:\/\//)) host = 'https://' + host;
        var user = encodeURIComponent((this.user || '').trim());
        var dir = (this.dir || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
        var dirEnc = dir ? dir.split('/').map(encodeURIComponent).join('/') + '/' : '';
        return host + '/remote.php/dav/files/' + user + '/' + dirEnc;
    },
    upload_path: function (fileName) {
        return this.base_uri() + encodeURIComponent(fileName);
    },
    ocsFilePath: function (fileName) {
        var dir = (this.dir || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
        return '/' + (dir ? dir + '/' : '') + fileName;
    },
    createPublicShareLink: async function (fileName) {
        var host = (this.schemeHost || '').trim().replace(/\/+$/, '');
        if (!host.match(/^https?:\/\//)) host = 'https://' + host;
        var ocsUrl = host + '/ocs/v2.php/apps/files_sharing/api/v1/shares';
        var path = this.ocsFilePath(fileName);
        var body = 'path=' + encodeURIComponent(path) + '&shareType=3&permissions=1';
        var createRes = await fetch(ocsUrl, {
            method: 'POST',
            credentials: 'omit',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': this.createAuthHeaderValue(),
                'OCS-APIRequest': 'true'
            },
            body: body
        });
        var createText = await createRes.text();
        if (!createRes.ok) {
            throw new Error('Share create ' + createRes.status + ': ' + (createText || createRes.statusText).slice(0, 200));
        }
        var parser = new DOMParser();
        var doc = parser.parseFromString(createText, 'text/xml');
        var dataEl = doc.querySelector('data');
        if (dataEl) {
            var urlEl = dataEl.querySelector('url');
            if (urlEl) return (urlEl.textContent || '').trim();
        }
        var idEl = doc.querySelector('id');
        var shareId = idEl ? (idEl.textContent || '').trim() : '';
        if (!shareId) return null;
        var getUrl = host + '/ocs/v2.php/apps/files_sharing/api/v1/shares/' + shareId;
        var getRes = await fetch(getUrl, {
            method: 'GET',
            credentials: 'omit',
            headers: {
                'Authorization': this.createAuthHeaderValue(),
                'OCS-APIRequest': 'true'
            }
        });
        var getText = await getRes.text();
        if (!getRes.ok) return null;
        var getDoc = parser.parseFromString(getText, 'text/xml');
        var urlEl = getDoc.querySelector('url');
        if (urlEl) return (urlEl.textContent || '').trim();
        var tokenEl = getDoc.querySelector('token');
        if (tokenEl) {
            var token = (tokenEl.textContent || '').trim();
            var base = host.replace(/\/+$/, '');
            return token ? (base + '/index.php/s/' + token) : null;
        }
        return null;
    },
    fetchVideoPlayerLink: async function (fileName) {
        const propertyRequestBody = `<?xml version="1.0"?>
<d:propfind  xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:prop>
        <oc:fileid />
        <d:getlastmodified />
  </d:prop>
</d:propfind>`;

        return new Promise((resolve, reject) => {
            fetch(this.base_uri(), {
                method: 'PROPFIND',
                credentials: 'omit',
                headers: {
                    "Accept": "text/plain",
                    "Depth": 1,
                    "Content-Type": "application/xml",
                    "Authorization": this.createAuthHeaderValue()
                },
                body: propertyRequestBody
            }).then((response) => {
                return response.text().then(text => {
                    if (response.status < 400) {
                        const nodes = this.parseWebDavFileListXML(text);
                        const targetNode = nodes.find((node) => {
                            const href = (node.href || '').trim();
                            const path = href.replace(/^https?:\/\/[^/]+/, '');
                            const decoded = decodeURIComponent(path);
                            const name = decoded.split('/').pop() || '';
                            return name === fileName || decoded.endsWith('/' + fileName);
                        });
                        if (targetNode && targetNode.fileid) {
                            const playerLink = nextCloud.createPlayerLink(targetNode.fileid);
                            resolve(playerLink);
                        } else {
                            resolve(null);
                        }
                    } else {
                        reject(new Error('PROPFIND ' + response.status + ': ' + (text || response.statusText).slice(0, 150)));
                    }
                });
            }).catch((reason) => {
                var err = reason && (reason.message || String(reason)) || 'fetch_link_error';
                reject(new Error(err));
            });
        });

    },
    parseWebDavFileListXML: function(xmlString) {
        const dom = this.xmlParser.parseFromString(xmlString, 'application/xml');
        const responseList = dom.documentElement.getElementsByTagNameNS(this.ns, 'response');
        const nodes = [];
        for (let i = 0; i < responseList.length; i++) {
            const e = responseList.item(i);
            const hrefEl = e.getElementsByTagNameNS(this.ns, 'href').item(0);
            const getlastmodifiedEl = e.getElementsByTagNameNS(this.ns, 'getlastmodified').item(0);
            const fileidEl = e.getElementsByTagName('oc:fileid')?.item(0);
            nodes.push({
                href: hrefEl ? (hrefEl.textContent || hrefEl.innerHTML || '').trim() : '',
                fileid: fileidEl ? (fileidEl.textContent || fileidEl.innerHTML || '').trim() : '',
                lastmod: getlastmodifiedEl ? (getlastmodifiedEl.textContent || getlastmodifiedEl.innerHTML || '') : ''
            });
        }
        return nodes;
    },
    uploadFile: async function (blob, fileName) {
        let url = this.upload_path(fileName);

        const totalBytes = blob.size;
        let bytesUploaded = 0;

        // Use a custom TransformStream to track upload progress
        const progressTrackingStream = new TransformStream({
            transform(chunk, controller) {
                controller.enqueue(chunk);
                bytesUploaded += chunk.byteLength;
                chrome.runtime.sendMessage({ name: 'nextCloudUploadProgress', data: bytesUploaded / totalBytes });
            },
            flush(controller) {
                console.log("completed stream");
            },
        });
        const response = await fetch(url, {
            method: "PUT",
            credentials: 'omit',
            headers: {
                "Content-Type": "application/octet-stream",
                "Authorization": this.createAuthHeaderValue()
            },
            body: blob.stream().pipeThrough(progressTrackingStream),
            duplex: "half",
        });
        if (!response.ok) {
            const errText = await response.text().catch(() => response.statusText);
            throw new Error('Upload ' + response.status + ': ' + (errText || response.statusText).slice(0, 200));
        }
        return response;
    },
    createAuthHeaderValue: function () {
        return "Basic " + _base64BasicAuth(this.user, this.pass);
    }
};

let bitrix24 = {
    webhookBaseUrl: '',
    storageType: 'personal',
    folderName: 'screen-recordings',
    hasSetup: function () {
        var url = (this.webhookBaseUrl || '').trim();
        return url.length > 0 && (url.startsWith('http://') || url.startsWith('https://'));
    },
    setupFromStorage: function (settings) {
        this.webhookBaseUrl = (settings.bitrix24_webhook_url || '').trim().replace(/\/+$/, '');
        this.storageType = settings.bitrix24_storage_type || 'personal';
        this.folderName = (settings.bitrix24_folder_name || 'screen-recordings').trim() || 'screen-recordings';
    },
    _call: function (method, params) {
        var methodPath = method.indexOf('.json') === -1 ? method + '.json' : method;
        var url = this.webhookBaseUrl + (this.webhookBaseUrl.endsWith('/') ? '' : '/') + methodPath;
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params || {})
        }).then(function (res) { return res.json(); });
    },
    getDefaultStorage: function () {
        var wantCommon = this.storageType === 'common';
        return this._call('disk.storage.getlist').then(function (data) {
            if (!data.result || !Array.isArray(data.result)) return Promise.reject(new Error(data.error_description || 'No storages'));
            var list = data.result;
            var storage = wantCommon
                ? list.find(function (s) { return s.ENTITY_TYPE === 'common'; }) || list[0]
                : list.find(function (s) { return s.ENTITY_TYPE === 'user'; }) || list[0];
            return { id: storage.ID, rootId: storage.ROOT_OBJECT_ID };
        });
    },
    getOrCreateFolderId: function (storage) {
        var self = this;
        var folderName = this.folderName;
        return this._call('disk.storage.getchildren', { id: storage.id }).then(function (data) {
            if (data.error) return Promise.reject(new Error(data.error_description || data.error));
            var children = data.result || [];
            var folder = children.find(function (o) { return o.TYPE === 'folder' && String(o.NAME || '').trim() === folderName; });
            if (folder && folder.ID) return parseInt(folder.ID, 10) || folder.ID;
            return self._call('disk.storage.addfolder', {
                id: parseInt(storage.id, 10),
                data: { NAME: folderName }
            }).then(function (addRes) {
                if (addRes.error) return Promise.reject(new Error(addRes.error_description || addRes.error));
                return parseInt(addRes.result && addRes.result.ID, 10) || addRes.result.ID;
            });
        });
    },
    uploadFile: function (blob, fileName) {
        var self = this;
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                var base64 = (reader.result || '').split(',')[1] || reader.result;
                if (!base64) return reject(new Error('Base64 failed'));
                self.getDefaultStorage().then(function (storage) {
                    return self.getOrCreateFolderId(storage).then(function (folderId) {
                        return self._call('disk.folder.uploadfile', {
                            id: folderId,
                            data: { NAME: fileName },
                            fileContent: [fileName, base64],
                            generateUniqueName: true
                        });
                    });
                }).then(function (data) {
                    if (data.error) return reject(new Error(data.error_description || data.error || 'Bitrix24 error'));
                    var result = data.result;
                    var fileId = result && (result.ID || result.REAL_OBJECT_ID);
                    if (!fileId) {
                        var portalUrl = self.webhookBaseUrl.replace(/\/rest\/.*$/, '');
                        return resolve(result && result.DOWNLOAD_URL || portalUrl + '/disk/');
                    }
                    return self._call('disk.file.getExternalLink', { id: parseInt(fileId, 10) || fileId }).then(function (linkData) {
                        if (linkData.error || !linkData.result) {
                            var fallback = result.DOWNLOAD_URL || (self.webhookBaseUrl.replace(/\/rest\/.*$/, '') + '/disk/showFile/' + fileId + '/');
                            return resolve(fallback);
                        }
                        resolve(typeof linkData.result === 'string' ? linkData.result : (result.DOWNLOAD_URL || result.DETAIL_URL));
                    }).catch(function () {
                        var portalUrl = self.webhookBaseUrl.replace(/\/rest\/.*$/, '');
                        resolve(result.DOWNLOAD_URL || portalUrl + '/disk/showFile/' + fileId + '/');
                    });
                }).catch(reject);
            };
            reader.onerror = function () { reject(reader.error); };
            reader.readAsDataURL(blob);
        });
    }
};