// ============================================================
// VoiceBox — voice-to-text PWA (v2)
// ============================================================

// ----- Service Worker Registration -----
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/voicebox/sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      // Check for updates on every page load
      reg.update();
    });
  // Auto-reload when new service worker activates
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'SW_UPDATED') {
      window.location.reload();
    }
  });
}

// ----- IndexedDB -----
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

async function dbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ----- Settings (localStorage) -----
function getApiKey() { return localStorage.getItem('voicebox_api_key') || ''; }
function setApiKey(key) { localStorage.setItem('voicebox_api_key', key); }
function getVocab() { return localStorage.getItem('voicebox_vocab') || ''; }
function setVocab(v) { localStorage.setItem('voicebox_vocab', v); }
function getTargetApp() { return localStorage.getItem('voicebox_target_app') || 'none'; }
function setTargetApp(id) { localStorage.setItem('voicebox_target_app', id); }

// ----- App targets for auto-launch -----
const APP_TARGETS = [
  { id: 'claude',   name: 'Claude',   url: 'claude://' },
  { id: 'chatgpt',  name: 'ChatGPT',  url: 'chatgpt://' },
  { id: 'gemini',   name: 'Gemini',   url: 'googlegemini://' },
  { id: 'grok',     name: 'Grok',     url: 'grok://' },
  { id: 'notes',    name: 'Notes',    url: 'mobilenotes://' },
  { id: 'obsidian', name: 'Obsidian', url: 'obsidian://' },
  { id: 'none',     name: 'Clipboard', url: null },
];

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
const recordBtnLabel = $('#record-btn-label');
const historyList = $('#history-list');
const historyEmpty = $('#history-empty');
const btnClearAll = $('#btn-clear-all');

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
const appSelectorEl = $('#app-selector');

// Settings view
const btnSettingsBack = $('#btn-settings-back');
const btnSaveKey = $('#btn-save-key');
const btnTestKey = $('#btn-test-key');
const btnToggleKey = $('#btn-toggle-key');
const apiKeyInput = $('#api-key-input');
const settingsStatus = $('#settings-status');
const vocabInput = $('#vocab-input');
const btnSaveVocab = $('#btn-save-vocab');
const storageInfo = $('#storage-info');
const btnDeleteAll = $('#btn-delete-all');

// ----- View navigation -----
let currentView = 'record';

function showView(name) {
  views[currentView]?.classList.remove('active');
  views[name]?.classList.add('active');
  currentView = name;
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
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ----- Clipboard helper -----
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  }
}

// Deferred clipboard for iOS Safari — clipboard.write() must be called
// in a user gesture, but the data can be provided via a promise that
// resolves later (e.g. after an API call completes).
let pendingClipboardResolve = null;

function setupDeferredClipboard() {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return false;
  }
  try {
    let newResolve;
    const textPromise = new Promise((resolve) => {
      newResolve = resolve;
    });
    navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': textPromise.then(
          (text) => new Blob([text], { type: 'text/plain' })
        ),
      }),
    ]);
    // Only update resolve if write() didn't throw
    pendingClipboardResolve = newResolve;
    return true;
  } catch {
    // Don't null out existing resolve — keep earlier setup (e.g. from pointerdown)
    return false;
  }
}

function resolveDeferredClipboard(text) {
  if (pendingClipboardResolve) {
    pendingClipboardResolve(text);
    pendingClipboardResolve = null;
    return true;
  }
  return false;
}

// ----- Formatting -----
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// RECORDING — tap-to-toggle
// ============================================================

let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = 0;
let timerInterval = null;

// Tap-to-toggle recording

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

    mediaRecorder.start(250);
    btnRecord.classList.add('recording');
    recordBtnLabel.textContent = 'Tap to stop';
    recordingIndicator.classList.remove('hidden');
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
  recordBtnLabel.textContent = 'Tap to record';
  stopTimer();
}

function isRecording() {
  return mediaRecorder && mediaRecorder.state === 'recording';
}

// Tap to toggle recording — set up deferred clipboard on every tap
// so iOS Safari can write to clipboard after async transcription
btnRecord.addEventListener('click', () => {
  setupDeferredClipboard();
  if (isRecording()) {
    stopRecording();
  } else {
    startRecording();
  }
});

// ============================================================
// SAVE & TRANSCRIBE
// ============================================================

let activeRecordId = null;

