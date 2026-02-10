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
function getAutoRecord() { return localStorage.getItem('voicebox_auto_record') === 'true'; }
function setAutoRecord(v) { localStorage.setItem('voicebox_auto_record', v ? 'true' : 'false'); }

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
const btnHelp = $('#btn-help');
const recordingIndicator = $('#recording-indicator');
const recordingTime = $('#recording-time');
const recordBtnLabel = $('#record-btn-label');
const kittBar = $('#kitt-bar');
const historyList = $('#history-list');
const historyEmpty = $('#history-empty');
const btnClearAll = $('#btn-clear-all');
const btnCancel = $('#btn-cancel');
const autoRecordToggle = $('#auto-record-toggle');

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
const resultTitle = $('#result-title');
const resultPlayback = $('#result-playback');
const btnResultPlay = $('#btn-result-play');
const resultPlayTime = $('#result-play-time');
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
// KITT SCANNER BAR
// ============================================================

const KITT_SEGMENTS = 24;
const KITT_SPEED = 0.8; // full sweeps per second
let kittAnimFrame = null;
let kittSegs = [];
let transcribeProgressFrame = null;

// Build segments once
(function initKitt() {
  for (let i = 0; i < KITT_SEGMENTS; i++) {
    const seg = document.createElement('div');
    seg.className = 'kitt-seg';
    kittBar.appendChild(seg);
    kittSegs.push(seg);
  }
})();

function startKitt() {
  kittBar.classList.add('kitt-active');
  const startTime = performance.now();

  function animate(now) {
    const elapsed = (now - startTime) / 1000;
    // Triangle wave: sweeps 0→1→0→1... smoothly
    const raw = (elapsed * KITT_SPEED) % 2;
    const pos = raw <= 1 ? raw : 2 - raw;
    // Apply easing for deceleration at edges (sine ease)
    const eased = 0.5 - 0.5 * Math.cos(pos * Math.PI);
    const peak = eased * (KITT_SEGMENTS - 1);

    for (let i = 0; i < KITT_SEGMENTS; i++) {
      const dist = Math.abs(i - peak);
      let brightness;
      if (dist < 0.5) {
        brightness = 1.0; // hot center
      } else if (dist < 4.5) {
        // Trailing glow — exponential falloff over ~4 segments
        brightness = Math.pow(0.38, dist - 0.5);
      } else {
        brightness = 0;
      }

      const seg = kittSegs[i];
      if (brightness <= 0) {
        seg.style.background = 'rgba(233, 69, 96, 0.1)';
        seg.style.boxShadow = 'none';
      } else {
        // Interpolate from dim red to bright orange-white
        const r = Math.round(180 + 75 * brightness);
        const g = Math.round(30 + 60 * brightness);
        const b = Math.round(20 + 20 * brightness);
        const a = 0.15 + 0.85 * brightness;
        seg.style.background = `rgba(${r}, ${g}, ${b}, ${a})`;
        if (brightness > 0.3) {
          const glow = brightness * 12;
          const glowA = brightness * 0.7;
          seg.style.boxShadow = `0 0 ${glow}px ${glow * 0.4}px rgba(255, 60, 30, ${glowA})`;
        } else {
          seg.style.boxShadow = 'none';
        }
      }
    }

    kittAnimFrame = requestAnimationFrame(animate);
  }

  kittAnimFrame = requestAnimationFrame(animate);
}

function stopKitt() {
  cancelAnimationFrame(kittAnimFrame);
  kittAnimFrame = null;
  for (const seg of kittSegs) {
    seg.style.background = 'transparent';
    seg.style.boxShadow = 'none';
  }
}

// --- Green progress fill (transcription) ---

