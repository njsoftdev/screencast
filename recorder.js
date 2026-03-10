var paused = false;
var mediaRecorder = null;
var chunks = [];
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

document.getElementById('dont-close-window').innerText = chrome.i18n.getMessage('dont_close_window');

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
        mediaRecorder = new MediaRecorder(mediaStream, options);

        chunks = [];

        mediaRecorder.ondataavailable = function(e) {
            if (e.data.size > 0) {
                chunks.push(e.data);
            }
        }

        mediaRecorder.onstop = async function(e) {
            mediaStream.getTracks().forEach(track => track.stop());
            var item = await chrome.storage.sync.get(['next_cloud_settings']);
            var settingsOnStop = (item && item.next_cloud_settings) ? item.next_cloud_settings : {};
            if (item && item.next_cloud_settings) nextCloud.setupFromStorage(settingsOnStop);
            if ((settingsOnStop.save_destination === 'bitrix24') && (settingsOnStop.bitrix24_webhook_url || '').trim()) {
                bitrix24.setupFromStorage(settingsOnStop);
            }

            const blobFileSource = new Blob(chunks, {type: nextCloud.getVideoMime()});
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

            const blobFile = new Blob([refinedMetadataBuf, body], {type: nextCloud.getVideoMime()});
            const url = URL.createObjectURL(blobFile);
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
                _doNextcloudUpload(blobFile, url, fileName);
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
            return nextCloud.fetchVideoPlayerLink(fileName);
        })
        .then(function (link) {
            var dt = new Intl.DateTimeFormat(undefined, {
                year: "numeric", month: "short", day: "numeric",
                hour: "numeric", minute: "numeric", second: "numeric"
            }).format(new Date());
            chrome.storage.sync.set({ nc_last_link: link, nc_last_link_date: dt });
            chrome.runtime.sendMessage({ name: 'nextCloudUploadSuccess', data: { url: link, date_time: dt } });
            _closeRecorder();
        })
        .catch(function (reason) {
            chrome.runtime.sendMessage({ name: 'nextCloudUploadFileError', data: 'upload_error' });
            _downloadLocal(url, fileName);
            _saveLocal(blobFile);
            _showError(chrome.i18n.getMessage('upload_file_error'));
            console.error('upload_file_error');
        });
}

let nextCloud = {
    ns: 'DAV:',
    createPlayerLink: function (fileId) {
        return this.schemeHost + '/apps/files/?dir=' +this.dir+'&openfile=' + fileId
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
        return this.schemeHost !== null && this.schemeHost !== ''
            && this.dir !== null && this.dir !== ''
            && this.pass !== null && this.pass !== ''
            && this.user !== null && this.user !== ''
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
        return this.schemeHost + '/remote.php/dav/files/' + this.user + this.dir;
    },
    upload_path: function (fileName) {
        return this.base_uri() + '/' + fileName
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
                headers: {
                    "Accept": "text/plain",
                    "Depth": 1,
                    "Content-Type": "application/xml",
                    "Authorization": this.createAuthHeaderValue()
                },
                body: propertyRequestBody
            }).then((response) => {
                response.text().then(text => {
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
                        reject(new Error('PROPFIND failed: ' + response.status));
                    }
                });
            }, (reason) => {
                chrome.runtime.sendMessage({ name: 'nextCloudUploadFileError', data: 'fetch_link_error' });
                console.error('fetch_link_error');
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
        return await fetch(url, {
            method: "PUT",
            headers: {
                "Content-Type": "application/octet-stream",
                "Authorization": this.createAuthHeaderValue()
            },
            body: blob.stream().pipeThrough(progressTrackingStream),
            duplex: "half",
        });
    },
    createAuthHeaderValue: () => {
        return "Basic " + btoa(this.user + ":" + this.pass);
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