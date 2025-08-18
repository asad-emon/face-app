# FaceApp Web (Converted)

This is a standalone React web version of your Expo/React Native app that replicates the two main tabs:
**Upload** and **Gallery**.

## How to run
```bash
npm install
npm run dev
```

## Build for production
```bash
npm run build
npm run preview
```

## Notes
- Uses `localforage` (IndexedDB) to store images locally in the browser.
- Replaces Expo modules (`expo-image`, `expo-image-picker`, `expo-file-system`, `expo-clipboard`) with browser equivalents:
  - File picker: `<input type="file">`
  - Clipboard paste: `navigator.clipboard.read()` (requires a secure context & permissions; falls back with message)
  - Gallery storage: IndexedDB via `localforage`
- The codebase is intentionally lightweight and framework-agnostic (no Expo).