function startTranscribeProgress() {
  kittBar.classList.add('kitt-active');
  const startTime = performance.now();
  const ESTIMATED_MS = 12000;

  function animate(now) {
    const elapsed = now - startTime;
    // Asymptotic ease: fast at first, slows as it approaches ~92%
    const progress = 0.92 * (1 - Math.exp(-elapsed / (ESTIMATED_MS * 0.35)));
    const filledUpTo = progress * KITT_SEGMENTS;

    for (let i = 0; i < KITT_SEGMENTS; i++) {
      const seg = kittSegs[i];
      if (i + 1 <= filledUpTo) {
        seg.style.background = 'rgba(46, 204, 113, 0.85)';
        seg.style.boxShadow = '0 0 6px 2px rgba(46, 204, 113, 0.4)';
      } else if (i < filledUpTo) {
        const frac = filledUpTo - i;
        seg.style.background = `rgba(46, 204, 113, ${0.15 + 0.7 * frac})`;
        seg.style.boxShadow = frac > 0.3 ? `0 0 ${frac * 8}px ${frac * 3}px rgba(46, 204, 113, ${frac * 0.5})` : 'none';
      } else {
        seg.style.background = 'rgba(46, 204, 113, 0.08)';
        seg.style.boxShadow = 'none';
      }
    }

    transcribeProgressFrame = requestAnimationFrame(animate);
  }

  transcribeProgressFrame = requestAnimationFrame(animate);
}

function completeTranscribeProgress() {
  cancelAnimationFrame(transcribeProgressFrame);
  transcribeProgressFrame = null;
  for (const seg of kittSegs) {
    seg.style.background = 'rgba(46, 204, 113, 0.9)';
    seg.style.boxShadow = '0 0 8px 3px rgba(46, 204, 113, 0.5)';
  }
  setTimeout(() => {
    for (const seg of kittSegs) {
      seg.style.background = 'transparent';
      seg.style.boxShadow = 'none';
    }
    kittBar.classList.remove('kitt-active');
  }, 500);
}

function stopTranscribeProgress() {
  cancelAnimationFrame(transcribeProgressFrame);
  transcribeProgressFrame = null;
  for (const seg of kittSegs) {
    seg.style.background = 'transparent';
    seg.style.boxShadow = 'none';
  }
  kittBar.classList.remove('kitt-active');
}

// ============================================================
// CRT POWER-OFF / POWER-ON ANIMATIONS
// ============================================================

function playCRTOff() {
  return new Promise((resolve) => {
    const view = views.record;

    // Phase 1: Compress content to a horizontal line (150ms)
    view.style.transition = 'transform 0.15s ease-in, filter 0.15s ease-in';
    view.style.transformOrigin = 'center center';
    view.style.filter = 'brightness(1.5)';
    view.style.transform = 'scaleY(0.005)';

    setTimeout(() => {
      view.style.opacity = '0';

      // Phase 2: Black screen with bright line shrinking to dot (300ms)
      const overlay = document.createElement('div');
      overlay.className = 'crt-overlay';
      const dot = document.createElement('div');
      dot.className = 'crt-dot';
      overlay.appendChild(dot);
      document.body.appendChild(overlay);

      setTimeout(() => {
        overlay.remove();
        // Leave view hidden — playCRTOn will bring it back
        view.style.transition = 'none';
        void view.offsetWidth;
        resolve();
      }, 300);
    }, 150);
  });
}

function playCRTOn() {
  return new Promise((resolve) => {
    const view = views.record;

    // Phase 1: Dot expands to horizontal line (150ms)
    const overlay = document.createElement('div');
    overlay.className = 'crt-on-overlay';
    const dot = document.createElement('div');
    dot.className = 'crt-on-dot';
    overlay.appendChild(dot);
    document.body.appendChild(overlay);

    setTimeout(() => {
      // Phase 2: Remove overlay, expand view vertically with bloom
      overlay.remove();
      view.style.opacity = '1';
      view.style.transition = 'transform 0.2s ease-out, filter 0.2s ease-out';
      view.style.transform = 'scaleY(1)';
      view.style.filter = 'brightness(1.4)';

      setTimeout(() => {
        // Flicker sequence
        view.style.transition = 'filter 0.05s';
        view.style.filter = 'brightness(0.7)';
        setTimeout(() => {
          view.style.filter = 'brightness(1.15)';
          setTimeout(() => {
            view.style.filter = 'brightness(1)';
            setTimeout(() => {
              view.style.transition = '';
              view.style.transform = '';
              view.style.filter = '';
              view.style.opacity = '';
              view.style.transformOrigin = '';
              resolve();
            }, 80);
          }, 50);
        }, 50);
      }, 200);
    }, 150);
  });
}

