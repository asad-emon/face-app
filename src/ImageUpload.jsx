
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { saveImage } from './storage.js';
import './styles.css';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

function useObjectURL(blob) {
  const url = useMemo(() => blob ? URL.createObjectURL(blob) : null, [blob]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

export default function ImageUpload() {
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [inputUrl, setInputUrl] = useState('');

  const fileRef = useRef();

  async function onPickFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelected(file);
  }

  async function onPasteFromClipboard() {
    try {
      if ('clipboard' in navigator && 'read' in navigator.clipboard) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          for (const type of item.types) {
            if (type.startsWith('image/')) {
              const blob = await item.getType(type);
              setSelected(blob);
              return;
            }
          }
        }
        alert('No image in clipboard. Copy an image and try again.');
      } else {
        alert('Clipboard image read not supported in this browser.');
      }
    } catch (e) {
      alert('Clipboard error: ' + e.message);
    }
  }

  async function onLoadFromUrl() {
    if (!inputUrl) return;
    try {
      setBusy(true);
      const res = await fetch(inputUrl);
      const blob = await res.blob();
      setSelected(blob);
    } catch (e) {
      alert('Failed to fetch image: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onUpload() {
    if (!selected) return;
    await getBase64(selected) // `file` your img file
      .then(res => uploadImage(res)) // `res` base64 of img file
      .catch(err => console.log(err));
  }

  async function getBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        resolve(reader.result);
      };
      reader.onerror = reject;
    });
  }

  function base64ToBlob(base64, contentType = '', sliceSize = 512) {
    const byteCharacters = atob(base64);
    const byteArrays = [];

    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);

      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }

      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }

    return new Blob(byteArrays, { type: contentType });
  }

  const uploadImage = async (base64Image) => {
    setBusy(true);
    try {
      const requestObj = {
        method: 'POST',
        body: JSON.stringify({ image_base64: base64Image }),
        headers: {
          'Content-Type': 'application/json',
        }
      };

      const response = await fetch(`${apiBaseUrl}/api/proxy`, requestObj);

      if (response.ok) {
        const responseData = await response.json();
        if (responseData.result) {
          // Handle base64 encoded image
          const dataUrl = responseData.result;

          const [meta, base64Data] = dataUrl.split(',');
          const mime = meta.match(/:(.*?);/)?.[1] || 'image/png';

          const imgBlob = base64ToBlob(base64Data, mime);

          onSaveToGallery(imgBlob);
          alert('Success', 'Image uploaded successfully!');
        }
      } else {
        alert('Error, Failed to upload image');
      }
    } catch (error) {
      console.error('Network error:', error);
      alert('Error, Network error occurred');
    } finally {
      setBusy(false);
    }
  };

  async function onSaveToGallery(fileOrBlob) {
    if (!fileOrBlob) return;
    try {
      setBusy(true);
      const name = typeof fileOrBlob.name === 'string' ? fileOrBlob.name : 'pasted-image.png';
      await saveImage(fileOrBlob, name);
      setSelected(null);
      alert('Saved to gallery. Open the Gallery tab to view.');
    } catch (e) {
      alert('Failed to save: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  const previewUrl = useObjectURL(selected);

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: '0 0 8px' }}>Upload</h2>
          <div className="muted">Pick a file, paste an image, or load from URL.</div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => fileRef.current?.click()}>Choose File</button>
          <button className="btn" onClick={onPasteFromClipboard}>Paste Image</button>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickFile} />

      <div style={{ height: 12 }} />

      <div className="row">
        <input type="text" placeholder="https://example.com/image.jpg" value={inputUrl} onChange={e => setInputUrl(e.target.value)} />
        <button className="btn" onClick={onLoadFromUrl} disabled={busy || !inputUrl}>Load URL</button>
      </div>

      <div style={{ height: 16 }} />

      {selected ? (
        <div className="row" style={{ alignItems: 'center' }}>
          <img src={previewUrl} className="thumb" alt="preview" />
          <div className="row">
            <button className="btn" onClick={onUpload} disabled={busy}>Save to Gallery</button>
            <button className="btn" onClick={() => setSelected(null)} disabled={busy}>Clear</button>
          </div>
        </div>
      ) : (
        <div className="muted">No image selected yet.</div>
      )}
    </div>
  );
}
