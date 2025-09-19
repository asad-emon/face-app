# FaceApp Web (Converted)

This is a standalone React web app that replicates the two main tabs:
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
- Uses `localforage` (IndexedDB) to store images locally in the browser.equivalents:
  - File picker: `<input type="file">`
  - Clipboard paste: `navigator.clipboard.read()` (requires a secure context & permissions; falls back with message)
  - Gallery storage: IndexedDB via `localforage`