// ============================================================
// GLITCH CANCEL ANIMATION
// ============================================================

function playGlitchCancel() {
  return new Promise((resolve) => {
    const view = views.record;
    const overlay = document.createElement('div');
    overlay.className = 'glitch-cancel-overlay';

    for (let i = 0; i < 15; i++) {
      const line = document.createElement('div');
      line.className = 'glitch-line';
      line.style.top = (Math.random() * 100) + '%';
      line.style.height = (1 + Math.random() * 5) + 'px';
      line.style.animationDelay = (Math.random() * 0.15) + 's';
      overlay.appendChild(line);
    }

    document.body.appendChild(overlay);
    view.classList.add('view-glitch');

    setTimeout(() => {
      overlay.remove();
      view.classList.remove('view-glitch');
      view.style.transform = '';
      view.style.filter = '';
      resolve();
    }, 500);
  });
}

// ============================================================
// RECORDING — tap-to-toggle
// ============================================================

let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = 0;
let timerInterval = null;
let wakeLock = null;
let cancelled = false;
let transcribeAbort = null;
let pendingSaveResolve = null;
let suppressCancelToast = false;
let autoRecordGraceTimer = null;
let isAutoRecordGrace = false;
let backgroundedAt = 0;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { /* silently ignore */ }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

function startTimer() {
  recordingStartTime = Date.now();
  recordBtnLabel.textContent = '0:00';
  timerInterval = setInterval(() => {
    const elapsed = (Date.now() - recordingStartTime) / 1000;
    recordBtnLabel.textContent = formatDuration(elapsed);
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
    cancelled = false;

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
      if (pendingSaveResolve) {
        pendingSaveResolve();
        pendingSaveResolve = null;
      }
    };

    mediaRecorder.start(250);
    btnRecord.classList.add('recording');
    btnCancel.classList.remove('cancel-hidden');
    startKitt();
    startTimer();
    requestWakeLock();
    navigator.vibrate?.(50);
  } catch (err) {
    toast('Microphone access denied');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  btnRecord.classList.remove('recording');
  stopKitt();
  recordBtnLabel.textContent = 'Tap to record';
  stopTimer();
  releaseWakeLock();
  navigator.vibrate?.(50);
  // Cancel button stays visible during transcription; hidden after save completes
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
const newlyCompletedIds = new Set();

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
  renderHistory();

  // If cancelled during recording, save audio but skip transcription
  if (cancelled) {
    kittBar.classList.remove('kitt-active');
    btnCancel.classList.add('cancel-hidden');
    if (!suppressCancelToast) toast('Saved — tap to transcribe later');
    suppressCancelToast = false;
    return;
  }

  toast('Transcribing...');
  startTranscribeProgress();
  await transcribe(id);

  const updated = await dbGet(id);
  if (updated && updated.status === 'done') {
    completeTranscribeProgress();
  } else {
    stopTranscribeProgress();
  }
  btnCancel.classList.add('cancel-hidden');

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
    if (!record.audio || record.audio.size === 0) {
      throw new Error('Recording was empty — please try again.');
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

    transcribeAbort = new AbortController();
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: transcribeAbort.signal,
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
    if (err.name === 'AbortError' || cancelled) {
      // Cancelled — keep as pending so user can retry later
      record.status = 'pending';
      record.error = '';
    } else {
      record.status = 'error';
      record.error = err.message || 'Transcription failed';
    }
  } finally {
    transcribeAbort = null;
  }

  await dbPut(record);
  if (activeRecordId === id) showResultView(record);
  renderHistory();

  // Skip copy/launch if cancelled
  if (cancelled) return;

  // Auto-copy on successful transcription + auto-launch app
  if (record.status === 'done' && record.text) {
    newlyCompletedIds.add(id);
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
    // Generate a short title in the background
    generateTitle(id);
  }
}

// ============================================================
// TITLE GENERATION (GPT-4o-mini)
// ============================================================

async function generateTitle(id) {
  const record = await dbGet(id);
  if (!record || !record.text || record.title) return;

  const apiKey = getApiKey();
  if (!apiKey) return;

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'user', content: `Summarize this in 5 words or less as a short title, no quotes:\n\n${record.text}` },
        ],
        max_tokens: 20,
      }),
    });

    if (!resp.ok) return;
    const data = await resp.json();
    const title = data.choices?.[0]?.message?.content?.trim();
    if (title) {
      record.title = title;
      await dbPut(record);
      renderHistory();
      if (activeRecordId === id) {
        resultTitle.textContent = title;
      }
    }
  } catch {
    // Title generation is optional — fail silently
  }
}

