# CLAUDE.md - Voicebox

## Project Overview

Voicebox is a voice-to-text Progressive Web App (PWA) built with vanilla HTML, CSS, and JavaScript. It records audio, saves it to IndexedDB, and transcribes it via OpenAI's Whisper API. Designed for phone use with large touch targets and a native-app feel.

## Tech Stack

- **HTML/CSS/JS** — no build step, no bundler, no framework
- **PWA** — service worker for offline app shell caching
- **IndexedDB** — stores audio blobs and metadata (save-first, never lose a recording)
- **OpenAI Whisper API** — `POST /v1/audio/transcriptions` with `whisper-1` model
- **Web Share API** — native sharing on mobile
- **Pointer Events API** — hold-to-record and tap-to-record dual mode

## File Structure

```
voicebox/
├── index.html          # Single-page app with 3 views (record, result, settings)
├── style.css           # Dark-mode, mobile-first, locked-viewport styles
├── app.js              # All application logic (single file, ES module)
├── sw.js               # Service worker — cache-first for app shell, passthrough for API
├── manifest.json       # PWA manifest (base path: /voicebox/)
├── CLAUDE.md           # This file
└── icons/              # App icons (192px, 512px)
```

## Architecture

### Views (SPA with class toggling)
- **Record view** (`#view-record`) — full-width record bar at bottom, scrollable history list above
- **Result view** (`#view-result`) — transcription text, copy/share buttons, quick-share targets, retry on error
- **Settings view** (`#view-settings`) — API key, custom vocabulary, storage management

Navigation: `.view.active` is `display: flex`, others `display: none`. Viewport is locked (`overflow: hidden` on html/body, `position: fixed`).

### Recording Modes
Two modes detected via pointer events and a 300ms threshold:
- **Tap mode** — quick press (<300ms) toggles recording on/off. Button turns red (`.recording`).
- **Hold mode** — press and hold (>=300ms) records while held, stops on release. Button turns dark red (`.hold-recording`).

### Data Flow
1. User records → `MediaRecorder` captures audio chunks
2. On stop → audio blob saved to IndexedDB **immediately** (save-first)
3. After save → sends audio to Whisper API via `FormData`, with optional custom vocabulary as `prompt` param
4. On success → result stored in IndexedDB, text auto-copied to clipboard, "Copied!" toast shown
5. On error → recording persists, user can retry anytime

### IndexedDB Schema (`voicebox` DB, `recordings` store)
Each record has `keyPath: 'id'` with fields:
- `id` — unique string (timestamp + random)
- `timestamp` — Date.now()
- `duration` — seconds (float)
- `mimeType` — from MediaRecorder (webm/opus or mp4)
- `audio` — Blob (set to `null` after 30 days to save space)
- `status` — `'pending'` | `'done'` | `'error'`
- `text` — transcription result
- `error` — error message if failed

### Audio Playback
History items with audio blobs have a play/pause button with an SVG circular progress ring. Uses `Audio()` API with `requestAnimationFrame` for smooth progress updates. Only one audio plays at a time.

### Swipe-to-Delete
History items support left-swipe to reveal a red "Delete" background. Swipe >80px triggers delete with slide-out animation.

### Quick Share Targets
After transcription, "Open in" buttons for Claude, Gemini, and ChatGPT. Each copies text to clipboard and opens the app via universal link.

### Storage Management
- **30-day auto-cleanup**: On app init, audio blobs older than 30 days are set to `null` (transcription text kept)
- **Settings page**: Shows total storage used (recording count + bytes)
- **Delete All**: Clears entire IndexedDB store

### Settings
- API key → `localStorage` key `voicebox_api_key`
- Custom vocabulary → `localStorage` key `voicebox_vocab` (passed as Whisper `prompt` param)
- Test button sends 1-second silent WAV to validate key

### Service Worker
- Cache-first for app shell assets (HTML, CSS, JS, icons)
- API calls (different hostname) pass through without caching
- `skipWaiting()` + `clients.claim()` for immediate activation
- Bump `CACHE_NAME` version string when updating any cached file
- Base path: `/voicebox/` (GitHub Pages deployment)

## Conventions

- Vanilla JS only — no npm, no build tools
- ES modules (`type="module"`)
- Mobile-first, dark mode only
- Large touch targets (min 48px, record button is 25dvh)
- CSS custom properties for theming (defined in `:root`)
- Inline SVG icons (no icon library dependency)
- `escapeHtml()` must be used for any user content rendered via innerHTML
- Viewport is locked — no page scrolling, only `.history-list` scrolls independently

## When Editing

- No build step — files served directly
- After changing any cached file, bump `CACHE_NAME` in `sw.js`
- Test locally: `python3 -m http.server 8000`
- Audio format varies by browser: Chrome uses webm/opus, Safari uses mp4
- All paths use `/voicebox/` base for GitHub Pages deployment
