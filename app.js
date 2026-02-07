// ============================================================
// VoiceBox — voice-to-text PWA
// ============================================================

// ----- Service Worker Registration -----
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/voicebox/sw.js');
}

// ----- IndexedDB (audio + metadata store) -----
const DB_NAME = 'voicebox';
const DB_VERSION = 1;
const STORE = 'recordings';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ----- Settings (localStorage) -----
function getApiKey() {
  return localStorage.getItem('voicebox_api_key') || '';
}
function setApiKey(key) {
  localStorage.setItem('voicebox_api_key', key);
}

// ----- DOM refs -----
const $ = (s) => document.querySelector(s);
const views = {
  record: $('#view-record'),
  result: $('#view-result'),
  settings: $('#view-settings'),
};

// Record view
const btnRecord = $('#btn-record');
const btnSettings = $('#btn-settings');
const recordingIndicator = $('#recording-indicator');
const recordingTime = $('#recording-time');
const recordHint = $('#record-hint');
const historyList = $('#history-list');
const historyEmpty = $('#history-empty');

// Result view
const btnResultBack = $('#btn-result-back');
const btnDelete = $('#btn-delete');
const btnRetry = $('#btn-retry');
const btnCopy = $('#btn-copy');
const btnShare = $('#btn-share');
const transcribingSpinner = $('#transcribing-spinner');
const transcribeError = $('#transcribe-error');
const errorMsg = $('#error-msg');
const resultTextWrap = $('#result-text-wrap');
const resultText = $('#result-text');
const resultDate = $('#result-date');
const resultDuration = $('#result-duration');
const resultActions = $('#result-actions');

// Settings view
const btnSettingsBack = $('#btn-settings-back');
const btnSaveKey = $('#btn-save-key');
const btnTestKey = $('#btn-test-key');
const btnToggleKey = $('#btn-toggle-key');
const apiKeyInput = $('#api-key-input');
const settingsStatus = $('#settings-status');

// ----- View navigation -----
let currentView = 'record';

function showView(name) {
  views[currentView]?.classList.remove('active');
  views[name]?.classList.add('active');
  currentView = name;
  window.scrollTo(0, 0);
}

// ----- Toast -----
let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  clearTimeout(toastTimer);
  // Force reflow for re-trigger
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ----- Recording state -----
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = 0;
let timerInterval = null;

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function startTimer() {
  recordingStartTime = Date.now();
  recordingTime.textContent = '0:00';
  timerInterval = setInterval(() => {
    const elapsed = (Date.now() - recordingStartTime) / 1000;
    recordingTime.textContent = formatDuration(elapsed);
  }, 250);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];

    // Prefer webm/opus, fall back to whatever the browser supports
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';

    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const duration = (Date.now() - recordingStartTime) / 1000;
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
      await saveAndTranscribe(blob, duration);
    };

    mediaRecorder.start(250); // collect in 250ms chunks
    btnRecord.classList.add('recording');
    recordingIndicator.classList.remove('hidden');
    recordHint.textContent = 'Tap to stop';
    startTimer();
  } catch (err) {
    toast('Microphone access denied');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  btnRecord.classList.remove('recording');
  recordingIndicator.classList.add('hidden');
  recordHint.textContent = 'Tap to record';
  stopTimer();
}

btnRecord.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
  } else {
    startRecording();
  }
});

// ----- Save & Transcribe flow -----
let activeRecordId = null;

async function saveAndTranscribe(blob, duration) {
  // 1. Save audio to IndexedDB FIRST — never lose audio
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const record = {
    id,
    timestamp: Date.now(),
    duration,
    mimeType: blob.type,
    audio: blob,
    status: 'pending',   // pending | done | error
    text: '',
    error: '',
  };
  await dbPut(record);

  // 2. Show result view with spinner
  activeRecordId = id;
  showResultView(record);
  showView('result');

  // 3. Refresh the history list in the background
  renderHistory();

  // 4. Attempt transcription
  await transcribe(id);
}

async function transcribe(id) {
  const record = await dbGet(id);
  if (!record) return;

  const apiKey = getApiKey();
  if (!apiKey) {
    record.status = 'error';
    record.error = 'No API key set. Go to Settings to add your OpenAI key.';
    await dbPut(record);
    if (activeRecordId === id) showResultView(record);
    renderHistory();
    return;
  }

  // Show spinner
  if (activeRecordId === id) {
    transcribingSpinner.classList.remove('hidden');
    transcribeError.classList.add('hidden');
    resultTextWrap.classList.add('hidden');
    resultActions.classList.add('hidden');
  }

  try {
    // Determine file extension from mime
    let ext = 'webm';
    if (record.mimeType.includes('mp4')) ext = 'mp4';
    else if (record.mimeType.includes('ogg')) ext = 'ogg';
    else if (record.mimeType.includes('wav')) ext = 'wav';

    const formData = new FormData();
    formData.append('file', record.audio, `recording.${ext}`);
    formData.append('model', 'whisper-1');

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!resp.ok) {
      const body = await resp.text();
      let msg = `API error ${resp.status}`;
      try { msg = JSON.parse(body).error?.message || msg; } catch {}
      throw new Error(msg);
    }

    const data = await resp.json();
    record.status = 'done';
    record.text = data.text || '';
    record.error = '';
  } catch (err) {
    record.status = 'error';
    record.error = err.message || 'Transcription failed';
  }

  await dbPut(record);
  if (activeRecordId === id) showResultView(record);
  renderHistory();
}