async function saveAndTranscribe(blob, duration) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const record = {
    id,
    timestamp: Date.now(),
    duration,
    mimeType: blob.type,
    audio: blob,
    status: 'pending',
    text: '',
    error: '',
  };
  await dbPut(record);

  // Stay on record view — never show result screen after recording.
  // User can tap history items to see transcriptions.
  renderHistory();
  toast('Transcribing...');
  await transcribe(id);

  // Show error toast if transcription failed
  const updated = await dbGet(id);
  if (updated && updated.status === 'error') {
    toast(updated.error || 'Transcription failed');
  }
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

  if (activeRecordId === id) {
    transcribingSpinner.classList.remove('hidden');
    transcribeError.classList.add('hidden');
    resultTextWrap.classList.add('hidden');
    resultActions.classList.add('hidden');
  }

  try {
    if (!record.audio) {
      throw new Error('Audio blob was cleaned up. Transcription unavailable.');
    }

    let ext = 'webm';
    if (record.mimeType.includes('mp4')) ext = 'mp4';
    else if (record.mimeType.includes('ogg')) ext = 'ogg';
    else if (record.mimeType.includes('wav')) ext = 'wav';

    const formData = new FormData();
    formData.append('file', record.audio, `recording.${ext}`);
    formData.append('model', 'whisper-1');

    // Add custom vocabulary as prompt for better accuracy
    const vocab = getVocab();
    if (vocab.trim()) {
      formData.append('prompt', vocab.trim());
    }

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

  // Auto-copy on successful transcription + auto-launch app
  if (record.status === 'done' && record.text) {
    // Try both: deferred clipboard (iOS Safari) and direct copy (other browsers).
    // One or both may succeed depending on user gesture timing.
    resolveDeferredClipboard(record.text);
    await copyText(record.text);
    const targetId = getTargetApp();
    const target = APP_TARGETS.find((a) => a.id === targetId);
    if (target && target.url) {
      toast(`Copied! Opening ${target.name}...`);
      setTimeout(() => { window.location.href = target.url; }, 400);
    } else {
      toast('Copied!');
    }
  }
}

// ============================================================
// RESULT VIEW
// ============================================================