// ============================================================
// RESULT VIEW
// ============================================================

function showResultView(record) {
  resultTitle.textContent = record.title || 'Recording';
  resultDate.textContent = new Date(record.timestamp).toLocaleString();
  resultDuration.textContent = formatDuration(record.duration);

  transcribingSpinner.classList.add('hidden');
  transcribeError.classList.add('hidden');
  resultTextWrap.classList.add('hidden');
  resultActions.classList.add('hidden');
  resultPlayback.classList.add('hidden');

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

  // Show playback if audio is available
  if (record.audio) {
    resultPlayback.classList.remove('hidden');
    resultPlayTime.textContent = formatDuration(record.duration);
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
  const text = resultText.value;
  if (navigator.share) {
    try {
      const file = new File([text], 'transcription.txt', { type: 'text/plain' });
      const shareData = { files: [file] };
      if (navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        await navigator.share({ text });
      }
    } catch { /* user cancelled */ }
  } else {
    await copyText(text);
    toast('Copied (sharing not supported on this device)');
  }
});

btnResultPlay.addEventListener('click', () => {
  if (!activeRecordId) return;
  togglePlayback(activeRecordId, btnResultPlay);
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
    if (currentPlayBtn === btnResultPlay) {
      resultPlayTime.textContent = '0:00';
    }
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
    if (btn === btnResultPlay) {
      resultPlayTime.textContent = formatDuration(0);
    }
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

  // Animate progress ring + time display
  function animateRing() {
    if (!currentAudio || currentAudio.paused) return;
    if (currentAudio.duration && isFinite(currentAudio.duration)) {
      updateProgressRing(btn, currentAudio.currentTime / currentAudio.duration);
      if (btn === btnResultPlay) {
        resultPlayTime.textContent = `${formatDuration(currentAudio.currentTime)} / ${formatDuration(currentAudio.duration)}`;
      }
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
    const title = rec.title || (rec.status === 'done'
      ? (rec.text.slice(0, 50) + (rec.text.length > 50 ? '...' : ''))
      : rec.status === 'error'
        ? 'Transcription failed'
        : 'Pending transcription');

    const canCopy = rec.status === 'done' && rec.text;

    el.innerHTML = `
      <div class="history-item-icon ${iconClass}">${iconSymbol}</div>
      <div class="history-item-body">
        <div class="history-item-text">${escapeHtml(title)}</div>
        <div class="history-item-meta">${new Date(rec.timestamp).toLocaleString()} &middot; ${formatDuration(rec.duration)}</div>
      </div>
      ${canCopy ? `<button class="history-copy-btn" data-id="${rec.id}" aria-label="Copy">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>` : ''}
    `;

    wrap.appendChild(el);
    historyList.appendChild(wrap);

    // Scanline materialize for newly completed recordings
    if (newlyCompletedIds.has(rec.id)) {
      newlyCompletedIds.delete(rec.id);
      wrap.classList.add('crt-materialize');
      setTimeout(() => wrap.classList.add('crt-glow-fade'), 400);
      setTimeout(() => {
        wrap.classList.remove('crt-materialize', 'crt-glow-fade');
      }, 900);
    }

    // Copy button — stop touch/click propagation so swipe and openRecord don't fire
    const copyBtn = el.querySelector('.history-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('touchstart', (e) => {
        e.stopPropagation();
      }, { passive: true });
      copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const r = await dbGet(rec.id);
        if (r && r.text) {
          await copyText(r.text);
          toast('Copied!');
        }
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
  // Set up deferred clipboard early (within user gesture) for iOS Safari
  setupDeferredClipboard();

  // If currently recording, stop and save without transcribing
  if (isRecording()) {
    cancelled = true;
    suppressCancelToast = true;
    const saveComplete = new Promise((r) => { pendingSaveResolve = r; });
    stopRecording();
    await saveComplete;
    cancelled = false;
  }

  const record = await dbGet(id);
  if (!record) return;
  stopPlayback();
  activeRecordId = id;
  showResultView(record);
  showView('result');

  // Auto-transcribe pending recordings that have audio
  if (record.status === 'pending' && record.audio) {
    await transcribe(id);
  }
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
  // Switch to record view so animation is visible
  showView('record');
  await playAnalogGlitchOut();
  await playCRTOff();
  await dbClear();
  stopPlayback();
  renderHistory();
  updateStorageInfo();
  await playCRTOn();
});

// Clear All button in history section
btnClearAll.addEventListener('click', async () => {
  if (!confirm('Are you sure? This cannot be undone.')) return;
  await playAnalogGlitchOut();
  await playCRTOff();
  await dbClear();
  stopPlayback();
  renderHistory();
  await playCRTOn();
});

// ============================================================
// ANALOG GLITCH-OUT (clear-all animation)
// ============================================================

function playAnalogGlitchOut() {
  return new Promise((resolve) => {
    const view = views.record;
    const overlay = document.createElement('div');
    overlay.className = 'analog-glitch-overlay';

    // Static noise layer (CSS animated)
    const noise = document.createElement('div');
    noise.className = 'analog-noise';
    overlay.appendChild(noise);

    // Horizontal tear lines
    for (let i = 0; i < 10; i++) {
      const tear = document.createElement('div');
      tear.className = 'analog-tear';
      tear.style.top = (Math.random() * 100) + '%';
      tear.style.height = (2 + Math.random() * 6) + 'px';
      tear.style.animationDelay = (Math.random() * 0.2) + 's';
      overlay.appendChild(tear);
    }

    document.body.appendChild(overlay);

    // Shake the view
    view.classList.add('analog-glitch-shake');

    // Glitch history items with RGB split + jitter
    const items = historyList.querySelectorAll('.history-item-wrap');
    items.forEach((item) => item.classList.add('analog-item-glitch'));

    // Resolve after 800ms, clean up
    setTimeout(() => {
      overlay.remove();
      view.classList.remove('analog-glitch-shake');
      view.style.transform = '';
      view.style.filter = '';
      items.forEach((item) => item.classList.remove('analog-item-glitch'));
      resolve();
    }, 800);
  });
}

// ============================================================
// CANCEL BUTTON
// ============================================================

btnCancel.addEventListener('click', async () => {
  if (!isRecording() && !transcribeAbort) return;
  cancelled = true;

  // Stop everything immediately
  if (isRecording()) {
    stopRecording();
  }
  if (transcribeAbort) {
    transcribeAbort.abort();
  }
  // Ensure timer is stopped even if stopRecording() wasn't called or didn't clear it
  stopTimer();
  recordBtnLabel.textContent = 'Tap to record';
  stopTranscribeProgress();
  btnCancel.classList.add('cancel-hidden');

  // Play glitch effect
  await playGlitchCancel();

  toast('Cancelled — saved for later');
});

// ============================================================
// AUTO-RECORD GRACE PERIOD
// ============================================================

// When auto-record starts on app open/resume, any tap within 3 seconds
// (except on the record button) silently discards the unintentional recording.

function discardAutoRecording() {
  isAutoRecordGrace = false;
  clearTimeout(autoRecordGraceTimer);
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    const stream = mediaRecorder.stream;
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
    };
    mediaRecorder.stop();
  }
  mediaRecorder = null;
  audioChunks = [];
  btnRecord.classList.remove('recording');
  btnCancel.classList.add('cancel-hidden');
  stopKitt();
  kittBar.classList.remove('kitt-active');
  recordBtnLabel.textContent = 'Tap to record';
  stopTimer();
  releaseWakeLock();
}