// ----- Result view rendering -----
function showResultView(record) {
  // Meta
  resultDate.textContent = new Date(record.timestamp).toLocaleString();
  resultDuration.textContent = formatDuration(record.duration);

  // Reset states
  transcribingSpinner.classList.add('hidden');
  transcribeError.classList.add('hidden');
  resultTextWrap.classList.add('hidden');
  resultActions.classList.add('hidden');

  if (record.status === 'pending') {
    transcribingSpinner.classList.remove('hidden');
  } else if (record.status === 'error') {
    transcribeError.classList.remove('hidden');
    errorMsg.textContent = record.error || 'Transcription failed';
    // Still show text area if there was a previous partial result
    if (record.text) {
      resultTextWrap.classList.remove('hidden');
      resultText.value = record.text;
      resultActions.classList.remove('hidden');
    }
  } else if (record.status === 'done') {
    resultTextWrap.classList.remove('hidden');
    resultText.value = record.text;
    resultActions.classList.remove('hidden');
  }
}

// ----- History rendering -----
async function renderHistory() {
  const records = await dbGetAll();
  records.sort((a, b) => b.timestamp - a.timestamp);

  if (records.length === 0) {
    historyEmpty.classList.remove('hidden');
    // Remove any items but keep the empty state
    historyList.querySelectorAll('.history-item').forEach((el) => el.remove());
    return;
  }

  historyEmpty.classList.add('hidden');
  // Clear old items
  historyList.querySelectorAll('.history-item').forEach((el) => el.remove());

  for (const rec of records) {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.dataset.id = rec.id;

    const iconClass = rec.status === 'done' ? 'done' : rec.status === 'error' ? 'failed' : 'pending';
    const iconSymbol = rec.status === 'done' ? '\u2713' : rec.status === 'error' ? '!' : '\u25CF';
    const preview = rec.status === 'done'
      ? (rec.text.slice(0, 60) + (rec.text.length > 60 ? '...' : ''))
      : rec.status === 'error'
        ? 'Transcription failed'
        : 'Pending transcription';

    el.innerHTML = `
      <div class="history-item-icon ${iconClass}">${iconSymbol}</div>
      <div class="history-item-body">
        <div class="history-item-text">${escapeHtml(preview)}</div>
        <div class="history-item-meta">${new Date(rec.timestamp).toLocaleString()} &middot; ${formatDuration(rec.duration)}</div>
      </div>
      <div class="history-item-arrow">&rsaquo;</div>
    `;

    el.addEventListener('click', () => openRecord(rec.id));
    historyList.appendChild(el);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function openRecord(id) {
  const record = await dbGet(id);
  if (!record) return;
  activeRecordId = id;
  showResultView(record);
  showView('result');
}

// ----- Result view actions -----
btnResultBack.addEventListener('click', () => {
  activeRecordId = null;
  showView('record');
});

btnRetry.addEventListener('click', async () => {
  if (!activeRecordId) return;
  const record = await dbGet(activeRecordId);
  if (!record) return;
  record.status = 'pending';
  record.error = '';
  await dbPut(record);
  showResultView(record);
  await transcribe(activeRecordId);
});

btnDelete.addEventListener('click', async () => {
  if (!activeRecordId) return;
  if (!confirm('Delete this recording?')) return;
  await dbDelete(activeRecordId);
  activeRecordId = null;
  showView('record');
  renderHistory();
  toast('Recording deleted');
});

btnCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(resultText.value);
    toast('Copied to clipboard');
  } catch {
    // Fallback
    resultText.select();
    document.execCommand('copy');
    toast('Copied to clipboard');
  }
});

btnShare.addEventListener('click', async () => {
  if (navigator.share) {
    try {
      await navigator.share({ text: resultText.value });
    } catch {
      // User cancelled — no-op
    }
  } else {
    // Fallback to copy
    await navigator.clipboard.writeText(resultText.value);
    toast('Copied (sharing not supported on this device)');
  }
});

// ----- Settings -----
btnSettings.addEventListener('click', () => {
  apiKeyInput.value = getApiKey();
  settingsStatus.textContent = '';
  settingsStatus.className = 'settings-status';
  showView('settings');
});

btnSettingsBack.addEventListener('click', () => {
  showView('record');
});

btnToggleKey.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

btnSaveKey.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  setApiKey(key);
  settingsStatus.textContent = key ? 'Key saved' : 'Key cleared';
  settingsStatus.className = 'settings-status success';
});

btnTestKey.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    settingsStatus.textContent = 'Enter a key first';
    settingsStatus.className = 'settings-status error';
    return;
  }

  settingsStatus.textContent = 'Testing...';
  settingsStatus.className = 'settings-status';

  try {
    // Create a tiny silent audio blob to test the key
    const sampleRate = 16000;
    const numSamples = sampleRate; // 1 second
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    // WAV header
    const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);
    // Samples stay silent (zeros)

    const testBlob = new Blob([buffer], { type: 'audio/wav' });
    const formData = new FormData();
    formData.append('file', testBlob, 'test.wav');
    formData.append('model', 'whisper-1');

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: formData,
    });

    if (resp.ok) {
      settingsStatus.textContent = 'Key is valid!';
      settingsStatus.className = 'settings-status success';
    } else {
      const body = await resp.json().catch(() => ({}));
      const msg = body.error?.message || `Error ${resp.status}`;
      settingsStatus.textContent = msg;
      settingsStatus.className = 'settings-status error';
    }
  } catch (err) {
    settingsStatus.textContent = 'Network error — check your connection';
    settingsStatus.className = 'settings-status error';
  }
});

// ----- Init -----
renderHistory();
