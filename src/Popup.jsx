import { useState, useEffect, useCallback, useRef } from 'react';

const RECORDINGS_STORAGE_KEY = 'nj_screencast_recordings';

const defaultSettings = {
  save_destination: 'local',
  user: null,
  pass: null,
  dir: null,
  schemeHost: null,
  video_file_format: 'webm',
  bitrix24_webhook_url: null,
  bitrix24_storage_type: 'personal',
  bitrix24_folder_name: 'screen-recordings',
  locale: 'en',
  record_with_sound: true,
  record_with_camera: false,
  paused: false,
  recording: false,
  with_sound: false,
};

function storageLabel(dest, t) {
  if (dest === 'local') return t('save_destination_local');
  if (dest === 'nextcloud') return t('save_destination_nextcloud');
  if (dest === 'bitrix24') return t('save_destination_bitrix24');
  return dest || '';
}

function originFromHost(schemeHost) {
  const s = (schemeHost || '').trim().replace(/\/+$/, '');
  if (!s) return null;
  try {
    const url = s.startsWith('http') ? new URL(s) : new URL('https://' + s);
    return url.origin;
  } catch (e) {
    return null;
  }
}

function base64BasicAuth(user, pass) {
  const creds = (user || '') + ':' + (pass || '');
  try {
    const bytes = new TextEncoder().encode(creds);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch (_) {
    return btoa(creds);
  }
}

export default function NJScreencastUI() {
  const [screen, setScreen] = useState('main');
  const [connector, setConnector] = useState(null);
  const [settings, setSettingsState] = useState(defaultSettings);
  const [lastLink, setLastLink] = useState('');
  const [lastLinkDate, setLastLinkDate] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [ncCheckResult, setNcCheckResult] = useState({ ok: false, text: '' });
  const [bitrixCheckResult, setBitrixCheckResult] = useState({ ok: false, text: '' });
  const [messages, setMessages] = useState({});
  const [recordingsList, setRecordingsList] = useState([]);
  const [isCheckingNextcloud, setIsCheckingNextcloud] = useState(false);
  const [isCheckingBitrix24, setIsCheckingBitrix24] = useState(false);
  const hasLoadedFromStorage = useRef(false);

  const t = useCallback((key) => {
    const k = (key || '').replace(/-/g, '_');
    if (messages[k]?.message) return messages[k].message;
    return chrome.i18n?.getMessage(k) ?? key;
  }, [messages]);

  const setSettings = useCallback((next) => {
    setSettingsState((prev) => (typeof next === 'function' ? next(prev) : next));
  }, []);

  useEffect(() => {
    if (!hasLoadedFromStorage.current) return;
    chrome.storage.sync.set({ next_cloud_settings: settings });
  }, [settings]);

  const loadFromStorage = useCallback(() => {
    Promise.all([
      chrome.storage.sync.get(['next_cloud_settings', 'nc_last_link', 'nc_last_link_date']),
      chrome.storage.local.get(['nj_screencast_recording', RECORDINGS_STORAGE_KEY]),
    ]).then(([syncData, localData]) => {
      const recordingFlag = localData?.nj_screencast_recording;
      const isRecordingActive = recordingFlag && recordingFlag.active === true;
      const list = localData?.[RECORDINGS_STORAGE_KEY];
      if (Array.isArray(list)) setRecordingsList(list);
      const stored = syncData.next_cloud_settings;

      setSettingsState((prev) => {
        const loaded = stored ? { ...defaultSettings, ...stored } : { ...defaultSettings };
        if (isRecordingActive) return { ...loaded, recording: true, paused: !!loaded.paused, with_sound: !!recordingFlag?.with_sound };
        if (prev.recording && !loaded.recording) return { ...loaded, recording: true, paused: prev.paused, with_sound: prev.with_sound };
        return loaded;
      });
      if (syncData.nc_last_link) setLastLink(syncData.nc_last_link);
      if (syncData.nc_last_link_date) setLastLinkDate(syncData.nc_last_link_date);

      const locale = (stored?.locale || 'en');
      fetch(chrome.runtime.getURL('_locales/' + locale + '/messages.json'))
        .then((r) => r.json())
        .then((data) => setMessages(data))
        .catch(() => setMessages({}));

      hasLoadedFromStorage.current = true;
    });
  }, []);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  useEffect(() => {
    const listener = (changes, areaName) => {
      if (areaName === 'sync' && changes.next_cloud_settings) loadFromStorage();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [loadFromStorage]);

  useEffect(() => {
    if (typeof document.hidden === 'undefined') return;
    const onVisibility = () => { if (!document.hidden) loadFromStorage(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [loadFromStorage]);

  useEffect(() => {
    const root = document.getElementById('root');
    if (root) root.setAttribute('data-screen', screen);
  }, [screen]);

  useEffect(() => {
    const locale = settings.locale || 'en';
    fetch(chrome.runtime.getURL('_locales/' + locale + '/messages.json'))
      .then((r) => r.json())
      .then((data) => setMessages(data))
      .catch(() => setMessages({}));
  }, [settings.locale]);

  useEffect(() => {
    const listener = (message) => {
      if (message.name === 'recordingCanceled') {
        chrome.storage.local.remove('nj_screencast_recording');
        setSettings((s) => ({ ...s, recording: false, paused: false, with_sound: false }));
        setScreen('main');
        setUploading(false);
        chrome.action?.setBadgeText({ text: '' });
        chrome.action?.setTitle({ title: '' });
        return;
      }
      if (message.name === 'nextCloudUploadFileError') {
        const key = message.data === 'fetch_link_error' ? 'fetch_video_player_link_error' : message.data === 'bitrix24_upload_error' ? 'bitrix24_upload_error' : 'upload_file_error';
        setErrorMsg(t(key));
        setUploading(false);
        return;
      }
      if (message.name === 'beforeNextCloudUploadStart' || message.name === 'nextCloudUploadProgress') {
        setUploading(true);
        if (message.data != null) setUploadProgress(message.data);
      }
      if (message.name === 'nextCloudUploadWaitFetchLink') {
        setUploading(true);
      }
      if (message.name === 'nextCloudUploadSuccess' || message.name === 'captureFinished') {
        setUploading(false);
        chrome.action?.setBadgeText({ text: '' });
        chrome.action?.setTitle({ title: '' });
        const url = message.data?.url;
        const dateTime = message.data?.date_time || '';
        chrome.storage.sync.get(['nc_last_link', 'nc_last_link_date', 'next_cloud_settings']).then((d) => {
          if (d.nc_last_link) setLastLink(d.nc_last_link);
          if (d.nc_last_link_date) setLastLinkDate(d.nc_last_link_date);
          if (url != null) {
            const dest = d.next_cloud_settings?.save_destination || 'local';
            chrome.storage.local.get([RECORDINGS_STORAGE_KEY]).then((local) => {
              const list = Array.isArray(local[RECORDINGS_STORAGE_KEY]) ? local[RECORDINGS_STORAGE_KEY] : [];
              const newRec = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, link: url, date: dateTime, storage: dest, note: '' };
              const nextList = [newRec, ...list];
              chrome.storage.local.set({ [RECORDINGS_STORAGE_KEY]: nextList }).then(() => setRecordingsList(nextList));
            });
          }
        });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [setSettings]);

  const startRecording = (withSoundParam) => {
    const withSound = withSoundParam != null ? !!withSoundParam : !!settings.record_with_sound;
    const next = { ...settings, recording: true, paused: false, with_sound: withSound };
    chrome.storage.sync.set({ next_cloud_settings: next }).then(() => {
      setSettings((s) => ({ ...s, recording: true, paused: false, with_sound: withSound }));
      chrome.runtime.sendMessage({
        name: withSound ? 'initiateRecording' : 'initiateRecordingNoSound',
        settings: next,
      });
    });
    chrome.action?.setBadgeText({ text: t('rec') });
    chrome.action?.setBadgeBackgroundColor({ color: '#eb1e3e' });
    chrome.action?.setTitle({ title: t('recording') });
  };

  const clearExtensionIcon = () => {
    chrome.action?.setBadgeText({ text: '' });
    chrome.action?.setTitle({ title: '' });
  };

  const stopRecording = () => {
    clearExtensionIcon();
    chrome.storage.local.remove('nj_screencast_recording');
    setSettings((s) => ({ ...s, recording: false, paused: false, with_sound: false }));
    chrome.storage.sync.set({
      next_cloud_settings: { ...settings, recording: false, paused: false, with_sound: false },
    }).then(() => chrome.runtime.sendMessage({ name: 'stopRecording' }));
    setUploading(true);
  };

  const pauseRecording = () => {
    const nextPaused = !settings.paused;
    setSettings((s) => ({ ...s, paused: nextPaused }));
    chrome.storage.sync.set({
      next_cloud_settings: { ...settings, paused: nextPaused },
    }).then(() => chrome.runtime.sendMessage({ name: 'pauseRecording' }));
    if (nextPaused) {
      chrome.action?.setBadgeText({ text: t('pause') });
      chrome.action?.setBadgeBackgroundColor({ color: '#eb881e' });
      chrome.action?.setTitle({ title: t('pause') });
    } else {
      chrome.action?.setBadgeText({ text: t('rec') });
      chrome.action?.setBadgeBackgroundColor({ color: '#eb1e3e' });
      chrome.action?.setTitle({ title: t('recording') });
    }
  };

  const openLastLink = (e) => {
    if (lastLink !== 'local') return;
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('download.html'), active: true });
  };

  const destinations = [
    { id: 'local', name: t('save_destination_local'), status: t('always_available'), connected: true },
    { id: 'nextcloud', name: t('save_destination_nextcloud'), status: settings.schemeHost && settings.user ? t('nc_check_ok') : t('not_connected'), connected: !!(settings.schemeHost && settings.user) },
    { id: 'bitrix24', name: t('save_destination_bitrix24'), status: settings.bitrix24_webhook_url ? t('nc_check_ok') : t('not_connected'), connected: !!settings.bitrix24_webhook_url },
  ];

  const formatOptions = [
    { value: 'webm', label: 'WebM (VP9)' },
    { value: 'webm-vp8', label: 'WebM (VP8)' },
    { value: 'webm-vp9', label: 'WebM (VP9)' },
    { value: 'webm-h264', label: 'WebM (H.264)' },
    { value: 'mpeg', label: 'MP4 (H.264)' },
  ];

  const updateRecordingNote = (id, note) => {
    const next = recordingsList.map((r) => (r.id === id ? { ...r, note } : r));
    setRecordingsList(next);
    chrome.storage.local.set({ [RECORDINGS_STORAGE_KEY]: next });
  };

  const deleteRecording = (id) => {
    const next = recordingsList.filter((r) => r.id !== id);
    setRecordingsList(next);
    chrome.storage.local.set({ [RECORDINGS_STORAGE_KEY]: next });
  };

  const resetToDefault = () => {
    const reset = { ...defaultSettings, locale: settings.locale || 'en' };
    setSettingsState(reset);
    chrome.storage.sync.set({ next_cloud_settings: reset });
  };

  const saveConnectorAndBack = async () => {
    await chrome.storage.sync.set({ next_cloud_settings: settings });
    if (settings.save_destination === 'nextcloud' && settings.schemeHost) {
      const origin = originFromHost(settings.schemeHost);
      if (origin) try { await chrome.permissions.request({ origins: [origin + '/*'] }); } catch (_) {}
    }
    if (settings.save_destination === 'bitrix24' && settings.bitrix24_webhook_url) {
      try {
        const baseUrl = (settings.bitrix24_webhook_url || '').trim().replace(/\/+$/, '');
        if (baseUrl) {
          const origin = new URL(baseUrl.startsWith('http') ? baseUrl : 'https://' + baseUrl).origin;
          await chrome.permissions.request({ origins: [origin + '/*'] });
        }
      } catch (_) {}
    }
    setConnector(null);
  };

  const checkNextcloud = async () => {
    setIsCheckingNextcloud(true);
    setNcCheckResult({ ok: false, text: '' });
    try {
      const origin = originFromHost(settings.schemeHost);
      if (origin) try { await chrome.permissions.request({ origins: [origin + '/*'] }); } catch (_) {}
      let baseUri = (settings.schemeHost || '').trim().replace(/\/+$/, '');
      if (!baseUri.startsWith('http://') && !baseUri.startsWith('https://')) baseUri = 'https://' + baseUri;
      const user = (settings.user || '').trim();
      baseUri = baseUri + '/remote.php/dav/files/' + encodeURIComponent(user) + '/';
      const pass = (settings.pass || '').trim();
      const authHeader = base64BasicAuth(user, pass);
      const body = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns"><d:prop><oc:fileid /><d:getlastmodified /></d:prop></d:propfind>`;
      const res = await fetch(baseUri, { method: 'PROPFIND', cache: 'no-cache', credentials: 'omit', headers: { Accept: 'application/xml', Depth: '1', 'Content-Type': 'application/xml', Authorization: 'Basic ' + authHeader }, body });
      if (res.status < 400) setNcCheckResult({ ok: true, text: t('nc_check_ok') });
      else {
        const errText = res.status === 401
          ? t('nc_check_error') + ' (401). ' + t('nc_check_401_hint')
          : res.status === 403
            ? t('nc_check_error') + ' (403)'
            : t('nc_check_error') + ' (' + res.status + ')';
        setNcCheckResult({ ok: false, text: errText });
      }
    } catch (e) {
      setNcCheckResult({ ok: false, text: t('nc_check_error') + (e && e.message ? ' — ' + e.message : '') });
    } finally {
      setIsCheckingNextcloud(false);
    }
  };

  const checkBitrix24 = async () => {
    setIsCheckingBitrix24(true);
    setBitrixCheckResult({ ok: false, text: '' });
    try {
      const baseUrl = (settings.bitrix24_webhook_url || '').trim().replace(/\/+$/, '');
      if (!baseUrl) {
        setBitrixCheckResult({ ok: false, text: t('bitrix24_check_error') });
        return;
      }
      try {
        const origin = new URL(baseUrl.startsWith('http') ? baseUrl : 'https://' + baseUrl).origin;
        await chrome.permissions.request({ origins: [origin + '/*'] });
      } catch (_) {}
      const url = baseUrl + (baseUrl.endsWith('/') ? '' : '/') + 'disk.storage.getlist';
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.result && Array.isArray(data.result)) setBitrixCheckResult({ ok: true, text: t('nc_check_ok') });
      else setBitrixCheckResult({ ok: false, text: data.error_description || data.error || t('nc_check_error') });
    } catch (_) {
      setBitrixCheckResult({ ok: false, text: t('nc_check_error') });
    } finally {
      setIsCheckingBitrix24(false);
    }
  };

  if (errorMsg) {
    return (
      <div className="mx-auto w-[650px] bg-white">
        <p className="text-red-600">{errorMsg}</p>
        <button type="button" onClick={() => setErrorMsg('')} className="mt-4 cursor-pointer rounded-xl border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">
          {t('cancel_btn')}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-[650px] bg-white">
      <div className="border-b border-slate-200 px-6 py-5 flex items-center gap-4">
        <a href={t('logo_link')} target="_blank" rel="noopener noreferrer">
          <img src={chrome.runtime.getURL('images/logo.svg')} alt="NJ" className="h-8" />
        </a>
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">NJ Soft</p>
          <h1 className="text-2xl font-semibold">
            {screen === 'settings' && t('settings_btn')}
            {screen === 'main' && t('recorder_title')}
            {screen === 'recordings' && t('all_recordings_title')}
          </h1>
        </div>
      </div>

      {uploading && (
        <div className="px-6 py-6">
          <p className="text-sm text-slate-600">{t('next_cloud_file_uploading')}</p>
          <progress max="1" value={uploadProgress} className="mt-2 w-full" />
        </div>
      )}

      {!uploading && screen === 'main' && !settings.recording && (
        <div className="space-y-6 px-6 py-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-700">{t('record_camera_label')}</span>
              <button
                type="button"
                onClick={() => setSettings((s) => ({ ...s, record_with_camera: !s.record_with_camera }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.record_with_camera ? 'bg-emerald-500' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.record_with_camera ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-700">{t('record_sound_label')}</span>
              <button
                type="button"
                onClick={() => setSettings((s) => ({ ...s, record_with_sound: !s.record_with_sound }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.record_with_sound ? 'bg-emerald-500' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.record_with_sound ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {lastLink && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{t('last_recording')}</p>
                  <p className="text-sm text-slate-600">{lastLinkDate}</p>
                  <p className="text-xs text-slate-500">{t('saved_to')}: {settings.save_destination === 'local' ? t('save_destination_local') : settings.save_destination === 'nextcloud' ? t('save_destination_nextcloud') : t('save_destination_bitrix24')}</p>
                </div>
                {lastLink === 'local' ? (
                  <button type="button" onClick={openLastLink} className="cursor-pointer rounded-xl bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
                    {t('link')}
                  </button>
                ) : (
                  <a href={lastLink} target="_blank" rel="noopener noreferrer" className="cursor-pointer rounded-xl bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 inline-block">
                    {t('link')}
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setScreen('settings')} className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">
              {t('settings_btn')}
            </button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setScreen('recordings')}
                className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50"
              >
                {t('all_recordings_btn')}
              </button>
              <button
                type="button"
                onClick={() => startRecording()}
                className="cursor-pointer rounded-2xl bg-slate-900 px-6 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                {t('record_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {!uploading && screen === 'main' && settings.recording && (
        <div className="space-y-6 px-6 py-6">
          <p className="text-sm text-slate-600">
            {settings.paused ? t('recording_footer_text_paused') : settings.with_sound ? t('recording_footer_text_s') : t('recording_footer_text_no_s')}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={pauseRecording}
              className={`cursor-pointer rounded-2xl px-6 py-6 text-lg font-semibold ${settings.paused ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'border border-slate-200 hover:bg-slate-50'}`}
            >
              {settings.paused ? t('resume') : t('pause')}
            </button>
            <button type="button" onClick={stopRecording} className="cursor-pointer rounded-2xl bg-red-600 px-6 py-6 text-lg font-semibold text-white hover:bg-red-700">
              {t('end')}
            </button>
          </div>
        </div>
      )}

      {!uploading && screen === 'settings' && !connector && (
        <div className="space-y-6 px-6 py-6">
          {destinations.map((item) => {
            const isDisabled = item.id !== 'local' && !item.connected;
            return (
              <div key={item.id} className="flex items-center justify-between rounded-2xl border border-slate-200 p-4">
                <label className={`flex flex-1 cursor-pointer items-center gap-4 ${isDisabled ? 'cursor-not-allowed opacity-70' : ''}`}>
                  <input
                    type="radio"
                    name="destination"
                    checked={settings.save_destination === item.id}
                    disabled={isDisabled}
                    onChange={() => !isDisabled && setSettings((s) => ({ ...s, save_destination: item.id }))}
                    className="h-4 w-4"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div>
                    <p className="text-sm font-semibold">{item.name}</p>
                    <p className="text-xs text-slate-500">{item.status}</p>
                  </div>
                </label>
                {item.id !== 'local' && (
                  <button
                    type="button"
                    onClick={() => { setSettings((s) => ({ ...s, save_destination: item.id })); setConnector(item.id); }}
                    className={`cursor-pointer rounded-xl px-3 py-1 text-xs ${item.connected ? 'bg-slate-200 text-slate-700 hover:bg-slate-300' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                  >
                    {item.connected ? t('settings_btn') : t('connect_btn')}
                  </button>
                )}
              </div>
            );
          })}

          <div>
            <label className="mb-1 block text-sm">{t('select_codec')}</label>
            <select
              value={settings.video_file_format || 'webm'}
              onChange={(e) => setSettings((s) => ({ ...s, video_file_format: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2"
            >
              {formatOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm">{t('language_label')}</label>
            <select
              value={settings.locale || 'en'}
              onChange={(e) => setSettings((s) => ({ ...s, locale: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2"
            >
              <option value="en">{t('language_en')}</option>
              <option value="ru">{t('language_ru')}</option>
            </select>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <button type="button" onClick={() => setScreen('main')} className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">
              {t('back_btn')}
            </button>
            <button type="button" onClick={resetToDefault} className="cursor-pointer rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 hover:bg-red-100">
              {t('reset_default_btn')}
            </button>
          </div>
        </div>
      )}

      {connector === 'bitrix24' && (
        <div className="space-y-4 px-6 py-6">
          <h2 className="text-lg font-semibold">{t('save_destination_bitrix24')}</h2>
          <input
            placeholder={t('bitrix24_webhook_label')}
            value={settings.bitrix24_webhook_url || ''}
            onChange={(e) => setSettings((s) => ({ ...s, bitrix24_webhook_url: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2"
          />
          <select
            value={settings.bitrix24_storage_type || 'personal'}
            onChange={(e) => setSettings((s) => ({ ...s, bitrix24_storage_type: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2"
          >
            <option value="personal">{t('bitrix24_storage_personal')}</option>
            <option value="common">{t('bitrix24_storage_common')}</option>
          </select>
          <input
            placeholder={t('bitrix24_folder_label')}
            value={settings.bitrix24_folder_name || ''}
            onChange={(e) => setSettings((s) => ({ ...s, bitrix24_folder_name: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2"
          />
          <p className={bitrixCheckResult.ok ? 'text-green-600' : 'text-red-600'}>{bitrixCheckResult.text}</p>
          <button
            type="button"
            onClick={checkBitrix24}
            disabled={isCheckingBitrix24}
            className={`inline-flex items-center justify-center rounded-xl px-3 py-1 text-sm ${
              isCheckingBitrix24 ? 'bg-slate-200 text-slate-500 cursor-default opacity-60' : 'bg-slate-200 hover:bg-slate-300'
            }`}
          >
            {isCheckingBitrix24 && (
              <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
            )}
            {t('settings_check_btn')}
          </button>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setConnector(null)} className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">
              {t('cancel_btn')}
            </button>
            <button type="button" onClick={saveConnectorAndBack} className="cursor-pointer rounded-xl bg-slate-900 px-4 py-2 text-white">
              {t('save_btn')}
            </button>
          </div>
        </div>
      )}

      {connector === 'nextcloud' && (
        <div className="space-y-4 px-6 py-6">
          <h2 className="text-lg font-semibold">{t('save_destination_nextcloud')}</h2>
          <input
            placeholder={t('input_address')}
            value={settings.schemeHost || ''}
            onChange={(e) => setSettings((s) => ({ ...s, schemeHost: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2"
          />
          <input
            placeholder={t('input_dir')}
            value={settings.dir || ''}
            onChange={(e) => setSettings((s) => ({ ...s, dir: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2"
          />
          <input
            placeholder={t('input_username')}
            value={settings.user || ''}
            onChange={(e) => setSettings((s) => ({ ...s, user: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2"
          />
          <input
            type="password"
            placeholder={t('input_pass')}
            value={settings.pass || ''}
            onChange={(e) => setSettings((s) => ({ ...s, pass: e.target.value }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2"
          />
          <p className="text-xs text-slate-500">{t('pass_help')}</p>
          <p className={ncCheckResult.ok ? 'text-green-600' : 'text-red-600'}>{ncCheckResult.text}</p>
          <button
            type="button"
            onClick={checkNextcloud}
            disabled={isCheckingNextcloud}
            className={`inline-flex items-center justify-center rounded-xl px-3 py-1 text-sm ${
              isCheckingNextcloud ? 'bg-slate-200 text-slate-500 cursor-default opacity-60' : 'bg-slate-200 hover:bg-slate-300'
            }`}
          >
            {isCheckingNextcloud && (
              <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
            )}
            {t('settings_check_btn')}
          </button>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setConnector(null)} className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">
              {t('cancel_btn')}
            </button>
            <button type="button" onClick={saveConnectorAndBack} className="cursor-pointer rounded-xl bg-slate-900 px-4 py-2 text-white">
              {t('save_btn')}
            </button>
          </div>
        </div>
      )}

      {!uploading && screen === 'recordings' && (
        <div className="space-y-4 px-6 py-6">
          {recordingsList.length ? recordingsList.map((rec) => (
            <div key={rec.id} className="rounded-2xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-500">{rec.date}</p>
                  <p className="text-xs text-slate-500">{t('saved_to')}: {storageLabel(rec.storage, t)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {rec.link === 'local' ? (
                    <button type="button" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('download.html') })} className="cursor-pointer rounded-xl bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
                      {t('open_link')}
                    </button>
                  ) : (
                    <a href={rec.link} target="_blank" rel="noopener noreferrer" className="cursor-pointer rounded-xl bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 inline-block">
                      {t('open_link')}
                    </a>
                  )}
                  <button type="button" onClick={() => deleteRecording(rec.id)} className="cursor-pointer rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100">
                    {t('delete_recording_btn')}
                  </button>
                </div>
              </div>
              <input
                type="text"
                placeholder={t('recording_note_placeholder')}
                value={rec.note || ''}
                onChange={(e) => updateRecordingNote(rec.id, e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          )) : (
            <p className="text-sm text-slate-500">{t('footer_text')}</p>
          )}
          <button type="button" onClick={() => setScreen('main')} className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50">
            {t('back_btn')}
          </button>
        </div>
      )}
    </div>
  );
}
