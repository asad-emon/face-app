import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import './styles.css';
import { AuthContext } from './AuthContext';
import { uploadImage } from './imageStore'; // Using the new unified image store

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

function useObjectURL(blob) {
  const url = useMemo(() => blob ? URL.createObjectURL(blob) : null, [blob]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

// Helper to convert a base64 string back to a Blob
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

// Helper to read a file as a base64 string
function getBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
  });
}

export default function ImageUpload() {
  const { user } = useContext(AuthContext);
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
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const file = new File([blob], "pasted-image.png", { type: blob.type });
            setSelected(file);
            return;
          }
        }
      }
      alert('No image in clipboard.');
    } catch (e) {
      alert('Clipboard error: ' + e.message);
    }
  }

  async function onLoadFromUrl() {
    if (!inputUrl) return;
    try {
      setBusy(true);
      const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(inputUrl)}`);
      if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
      const blob = await response.blob();
      const file = new File([blob], "downloaded-image.png", { type: blob.type });
      setSelected(file);
    } catch (e) {
      alert('Failed to fetch image: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload() {
    if (!selected) return;
    if (!user) {
      alert('You must be logged in to upload images.');
      return;
    }

    setBusy(true);
    try {
      const base64Image = await getBase64(selected);

      const response = await fetch(`${apiBaseUrl}/api/proxy`, {
        method: 'POST',
        body: JSON.stringify({ image_base64: base64Image }),
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to process image with the AI service.');
      }

      const responseData = await response.json();
      if (!responseData.result) {
        throw new Error('The AI service did not return a result.');
      }

      const dataUrl = responseData.result;
      const [meta, base64Data] = dataUrl.split(',');
      const mime = meta.match(/:(.*?);/)?.[1] || 'image/png';
      const processedBlob = base64ToBlob(base64Data, mime);
      const originalName = typeof selected.name === 'string' ? selected.name : 'processed.png';
      const processedFile = new File([processedBlob], `processed_${originalName}`, { type: mime });
      
      // Use the unified imageStore to upload the *processed* file
      await uploadImage(processedFile);

      setSelected(null);
      alert('Image processed and saved successfully!');
    } catch (error) {
      console.error('Upload process failed:', error);
      alert('Error: ' + error.message);
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
            <button className="btn" onClick={handleUpload} disabled={busy}>Save to Gallery</button>
            <button className="btn" onClick={() => setSelected(null)} disabled={busy}>Clear</button>
          </div>
        </div>
      ) : (
        <div className="muted">No image selected yet.</div>
      )}
    </div>
  );
}