document.addEventListener('click', (e) => {
  if (!isAutoRecordGrace) return;
  if (btnRecord.contains(e.target)) return;
  discardAutoRecording();
}, true);

// ============================================================
// AUTO-RECORD
// ============================================================

autoRecordToggle.checked = getAutoRecord();

autoRecordToggle.addEventListener('change', () => {
  setAutoRecord(autoRecordToggle.checked);
  if (autoRecordToggle.checked && !isRecording() && currentView === 'record') {
    setupDeferredClipboard();
    startRecording();
  }
});

// Auto-record on visibility change (app comes to foreground)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    backgroundedAt = Date.now();
    return;
  }
  // visibilityState === 'visible'
  const wasBackgroundedFor = backgroundedAt ? Date.now() - backgroundedAt : 0;
  backgroundedAt = 0;

  // iOS suspends the mic when backgrounded; if >30s elapsed, discard the stale recording
  if (isRecording() && wasBackgroundedFor > 30000) {
    discardAutoRecording();
    toast('Recording discarded — mic was suspended');
    if (getAutoRecord() && currentView === 'record') {
      setupDeferredClipboard();
      startRecording();
      isAutoRecordGrace = true;
      clearTimeout(autoRecordGraceTimer);
      autoRecordGraceTimer = setTimeout(() => { isAutoRecordGrace = false; }, 3000);
    }
  } else if (isRecording()) {
    // Re-acquire wake lock after brief visibility loss (OS releases it when hidden)
    requestWakeLock();
  } else if (!isRecording() && getAutoRecord() && currentView === 'record') {
    setupDeferredClipboard();
    startRecording();
    isAutoRecordGrace = true;
    clearTimeout(autoRecordGraceTimer);
    autoRecordGraceTimer = setTimeout(() => { isAutoRecordGrace = false; }, 3000);
  }
});