function showResultView(record) {
  resultDate.textContent = new Date(record.timestamp).toLocaleString();
  resultDuration.textContent = formatDuration(record.duration);

  transcribingSpinner.classList.add('hidden');
  transcribeError.classList.add('hidden');
  resultTextWrap.classList.add('hidden');
  resultActions.classList.add('hidden');

  if (record.status === 'pending') {
    transcribingSpinner.classList.remove('hidden');
  } else if (record.status === 'error') {
    transcribeError.classList.remove('hidden');
    errorMsg.textContent = record.error || 'Transcription failed';
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

btnResultBack.addEventListener('click', () => {
  activeRecordId = null;
  stopPlayback();
  showView('record');
});

btnRetry.addEventListener('click', async () => {
  if (!activeRecordId) return;
  const record = await dbGet(activeRecordId);
  if (!record) return;
  setupDeferredClipboard();
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
  await copyText(resultText.value);
  toast('Copied to clipboard');
});

btnShare.addEventListener('click', async () => {
  if (navigator.share) {
    try {
      await navigator.share({ text: resultText.value });
    } catch { /* user cancelled */ }
  } else {
    await copyText(resultText.value);
    toast('Copied (sharing not supported on this device)');
  }
});

// ============================================================
// APP SELECTOR (auto-launch target)
// ============================================================

function initAppSelector() {
  const saved = getTargetApp();
  appSelectorEl.innerHTML = '';

  for (const app of APP_TARGETS) {
    const pill = document.createElement('button');
    pill.className = 'app-pill' + (app.id === saved ? ' active' : '');
    pill.textContent = app.name;
    pill.dataset.app = app.id;

    pill.addEventListener('click', () => {
      appSelectorEl.querySelectorAll('.app-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      setTargetApp(app.id);
    });

    appSelectorEl.appendChild(pill);
  }
}

// ============================================================
// AUDIO PLAYBACK (in history items)
// ============================================================

let currentAudio = null;
let currentPlayBtn = null;
let playAnimFrame = null;

function stopPlayback() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (currentPlayBtn) {
    updatePlayBtnIcon(currentPlayBtn, false);
    resetProgressRing(currentPlayBtn);
    currentPlayBtn = null;
  }
  cancelAnimationFrame(playAnimFrame);
}

function updatePlayBtnIcon(btn, isPlaying) {
  const svg = btn.querySelector('.play-pause-icon');
  if (!svg) return;
  if (isPlaying) {
    svg.innerHTML = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
  } else {
    svg.innerHTML = '<polygon points="6,4 20,12 6,20"/>';
  }
}

function resetProgressRing(btn) {
  const fg = btn.querySelector('.ring-fg');
  if (fg) fg.style.strokeDashoffset = fg.getAttribute('data-circumference');
}

function updateProgressRing(btn, progress) {
  const fg = btn.querySelector('.ring-fg');
  if (!fg) return;
  const c = parseFloat(fg.getAttribute('data-circumference'));
  fg.style.strokeDashoffset = c - (c * progress);
}

async function togglePlayback(recordId, btn) {
  // If same button is playing, pause it
  if (currentPlayBtn === btn && currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    updatePlayBtnIcon(btn, false);
    cancelAnimationFrame(playAnimFrame);
    return;
  }

  // If different audio is playing, stop it
  stopPlayback();

  const record = await dbGet(recordId);
  if (!record || !record.audio) {
    toast('Audio not available');
    return;
  }

  const url = URL.createObjectURL(record.audio);
  currentAudio = new Audio(url);
  currentPlayBtn = btn;

  currentAudio.addEventListener('ended', () => {
    URL.revokeObjectURL(url);
    updatePlayBtnIcon(btn, false);
    resetProgressRing(btn);
    currentAudio = null;
    currentPlayBtn = null;
  });

  currentAudio.addEventListener('error', () => {
    URL.revokeObjectURL(url);
    toast('Playback error');
    stopPlayback();
  });

  updatePlayBtnIcon(btn, true);
  currentAudio.play();

  // Animate progress ring
  function animateRing() {
    if (!currentAudio || currentAudio.paused) return;
    if (currentAudio.duration && isFinite(currentAudio.duration)) {
      updateProgressRing(btn, currentAudio.currentTime / currentAudio.duration);
    }
    playAnimFrame = requestAnimationFrame(animateRing);
  }
  animateRing();
}

// ============================================================
// HISTORY — render + swipe-to-delete
// ============================================================

async function renderHistory() {
  const records = await dbGetAll();
  records.sort((a, b) => b.timestamp - a.timestamp);

  // Clear old items
  historyList.querySelectorAll('.history-item-wrap').forEach((el) => el.remove());

  if (records.length === 0) {
    historyEmpty.classList.remove('hidden');
    btnClearAll.classList.add('hidden');
    return;
  }

  historyEmpty.classList.add('hidden');
  btnClearAll.classList.remove('hidden');

  for (const rec of records) {
    const wrap = document.createElement('div');
    wrap.className = 'history-item-wrap';
    wrap.dataset.id = rec.id;

    // Swipe-to-delete background
    const delBg = document.createElement('div');
    delBg.className = 'history-item-delete-bg';
    delBg.textContent = 'Delete';
    wrap.appendChild(delBg);

    const el = document.createElement('div');
    el.className = 'history-item';

    const iconClass = rec.status === 'done' ? 'done' : rec.status === 'error' ? 'failed' : 'pending';
    const iconSymbol = rec.status === 'done' ? '\u2713' : rec.status === 'error' ? '!' : '\u25CF';
    const preview = rec.status === 'done'
      ? (rec.text.slice(0, 50) + (rec.text.length > 50 ? '...' : ''))
      : rec.status === 'error'
        ? 'Transcription failed'
        : 'Pending transcription';

    const hasAudio = !!rec.audio;
    const circumference = Math.PI * 2 * 14.5; // radius for 36px button with 2.5px stroke

    el.innerHTML = `
      <div class="history-item-icon ${iconClass}">${iconSymbol}</div>
      <div class="history-item-body">
        <div class="history-item-text">${escapeHtml(preview)}</div>
        <div class="history-item-meta">${new Date(rec.timestamp).toLocaleString()} &middot; ${formatDuration(rec.duration)}</div>
      </div>
      ${hasAudio ? `<button class="history-play-btn" data-id="${rec.id}" aria-label="Play">
        <svg class="play-progress-ring" viewBox="0 0 36 36">
          <circle class="ring-bg" cx="18" cy="18" r="14.5"/>
          <circle class="ring-fg" cx="18" cy="18" r="14.5"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${circumference}"
            data-circumference="${circumference}"/>
        </svg>
        <svg class="play-pause-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>
      </button>` : ''}
      <div class="history-item-arrow">&rsaquo;</div>
    `;

    wrap.appendChild(el);
    historyList.appendChild(wrap);

    // Play button click (stop propagation so it doesn't open the record)
    const playBtn = el.querySelector('.history-play-btn');
    if (playBtn) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlayback(rec.id, playBtn);
      });
    }

    // Tap to open record detail
    el.addEventListener('click', () => openRecord(rec.id));

    // Swipe-to-delete
    setupSwipeToDelete(wrap, el, rec.id);
  }
}

