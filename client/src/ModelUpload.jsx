import React, { useEffect, useRef, useState } from 'react';
import './styles.css';
import { apiBaseUrl } from './utils';
import JSZip from 'jszip';

function buildId(file) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export default function ModelUpload({ token }) {
  const [mode, setMode] = useState('images');
  const [modelName, setModelName] = useState('');
  const [items, setItems] = useState([]);
  const [safetensorFile, setSafetensorFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const itemsRef = useRef(items);

  const totalFiles = items.length;

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, []);

  const isImageName = (name) => /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(name);
  const isSafetensorName = (name) => /\.safetensors?$/i.test(name);

  const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, index);
    return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
  };

  const mimeFromName = (name) => {
    const lower = name.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.bmp')) return 'image/bmp';
    if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff';
    return '';
  };

  const addFilesToItems = (files) => {
    if (!files.length) return;
    setItems((prev) => {
      const existingIds = new Set(prev.map((item) => item.id));
      const additions = files
        .map((file) => ({
          id: buildId(file),
          file,
          url: URL.createObjectURL(file),
        }))
        .filter((item) => !existingIds.has(item.id));
      return [...prev, ...additions];
    });
  };

  const extractZipImages = async (file) => {
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files);
    const images = [];

    await Promise.all(entries.map(async (entry) => {
      if (entry.dir) return;
      const name = entry.name.split('/').pop();
      if (!name || !isImageName(name)) return;
      const blob = await entry.async('blob');
      const mime = mimeFromName(name) || blob.type || 'image/jpeg';
      images.push(new File([blob], name, { type: mime, lastModified: file.lastModified }));
    }));

    return images;
  };

  const handleFileSelect = async (event) => {
    const nextFiles = Array.from(event.target.files || []);
    if (nextFiles.length === 0) return;

    setParsing(true);
    try {
      for (const file of nextFiles) {
        const lowerName = file.name.toLowerCase();
        if (lowerName.endsWith('.zip')) {
          const extracted = await extractZipImages(file);
          if (extracted.length === 0) {
            alert(`No images found in ${file.name}.`);
          }
          addFilesToItems(extracted);
        } else if (isImageName(file.name) || file.type.startsWith('image/')) {
          addFilesToItems([file]);
        }
      }
    } catch (error) {
      alert('Failed to read zip file: ' + error.message);
    } finally {
      setParsing(false);
      event.target.value = '';
    }
  };

  const handleRemove = (id) => {
    setItems((prev) => {
      const next = prev.filter((item) => item.id !== id);
      const removed = prev.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      return next;
    });
  };

  const clearImages = () => {
    itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    setItems([]);
  };

  const handleModeChange = (nextMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    if (nextMode === 'safetensors') {
      clearImages();
      setParsing(false);
    } else {
      setSafetensorFile(null);
    }
  };

  const canSubmitImages = modelName.trim() && items.length > 0 && !busy && !parsing;
  const canSubmitSafetensor = modelName.trim() && safetensorFile && !busy;

  const handleGenerateModel = async () => {
    if (!modelName.trim() || items.length === 0) {
      alert('Please select images and provide a name for the model.');
      return;
    }
    setBusy(true);
    const formData = new FormData();
    formData.append('name', modelName.trim());
    items.forEach((item) => formData.append('file', item.file));

    try {
      const response = await fetch(`${apiBaseUrl}/models/generate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (response.ok) {
        alert('Model generated successfully!');
        clearImages();
        setModelName('');
      } else {
        throw new Error('Model generation failed');
      }
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSafetensorSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!isSafetensorName(file.name)) {
      alert('Please select a .safetensor or .safetensors file.');
      event.target.value = '';
      return;
    }
    setSafetensorFile(file);
    event.target.value = '';
  };

  const handleSafetensorRemove = () => {
    setSafetensorFile(null);
  };

  const handleUploadSafetensor = async () => {
    if (!modelName.trim() || !safetensorFile) {
      alert('Please select a safetensors file and provide a name for the model.');
      return;
    }
    setBusy(true);
    const formData = new FormData();
    formData.append('name', modelName.trim());
    formData.append('file', safetensorFile);

    try {
      const response = await fetch(`${apiBaseUrl}/models/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (response.ok) {
        alert('Model uploaded successfully!');
        setSafetensorFile(null);
        setModelName('');
      } else {
        throw new Error('Model upload failed');
      }
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Model Upload</h2>
      <div className="tabs">
        <button
          type="button"
          className={mode === 'images' ? 'tab active' : 'tab'}
          onClick={() => handleModeChange('images')}
        >
          Images (Generate)
        </button>
        <button
          type="button"
          className={mode === 'safetensors' ? 'tab active' : 'tab'}
          onClick={() => handleModeChange('safetensors')}
        >
          Safetensors (Upload)
        </button>
      </div>
      <input
        type="text"
        placeholder="Model Name"
        value={modelName}
        onChange={(e) => setModelName(e.target.value)}
      />

      {mode === 'images' && (
        <>
          <input
            type="file"
            accept="image/*,.zip"
            multiple
            disabled={busy || parsing}
            onChange={handleFileSelect}
          />

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="muted">
              {parsing ? 'Processing zip...' : `${totalFiles} image${totalFiles === 1 ? '' : 's'} selected`}
            </div>
            <button onClick={handleGenerateModel} disabled={!canSubmitImages}>
              {busy ? 'Generating...' : 'Generate Model'}
            </button>
          </div>

          {items.length > 0 && (
            <div className="preview-grid">
              {items.map((item) => (
                <div className="preview-card" key={item.id}>
                  <img src={item.url} alt={item.file.name} className="preview-img" />
                  <div className="preview-meta">
                    <div className="preview-name">{item.file.name}</div>
                    <button
                      type="button"
                      className="preview-remove"
                      onClick={() => handleRemove(item.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {mode === 'safetensors' && (
        <>
          <input
            type="file"
            accept=".safetensor,.safetensors"
            disabled={busy}
            onChange={handleSafetensorSelect}
          />
          {safetensorFile ? (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="muted">
                {safetensorFile.name} · {formatBytes(safetensorFile.size)}
              </div>
              <button type="button" className="preview-remove" onClick={handleSafetensorRemove}>
                Remove
              </button>
            </div>
          ) : (
            <div className="muted">No safetensors file selected.</div>
          )}
          <button onClick={handleUploadSafetensor} disabled={!canSubmitSafetensor}>
            {busy ? 'Uploading...' : 'Upload Model'}
          </button>
        </>
      )}
    </div>
  );
}