// ============================================================
// HELP OVERLAY
// ============================================================

btnHelp.addEventListener('click', () => {
  const overlay = document.createElement('div');
  overlay.className = 'help-overlay';
  overlay.innerHTML = `
    <div class="help-panel">
      <button class="help-close" aria-label="Close">&times;</button>
      <h2>voicebox</h2>
      <p>turns your voice into text and sends it where you need it.</p>
      <p><strong>setup:</strong> tap the gear icon, enter your openai api key from platform.openai.com, and hit test to make sure it works.</p>
      <p><strong>recording:</strong> tap the big button to start and tap again to stop. your audio is always saved first so nothing ever gets lost.</p>
      <p><strong>cancel:</strong> hitting cancel stops the transcription but your audio is always saved. you can transcribe it later by tapping the recording in your history.</p>
      <p><strong>auto mode:</strong> flip the auto toggle to start recording every time you open the app. turn it off if you don't want it to record automatically when you open the app.</p>
      <p><strong>app targets:</strong> pick where you want your text to go &mdash; claude, chatgpt, gemini, grok, notes, obsidian, or just clipboard. after transcription it copies the text and opens your chosen app automatically. just paste.</p>
      <p><strong>history:</strong> tap any recording to see the full transcription, play back the audio, copy, or share. swipe left to delete. clear all wipes everything.</p>
      <p><strong>custom vocabulary:</strong> add tricky words in settings (names, technical terms) to improve transcription accuracy.</p>
      <p>costs tiny fractions of a penny to transcribe.</p>
      <p><strong>ios tip:</strong> to stop the microphone permission popup from appearing every time, go to Settings &rarr; Safari &rarr; Microphone &rarr; set to &ldquo;Allow&rdquo;. this only needs to be done once.</p>
      <p style="margin-top:1rem;font-size:0.75rem;text-align:center;color:var(--text-muted);">made by paul j smith</p>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('.help-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
});

// ============================================================
// INIT
// ============================================================

initAppSelector();
cleanupOldAudio().then(() => {
  renderHistory();
  // Auto-record on app open
  if (getAutoRecord() && !isRecording()) {
    setupDeferredClipboard();
    startRecording();
    isAutoRecordGrace = true;
    autoRecordGraceTimer = setTimeout(() => { isAutoRecordGrace = false; }, 3000);
  }
});
