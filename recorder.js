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
        if(item && item.hasOwnProperty('next_cloud_settings'))
        {
            nextCloud.setupFromStorage(item.next_cloud_settings);
        }

        let sound = false;
        if(audioStream)
        {
            sound = true;
            // Добавляем аудио в запись экрана
            audioStream.getTracks().forEach(track => mediaStream.addTrack(track));
        }

        const videoMime = nextCloud.getVideoMime();
        const options = { mimeType: videoMime };
        mediaRecorder = new MediaRecorder(mediaStream, options);

        chunks = [];

        mediaRecorder.ondataavailable = function(e) {
            if (event.data.size > 0) {
                chunks.push(e.data);
            }
        }

        mediaRecorder.onstop = async function(e) {
            mediaStream.getTracks().forEach(track => track.stop());
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
            if(nextCloud.hasSetup())
            {
                chrome.runtime.sendMessage({ name: 'beforeNextCloudUploadStart' , data: blobFile.size });
                nextCloud.uploadFile(blobFile, fileName).then(async function (response) {
                    chrome.runtime.sendMessage({ name: 'nextCloudUploadWaitFetchLink', data: '' });
                    nextCloud.fetchVideoPlayerLink(fileName).then((link) => {
                        let options = {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "numeric",
                            second: "numeric"
                        };
                        let dt = new Intl.DateTimeFormat(undefined, options).format(new Date());
                        chrome.storage.sync.set({nc_last_link: link, nc_last_link_date: dt});
                        chrome.runtime.sendMessage({ name: 'nextCloudUploadSuccess', data: { url: link, date_time: dt } });
                    });

                    setTimeout(function () {
                        window.close();
                    }, 2000);
                });
            }
            else
            {
                const downloadLink = document.createElement('a');
                downloadLink.href = url;
                downloadLink.download = fileName;
                window.document.body.appendChild(downloadLink);

                downloadLink.click();
                let dt = new Intl.DateTimeFormat(undefined, options).format(new Date());
                chrome.runtime.sendMessage({ name: 'captureFinished', data: { url: 'local', date_time: dt } });
                setTimeout(function () {
                    window.close();
                }, 2000);
            }
        }

        mediaRecorder.start();
    }).finally(async () => {
        // After all setup, focus on previous tab (where the recording was requested)
        await chrome.tabs.update(currentTabId, { active: true, selected: true })
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
    video_file_format: 'webp',
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
        this.video_file_format = ncSettings.hasOwnProperty('video_file_format') ? ncSettings.video_file_format : 'webp';
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
                        const nodes = this.parseWebDavFileListXML(text, nextCloud.base_uri(fileName));
                        let lastNode = nodes.pop();
                        if(lastNode && lastNode.hasOwnProperty('fileid'))
                        {
                            let playerLink = nextCloud.createPlayerLink(lastNode.fileid);
                            resolve(playerLink);
                        }
                        else
                        {
                            resolve(null);
                        }
                    } else {
                        reject(new Error({ response }), text)
                    }
                });
            }, (reason => {
                chrome.runtime.sendMessage({ name: 'nextCloudUploadFileError', data: 'fetch_link_error' });
                console.error('fetch_link_error');
            }));
        });

    },
    parseWebDavFileListXML: function(xmlString, path) {
        const dom = this.xmlParser.parseFromString(xmlString, 'application/xml')
        const responseList = dom.documentElement.getElementsByTagNameNS(this.ns, 'response')
        const result = {
            nodes: [],
        }
        for (let i = 0; i < responseList.length; i++)
        {
            const node = {}
            const e = responseList.item(i);
            node.fileid = e.getElementsByTagName('oc:fileid')?.item(0)?.innerHTML ?? 0
            node.lastmod = e.getElementsByTagNameNS(this.ns, 'getlastmodified').item(0).innerHTML
            result.nodes.push(node)
        }

        return result.nodes;
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
            headers: {
                "Content-Type": "application/octet-stream",
                "Authorization": this.createAuthHeaderValue()
            },
            body: blob.stream().pipeThrough(progressTrackingStream),
            duplex: "half",
        }).then(() => {}, (reason => {
            chrome.runtime.sendMessage({ name: 'nextCloudUploadFileError', data: 'upload_error' });
            console.error('upload_error');
        }));
    },
    createAuthHeaderValue: () => {
        return "Basic " + btoa(this.user + ":" + this.pass);
    }
};