# CLAUDE.md - Voicebox

## Project Overview

Voicebox is a voice-to-text Progressive Web App (PWA) built with vanilla HTML, CSS, and JavaScript. It records audio, saves it to IndexedDB, and transcribes it via OpenAI's Whisper API.

## Tech Stack

- **HTML/CSS/JS** — no build step, no bundler, no framework
- **PWA** — service worker for offline app shell caching
- **IndexedDB** — stores audio blobs and metadata (never lose a recording)
- **OpenAI Whisper API** — `POST /v1/audio/transcriptions` with `whisper-1` model
- **Web Share API** — native sharing on mobile

## File Structure

```
voicebox/
├── index.html          # Single-page app with 3 views (record, result, settings)
├── style.css           # Dark-mode, mobile-first styles
├── app.js              # All application logic (single file, ES module)
├── sw.js               # Service worker — cache-first for app shell, passthrough for API
├── manifest.json       # PWA manifest
└── icons/              # App icons (192px, 512px)
```

## Architecture

### Views (SPA with class toggling)
- **Record view** (`#view-record`) — record button, recording indicator, history list
- **Result view** (`#view-result`) — transcription text, copy/share buttons, retry on error, delete
- **Settings view** (`#view-settings`) — API key input, save, test button

Navigation is CSS-based: `.view.active` is `display: flex`, others are `display: none`.

### Data Flow
1. User taps record → `MediaRecorder` captures audio chunks
2. On stop → audio blob saved to IndexedDB **immediately** (save-first, never lose audio)
3. After save → sends audio to Whisper API via `FormData`
4. Result stored back in IndexedDB, UI updated
5. On error → recording persists, user can retry anytime

### IndexedDB Schema (`voicebox` DB, `recordings` store)
Each record has `keyPath: 'id'` with fields:
- `id` — unique string (timestamp + random)
- `timestamp` — Date.now()
- `duration` — seconds (float)
- `mimeType` — from MediaRecorder (webm/opus or mp4)
- `audio` — Blob
- `status` — `'pending'` | `'done'` | `'error'`
- `text` — transcription result
- `error` — error message if failed

### Settings
- API key stored in `localStorage` under `voicebox_api_key`
- Test button sends a 1-second silent WAV to Whisper to validate the key

### Service Worker
- Cache-first for app shell assets (HTML, CSS, JS, icons)
- API calls (different hostname) pass through without caching
- `skipWaiting()` + `clients.claim()` for immediate activation
- Bump `CACHE_NAME` version string when updating files

## Conventions

- Vanilla JS only — no npm, no build tools
- ES modules (`type="module"`)
- Mobile-first, dark mode only
- Large touch targets (min 48px)
- CSS custom properties for theming (defined in `:root`)
- Inline SVG icons (no icon library dependency)

## When Editing

- No build step — files served directly
- After changing any cached file, bump `CACHE_NAME` in `sw.js`
- Test locally: `python3 -m http.server 8000`
- Audio format varies by browser: Chrome uses webm/opus, Safari uses mp4
- The `escapeHtml()` function must be used for any user content rendered via innerHTML
