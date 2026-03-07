import React, { useEffect, useRef, useState } from 'react';
import './styles.css';
import { apiBaseUrl } from './utils';
import JSZip from 'jszip';

function buildId(file) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function parseVersion(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const version = Number(trimmed);
  if (!Number.isInteger(version) || version <= 0) return NaN;
  return version;
}

export default function ModelUpload({ token }) {
  const [mode, setMode] = useState('images');
  const [personName, setPersonName] = useState('');
  const [versionInput, setVersionInput] = useState('');
  const [setActive, setSetActive] = useState(true);
  const [items, setItems] = useState([]);
  const [models, setModels] = useState([]);
  const [safetensorFile, setSafetensorFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const itemsRef = useRef(items);

  const totalFiles = items.length;

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    fetchModels();
  }, [token]);

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, []);

  const fetchModels = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/models`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('Failed to fetch models');
      }
      const data = await response.json();
      setModels(data || []);
    } catch (error) {
      console.error(error);
    }
  };

  const groupedModels = models.reduce((acc, model) => {
    const key = (model.person_name || model.name || 'Unknown').trim() || 'Unknown';
    const group = acc.get(key) || [];
    group.push(model);
    acc.set(key, group);
    return acc;
  }, new Map());

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

  const parsedVersion = parseVersion(versionInput);
  const canSubmitVersion = parsedVersion === null || Number.isInteger(parsedVersion);
  const canSubmitImages = personName.trim() && items.length > 0 && !busy && !parsing && canSubmitVersion;
  const canSubmitSafetensor = personName.trim() && safetensorFile && !busy && canSubmitVersion;

  const appendVersionFields = (formData) => {
    formData.append('person_name', personName.trim());
    formData.append('set_active', String(setActive));
    if (parsedVersion !== null) {
      formData.append('version', String(parsedVersion));
    }
  };

  const resetModelInputs = () => {
    setPersonName('');
    setVersionInput('');
    setSetActive(true);
  };

  const handleGenerateModel = async () => {
    if (!personName.trim() || items.length === 0) {
      alert('Please select images and provide a person name.');
      return;
    }
    if (!canSubmitVersion) {
      alert('Version must be empty or a positive integer.');
      return;
    }

    setBusy(true);
    const formData = new FormData();
    appendVersionFields(formData);
    items.forEach((item) => formData.append('file', item.file));

    try {
      const response = await fetch(`${apiBaseUrl}/models/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || 'Model generation failed');
      }
      alert('Model generated successfully!');
      clearImages();
      resetModelInputs();
      await fetchModels();
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
    if (!personName.trim() || !safetensorFile) {
      alert('Please select a safetensors file and provide a person name.');
      return;
    }
    if (!canSubmitVersion) {
      alert('Version must be empty or a positive integer.');
      return;
    }

    setBusy(true);
    const formData = new FormData();
    appendVersionFields(formData);
    formData.append('file', safetensorFile);

    try {
      const response = await fetch(`${apiBaseUrl}/models/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || 'Model upload failed');
      }
      alert('Model uploaded successfully!');
      setSafetensorFile(null);
      resetModelInputs();
      await fetchModels();
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleActivateModel = async (modelId) => {
    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/models/${modelId}/activate`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || 'Failed to activate version');
      }
      await fetchModels();
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteModel = async (modelId, groupName, version) => {
    const confirmed = window.confirm(`Delete ${groupName} v${version}?`);
    if (!confirmed) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/models/${modelId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || 'Failed to delete version');
      }
      await fetchModels();
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePersonVersions = async (groupName) => {
    const confirmed = window.confirm(`Delete all versions for ${groupName}?`);
    if (!confirmed) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/models/person/${encodeURIComponent(groupName)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || 'Failed to delete versions');
      }
      await fetchModels();
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
        placeholder="Person Name"
        value={personName}
        onChange={(e) => setPersonName(e.target.value)}
      />
      <input
        type="number"
        min="1"
        placeholder="Version (optional, auto-increments if empty)"
        value={versionInput}
        onChange={(e) => setVersionInput(e.target.value)}
      />
      {!canSubmitVersion && (
        <div className="error" style={{ textAlign: 'left' }}>
          Version must be empty or a positive integer.
        </div>
      )}
      <label className="row" style={{ gap: 8 }}>
        <input
          type="checkbox"
          checked={setActive}
          onChange={(e) => setSetActive(e.target.checked)}
        />
        <span>Set this version as active for inference</span>
      </label>

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

      <div style={{ borderTop: '1px solid #2a3347', paddingTop: 12 }}>
        <h3 style={{ margin: 0 }}>People & Versions</h3>
        {groupedModels.size === 0 ? (
          <div className="muted">No models uploaded yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {Array.from(groupedModels.entries()).map(([groupName, entries]) => {
              const sorted = [...entries].sort((a, b) => (b.version || 1) - (a.version || 1));
              return (
                <div key={groupName} className="preview-card" style={{ gap: 8 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong>{groupName}</strong>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="muted">{sorted.length} version{sorted.length === 1 ? '' : 's'}</span>
                      <button
                        type="button"
                        className="preview-remove"
                        disabled={busy}
                        onClick={() => handleDeletePersonVersions(groupName)}
                      >
                        Delete All
                      </button>
                    </div>
                  </div>
                  {sorted.map((model) => (
                    <div key={model.id} className="row" style={{ justifyContent: 'space-between' }}>
                      <span>
                        v{model.version || 1} {model.is_active ? '(Active)' : ''}
                      </span>
                      <div className="row" style={{ gap: 8 }}>
                        <button
                          type="button"
                          disabled={busy || model.is_active}
                          onClick={() => handleActivateModel(model.id)}
                        >
                          {model.is_active ? 'Selected' : 'Set for Inference'}
                        </button>
                        <button
                          type="button"
                          className="preview-remove"
                          disabled={busy}
                          onClick={() => handleDeleteModel(model.id, groupName, model.version || 1)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
