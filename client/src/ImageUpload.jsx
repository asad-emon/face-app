import React, { useState, useEffect, useRef } from 'react';
import './styles.css';
import { apiBaseUrl } from './utils';

let nextLocalId = 1;

function groupByPerson(models) {
  const groups = new Map();
  models.forEach((model) => {
    const personName = (model.person_name || model.name || 'Unknown').trim() || 'Unknown';
    const current = groups.get(personName) || [];
    current.push(model);
    groups.set(personName, current);
  });

  return Array.from(groups.entries())
    .map(([personName, versions]) => ({
      personName,
      versions: versions.sort((a, b) => (b.version || 1) - (a.version || 1)),
    }))
    .sort((a, b) => a.personName.localeCompare(b.personName));
}

function getDefaultVersionId(versions) {
  if (!versions || versions.length === 0) return '';
  const active = versions.find((item) => item.is_active);
  return String((active || versions[0]).id);
}

export default function ImageUpload({ token }) {
  const [targetImages, setTargetImages] = useState([]);
  const [models, setModels] = useState([]);
  const [selectedPerson, setSelectedPerson] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [busy, setBusy] = useState(false);
  const targetImagesRef = useRef([]);

  useEffect(() => {
    fetchModels();
  }, [token]);

  useEffect(() => {
    targetImagesRef.current = targetImages;
  }, [targetImages]);

  useEffect(() => {
    return () => {
      targetImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  const modelGroups = groupByPerson(models);
  const selectedGroup = modelGroups.find((group) => group.personName === selectedPerson) || null;

  const fetchModels = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/models`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        const incoming = data || [];
        setModels(incoming);

        const groups = groupByPerson(incoming);
        if (groups.length === 0) {
          setSelectedPerson('');
          setSelectedModelId('');
          return;
        }

        const personExists = groups.some((group) => group.personName === selectedPerson);
        const nextPerson = personExists ? selectedPerson : groups[0].personName;
        setSelectedPerson(nextPerson);

        const nextGroup = groups.find((group) => group.personName === nextPerson);
        if (!nextGroup) {
          setSelectedModelId('');
          return;
        }

        const hasSelectedVersion = nextGroup.versions.some((model) => String(model.id) === selectedModelId);
        const nextModelId = hasSelectedVersion ? selectedModelId : getDefaultVersionId(nextGroup.versions);
        setSelectedModelId(nextModelId);
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
    }
  };

  const handlePersonChange = (personName) => {
    setSelectedPerson(personName);
    const group = modelGroups.find((item) => item.personName === personName);
    setSelectedModelId(getDefaultVersionId(group?.versions));
  };

  const updateImageItem = (id, updates) => {
    setTargetImages((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const addFiles = (files) => {
    if (!files || files.length === 0) {
      return;
    }
    const incoming = Array.from(files).map((file) => ({
      id: nextLocalId++,
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'idle',
      error: null,
      imageId: null,
      resultImage: null,
    }));
    setTargetImages((prev) => [...prev, ...incoming]);
  };

  const removeImage = (id) => {
    setTargetImages((prev) => {
      const current = prev.find((item) => item.id === id);
      if (current) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const clearImages = () => {
    setTargetImages((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  };

  const handleSwap = async () => {
    if (!selectedModelId || targetImages.length === 0) {
      alert('Please select a person/version and at least one target image.');
      return;
    }

    const queue = targetImages.filter((item) => item.status === 'idle' || item.status === 'failed');
    if (queue.length === 0) {
      alert('No pending images to process.');
      return;
    }

    setBusy(true);

    try {
      for (const item of queue) {
        try {
          updateImageItem(item.id, { status: 'uploading', error: null });

          const imageFormData = new FormData();
          imageFormData.append('file', item.file);
          const imgResponse = await fetch(`${apiBaseUrl}/images`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: imageFormData,
          });
          if (!imgResponse.ok) {
            throw new Error('Failed to upload image');
          }
          const imgData = await imgResponse.json();
          const imageId = imgData.id;

          updateImageItem(item.id, { status: 'swapping', imageId });
          const swapResponse = await fetch(
            `${apiBaseUrl}/swap?model_id=${selectedModelId}&image_id=${imageId}`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          if (!swapResponse.ok) {
            const errorData = await swapResponse.json().catch(() => null);
            throw new Error(errorData?.detail || 'Face swap failed');
          }
          const swapData = await swapResponse.json();
          updateImageItem(item.id, {
            status: 'done',
            error: null,
            resultImage: swapData.result,
          });
        } catch (error) {
          updateImageItem(item.id, {
            status: 'failed',
            error: error.message || 'Unknown error',
          });
        }
      }
    } catch (error) {
      alert('Error: ' + (error.message || 'Unknown error'));
    } finally {
      setBusy(false);
    }
  };

  const processedCount = targetImages.filter((item) => item.status === 'done').length;
  const failedCount = targetImages.filter((item) => item.status === 'failed').length;
  const pendingCount = targetImages.filter(
    (item) => item.status === 'idle' || item.status === 'uploading' || item.status === 'swapping'
  ).length;

  const statusText = (status) => {
    if (status === 'uploading') return 'Uploading';
    if (status === 'swapping') return 'Swapping';
    if (status === 'done') return 'Done';
    if (status === 'failed') return 'Failed';
    return 'Pending';
  };

  return (
    <div>
      <div className="card">
        <h2>Perform Face Swaps</h2>

        <label className="muted">Person</label>
        <select
          value={selectedPerson}
          onChange={(e) => handlePersonChange(e.target.value)}
          disabled={modelGroups.length === 0 || busy}
        >
          <option value="" disabled>Select a person</option>
          {modelGroups.map((group) => (
            <option key={group.personName} value={group.personName}>{group.personName}</option>
          ))}
        </select>

        <label className="muted">Version</label>
        <select
          value={selectedModelId}
          onChange={(e) => setSelectedModelId(e.target.value)}
          disabled={!selectedGroup || busy}
        >
          <option value="" disabled>Select a version</option>
          {(selectedGroup?.versions || []).map((model) => (
            <option key={model.id} value={model.id}>
              v{model.version || 1}{model.is_active ? ' (Active)' : ''}
            </option>
          ))}
        </select>

        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="muted">
            Total: {targetImages.length} | Done: {processedCount} | Failed: {failedCount} | Pending: {pendingCount}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button
              onClick={clearImages}
              disabled={busy || targetImages.length === 0}
            >
              Clear All
            </button>
            <button
              onClick={handleSwap}
              disabled={busy || !selectedModelId || targetImages.length === 0}
            >
              Process Images
            </button>
          </div>
        </div>

        {targetImages.length === 0 ? (
          <div className="muted">No images selected.</div>
        ) : (
          <div className="preview-grid">
            {targetImages.map((item) => (
              <div key={item.id} className="preview-card">
                <img src={item.previewUrl} alt={item.file.name} className="preview-img" />
                <div className="preview-meta">
                  <span className="preview-name">{item.file.name}</span>
                  <button
                    type="button"
                    className="preview-remove"
                    onClick={() => removeImage(item.id)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                </div>
                <div className="muted">Status: {statusText(item.status)}</div>
                {item.error && <div className="error" style={{ textAlign: 'left' }}>{item.error}</div>}
                {item.resultImage && (
                  <img src={item.resultImage} alt={`Result for ${item.file.name}`} className="preview-img" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {busy && <p>Processing queued images...</p>}
    </div>
  );
}