function setupSwipeToDelete(wrap, el, id) {
  let startX = 0;
  let currentX = 0;
  let swiping = false;

  el.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    currentX = startX;
    swiping = true;
    el.style.transition = 'none';
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!swiping) return;
    currentX = e.touches[0].clientX;
    const dx = Math.min(0, currentX - startX); // only left swipe
    el.style.transform = `translateX(${dx}px)`;
  }, { passive: true });

  el.addEventListener('touchend', async () => {
    if (!swiping) return;
    swiping = false;
    el.style.transition = 'transform 0.2s ease';
    const dx = currentX - startX;
    if (dx < -80) {
      // Swiped far enough — delete
      el.style.transform = `translateX(-100%)`;
      setTimeout(async () => {
        await dbDelete(id);
        renderHistory();
        toast('Recording deleted');
      }, 200);
    } else {
      el.style.transform = 'translateX(0)';
    }
  });
}

async function openRecord(id) {
  const record = await dbGet(id);
  if (!record) return;
  stopPlayback();
  activeRecordId = id;
  showResultView(record);
  showView('result');
}

// ============================================================
// STORAGE MANAGEMENT
// ============================================================

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

async function cleanupOldAudio() {
  const records = await dbGetAll();
  const cutoff = Date.now() - THIRTY_DAYS;
  let cleaned = 0;

  for (const rec of records) {
    if (rec.audio && rec.timestamp < cutoff) {
      rec.audio = null; // Remove blob but keep text
      await dbPut(rec);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`Cleaned audio from ${cleaned} recordings older than 30 days`);
  }
}

async function calculateStorage() {
  const records = await dbGetAll();
  let totalBytes = 0;
  let count = 0;

  for (const rec of records) {
    count++;
    if (rec.audio) {
      totalBytes += rec.audio.size || 0;
    }
    // Estimate text size
    totalBytes += (rec.text?.length || 0) * 2;
  }

  return { count, totalBytes };
}

async function updateStorageInfo() {
  const { count, totalBytes } = await calculateStorage();
  storageInfo.textContent = `${count} recording${count !== 1 ? 's' : ''} — ${formatBytes(totalBytes)} used`;
}

// ============================================================
// SETTINGS
// ============================================================

btnSettings.addEventListener('click', () => {
  apiKeyInput.value = getApiKey();
  vocabInput.value = getVocab();
  settingsStatus.textContent = '';
  settingsStatus.className = 'settings-status';
  updateStorageInfo();
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

btnSaveVocab.addEventListener('click', () => {
  setVocab(vocabInput.value);
  settingsStatus.textContent = 'Vocabulary saved';
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
    const sampleRate = 16000;
    const numSamples = sampleRate;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

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
      settingsStatus.textContent = body.error?.message || `Error ${resp.status}`;
      settingsStatus.className = 'settings-status error';
    }
  } catch (err) {
    settingsStatus.textContent = 'Network error — check your connection';
    settingsStatus.className = 'settings-status error';
  }
});

btnDeleteAll.addEventListener('click', async () => {
  if (!confirm('Delete ALL recordings? This cannot be undone.')) return;
  await dbClear();
  stopPlayback();
  renderHistory();
  updateStorageInfo();
  toast('All recordings deleted');
});

// Clear All button in history section
btnClearAll.addEventListener('click', async () => {
  if (!confirm('Are you sure? This cannot be undone.')) return;
  await dbClear();
  stopPlayback();
  renderHistory();
  toast('All recordings deleted');
});

// ============================================================
// INIT
// ============================================================

initAppSelector();
cleanupOldAudio().then(() => renderHistory());
