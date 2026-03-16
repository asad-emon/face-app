import React, { useEffect, useMemo, useRef, useState } from 'react';
import './styles.css';
import { apiBaseUrl } from './utils';

const CIVITAI_IMAGES_ENDPOINT = 'https://civitai.com/api/v1/images';
const PAGE_SIZE_OPTIONS = [8, 12, 24, 48, 96, 120];
const SORT_OPTIONS = ['Newest', 'Most Reactions', 'Most Comments'];
const PERIOD_OPTIONS = ['AllTime', 'Year', 'Month', 'Week', 'Day'];
const NSFW_OPTIONS = ['', 'None', 'Soft', 'Mature', 'X'];

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function CivitaiGallery({ isActive = false, appToken, onUseInputImage }) {
  const [token, setToken] = useState(localStorage.getItem('civitai_token') || '');
  const [tokenInput, setTokenInput] = useState(token);
  const [items, setItems] = useState([]);
  const [metadata, setMetadata] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previewId, setPreviewId] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [inferenceBusy, setInferenceBusy] = useState(false);
  const [inferenceMessage, setInferenceMessage] = useState('');
  const [swapJobId, setSwapJobId] = useState(null);
  const [swapJobStatus, setSwapJobStatus] = useState('');
  const [swapJobError, setSwapJobError] = useState('');
  const [models, setModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [modelsBusy, setModelsBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(24);
  const [username, setUsername] = useState('');
  const [nsfw, setNsfw] = useState('');
  const [sort, setSort] = useState('Newest');
  const [period, setPeriod] = useState('AllTime');
  const [modelId, setModelId] = useState('');
  const [modelVersionId, setModelVersionId] = useState('');
  const pollRef = useRef(null);

  const params = useMemo(() => {
    const search = new URLSearchParams();
    search.set('limit', String(limit));
    search.set('page', String(page));
    if (username.trim()) search.set('username', username.trim());
    if (nsfw) search.set('nsfw', nsfw);
    if (sort) search.set('sort', sort);
    if (period) search.set('period', period);
    if (modelId.trim()) search.set('modelId', modelId.trim());
    if (modelVersionId.trim()) search.set('modelVersionId', modelVersionId.trim());
    return search;
  }, [limit, page, username, nsfw, sort, period, modelId, modelVersionId]);

  const fetchImages = async () => {
    setBusy(true);
    setError('');
    try {
      const headers = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetch(`${CIVITAI_IMAGES_ENDPOINT}?${params.toString()}`, {
        headers,
      });
      if (!response.ok) {
        let detail = `Failed to fetch images (${response.status})`;
        try {
          const data = await response.json();
          detail = data?.message || data?.detail || detail;
        } catch (_err) {
          // noop
        }
        throw new Error(detail);
      }
      const data = await response.json();
      setItems(Array.isArray(data?.items) ? data.items : []);
      setMetadata(data?.metadata || null);
    } catch (err) {
      console.error('Civitai fetch failed:', err);
      setError(err?.message || 'Failed to load images.');
      setItems([]);
      setMetadata(null);
    } finally {
      setBusy(false);
    }
  };

  const fetchModels = async () => {
    if (!appToken) {
      setModels([]);
      setSelectedModelId('');
      return;
    }
    setModelsBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/models`, {
        headers: { Authorization: `Bearer ${appToken}` },
      });
      if (!response.ok) {
        throw new Error('Failed to load models');
      }
      const data = await response.json();
      const incoming = Array.isArray(data) ? data : [];
      setModels(incoming);
      const active = incoming.find((item) => item.is_active) || incoming[0];
      setSelectedModelId(active ? String(active.id) : '');
    } catch (err) {
      console.error('Failed to fetch models:', err);
      setModels([]);
      setSelectedModelId('');
    } finally {
      setModelsBusy(false);
    }
  };

  const pollSwapJob = async (jobId) => {
    if (!jobId || !appToken) return;
    if (pollRef.current) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/swap-jobs?ids=${jobId}`, {
        headers: { Authorization: `Bearer ${appToken}` },
      });
      if (!response.ok) {
        throw new Error('Failed to check swap status.');
      }
      const payload = await response.json();
      const job = Array.isArray(payload?.items) ? payload.items[0] : null;
      if (!job) {
        throw new Error('Swap job not found.');
      }
      setSwapJobStatus(job.status || '');
      setSwapJobError(job.error || '');

      if (job.status === 'done' && job.generated_image_id) {
        window.dispatchEvent(new CustomEvent('input-images:refresh'));
        window.dispatchEvent(new CustomEvent('gallery:open', {
          detail: { imageId: job.generated_image_id },
        }));
        pollRef.current = null;
        return;
      }
      if (job.status === 'failed') {
        pollRef.current = null;
        return;
      }
      pollRef.current = window.setTimeout(() => pollSwapJob(jobId), 2000);
    } catch (err) {
      setSwapJobError(err?.message || 'Failed to check swap status.');
      pollRef.current = window.setTimeout(() => pollSwapJob(jobId), 3000);
    }
  };

  useEffect(() => {
    if (isActive) {
      fetchImages();
    }
  }, [isActive, params, token]);

  useEffect(() => {
    if (isActive) {
      fetchModels();
    }
  }, [isActive, appToken]);

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        window.clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const totalPages = toNumber(metadata?.totalPages, null);
  const previewIndex = items.findIndex((item) => item.id === previewId);
  const preview = previewIndex >= 0 ? items[previewIndex] : null;
  const modelLabel = (model) => {
    if (!model) return 'Unknown model';
    const personName = (model.person_name || model.name || '').trim() || model.name;
    const version = model.version || 1;
    return `${personName} v${version}`;
  };

  const showPrevious = () => {
    if (items.length === 0 || previewIndex < 0) return;
    const nextIndex = (previewIndex - 1 + items.length) % items.length;
    setPreviewId(items[nextIndex].id);
    setZoomLevel(1);
  };

  const showNext = () => {
    if (items.length === 0 || previewIndex < 0) return;
    const nextIndex = (previewIndex + 1) % items.length;
    setPreviewId(items[nextIndex].id);
    setZoomLevel(1);
  };

  useEffect(() => {
    if (!preview) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'ArrowLeft') showPrevious();
      else if (event.key === 'ArrowRight') showNext();
      else if (event.key === 'Escape') {
        setPreviewId(null);
        setZoomLevel(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preview, previewIndex, items]);

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(3, Math.round((prev + 0.25) * 100) / 100));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(1, Math.round((prev - 0.25) * 100) / 100));
  const handleZoomReset = () => setZoomLevel(1);

  const handleInference = async () => {
    if (!preview) return;
    if (!appToken) {
      setInferenceMessage('Please sign in to the app to use this image for inference.');
      return;
    }
    if (!selectedModelId) {
      setInferenceMessage('Select a model before starting inference.');
      return;
    }
    setInferenceBusy(true);
    setInferenceMessage('');
    setSwapJobId(null);
    setSwapJobStatus('');
    setSwapJobError('');
    if (pollRef.current) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    try {
      const imageResponse = await fetch(preview.url);
      if (!imageResponse.ok) {
        throw new Error('Failed to download image from Civitai.');
      }
      const blob = await imageResponse.blob();
      const extension = blob.type && blob.type.includes('png') ? 'png' : 'jpg';
      const filename = `civitai-${preview.id}.${extension}`;
      const formData = new FormData();
      formData.append('file', blob, filename);

      const uploadResponse = await fetch(`${apiBaseUrl}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${appToken}` },
        body: formData,
      });
      if (!uploadResponse.ok) {
        let detail = 'Failed to upload image for inference.';
        try {
          const data = await uploadResponse.json();
          detail = data?.detail || detail;
        } catch (_err) {
          // noop
        }
        throw new Error(detail);
      }
      const uploadPayload = await uploadResponse.json();
      const inputImageId = Number(uploadPayload?.id);
      if (!inputImageId) {
        throw new Error('Upload succeeded but no input image id was returned.');
      }

      const swapResponse = await fetch(`${apiBaseUrl}/swap-jobs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: Number(selectedModelId),
          image_ids: [inputImageId],
          enable_restore: true,
        }),
      });
      if (!swapResponse.ok) {
        let detail = 'Failed to start swap job.';
        try {
          const data = await swapResponse.json();
          detail = data?.detail || detail;
        } catch (_err) {
          // noop
        }
        throw new Error(detail);
      }
      const swapPayload = await swapResponse.json();
      const job = Array.isArray(swapPayload?.items) ? swapPayload.items[0] : null;
      const jobId = Number(job?.id);
      if (jobId) {
        setSwapJobId(jobId);
        setSwapJobStatus(job.status || 'queued');
        pollSwapJob(jobId);
      }

      setInferenceMessage('Swap queued. We will open the result when it is ready.');
      window.dispatchEvent(new CustomEvent('input-images:refresh'));
      if (typeof onUseInputImage === 'function') {
        onUseInputImage();
      }
    } catch (err) {
      setInferenceMessage(err?.message || 'Failed to use image for inference.');
    } finally {
      setInferenceBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Civitai Images</h2>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={fetchImages} disabled={busy}>Refresh</button>
        </div>
      </div>

      <div className="card" style={{ background: '#0f141f', borderColor: '#1e2636' }}>
        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label className="muted">Civitai API token</label>
            <input
              type="password"
              placeholder="Paste your Civitai API key"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
            />
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <button
              className="btn"
              onClick={() => {
                localStorage.setItem('civitai_token', tokenInput.trim());
                setToken(tokenInput.trim());
              }}
            >
              Save Token
            </button>
            <button
              className="btn"
              onClick={() => {
                localStorage.removeItem('civitai_token');
                setToken('');
                setTokenInput('');
              }}
              disabled={!token && !tokenInput}
            >
              Clear
            </button>
          </div>
        </div>
        <div className="muted">
          Token is optional for public images, but required for content that needs login.
        </div>
      </div>

      <div className="row">
        <div style={{ minWidth: 160 }}>
          <label className="muted">Username</label>
          <input
            type="text"
            placeholder="Filter by username"
            value={username}
            onChange={(event) => {
              setPage(1);
              setUsername(event.target.value);
            }}
          />
        </div>
        <div style={{ minWidth: 160 }}>
          <label className="muted">Model ID</label>
          <input
            type="text"
            placeholder="Filter by modelId"
            value={modelId}
            onChange={(event) => {
              setPage(1);
              setModelId(event.target.value);
            }}
          />
        </div>
        <div style={{ minWidth: 180 }}>
          <label className="muted">Model Version ID</label>
          <input
            type="text"
            placeholder="Filter by modelVersionId"
            value={modelVersionId}
            onChange={(event) => {
              setPage(1);
              setModelVersionId(event.target.value);
            }}
          />
        </div>
        <div style={{ minWidth: 220 }}>
          <label className="muted">Model for inference</label>
          {models.length === 0 ? (
            <div className="muted">{modelsBusy ? 'Loading models...' : 'No models available'}</div>
          ) : (
            <select
              value={selectedModelId}
              onChange={(event) => setSelectedModelId(event.target.value)}
              style={{ width: 220 }}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {modelLabel(model)}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="muted">NSFW</label>
          <select
            value={nsfw}
            onChange={(event) => {
              setPage(1);
              setNsfw(event.target.value);
            }}
            style={{ width: 140 }}
          >
            {NSFW_OPTIONS.map((option) => (
              <option key={option || 'all'} value={option}>
                {option || 'All'}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="muted">Sort</label>
          <select
            value={sort}
            onChange={(event) => {
              setPage(1);
              setSort(event.target.value);
            }}
            style={{ width: 180 }}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="muted">Period</label>
          <select
            value={period}
            onChange={(event) => {
              setPage(1);
              setPeriod(event.target.value);
            }}
            style={{ width: 140 }}
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="muted">Per page</label>
          <select
            value={limit}
            onChange={(event) => {
              setLimit(toNumber(event.target.value, 24));
              setPage(1);
            }}
            style={{ width: 120 }}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </div>
      </div>

      {busy ? (
        <div className="muted">Loading...</div>
      ) : error ? (
        <div className="muted">Error: {error}</div>
      ) : items.length === 0 ? (
        <div className="muted">No images found for the current filters.</div>
      ) : (
        <div className="grid">
          {items.map((image) => (
            <div key={image.id} className="preview-card">
              <div className="preview-meta">
                <span className="preview-name">#{image.id}</span>
                <span className="muted">{image.username || 'Unknown'}</span>
              </div>
              <img
                src={image.url}
                alt={`Civitai ${image.id}`}
                className="preview-img"
                loading="lazy"
                onClick={() => {
                  setPreviewId(image.id);
                  setZoomLevel(1);
                }}
                style={{ cursor: 'pointer' }}
              />
              <div className="muted">NSFW: {image.nsfwLevel || (image.nsfw ? 'Yes' : 'No')}</div>
              {image.stats && (
                <div className="muted">
                  Hearts {toNumber(image.stats.heartCount, 0)} | Likes {toNumber(image.stats.likeCount, 0)} | Comments {toNumber(image.stats.commentCount, 0)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="muted">
          Page {page}
          {totalPages ? ` / ${totalPages}` : ''}
          {metadata?.totalItems ? ` (${metadata.totalItems} total)` : ''}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={busy || page <= 1}
          >
            Previous
          </button>
          <button
            className="btn"
            onClick={() => setPage((prev) => prev + 1)}
            disabled={busy || (totalPages ? page >= totalPages : false)}
          >
            Next
          </button>
        </div>
      </div>

      <div className="muted">
        If you hit CORS errors in the browser, we can proxy the Civitai API through the backend.
      </div>

      {preview && (
        <div
          className="modal"
          onClick={() => {
            setPreviewId(null);
            setZoomLevel(1);
          }}
        >
          <button
            className="modal-close"
            onClick={(event) => {
              event.stopPropagation();
              setPreviewId(null);
              setZoomLevel(1);
            }}
          >
            &times;
          </button>
          <button
            className="btn"
            onClick={(event) => {
              event.stopPropagation();
              showPrevious();
            }}
            style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)' }}
          >
            &larr;
          </button>
          <img
            src={preview.url}
            alt={`Civitai ${preview.id}`}
            className="modal-content"
            onClick={(event) => event.stopPropagation()}
            style={{
              transform: `scale(${zoomLevel})`,
              transition: 'transform 120ms ease-out',
            }}
          />
          <button
            className="btn"
            onClick={(event) => {
              event.stopPropagation();
              showNext();
            }}
            style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)' }}
          >
            &rarr;
          </button>
          <div
            className="muted"
            style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)' }}
          >
            {previewIndex + 1} / {items.length}
          </div>
          <div
            className="row"
            style={{ position: 'absolute', bottom: 16, right: 16, gap: 8, alignItems: 'center' }}
          >
            <button className="btn" onClick={(event) => { event.stopPropagation(); handleZoomOut(); }}>
              -
            </button>
            <div className="muted" style={{ minWidth: 60, textAlign: 'center' }}>
              {Math.round(zoomLevel * 100)}%
            </div>
            <button className="btn" onClick={(event) => { event.stopPropagation(); handleZoomIn(); }}>
              +
            </button>
            <button className="btn" onClick={(event) => { event.stopPropagation(); handleZoomReset(); }}>
              Reset
            </button>
          </div>
          <button
            className="btn"
            onClick={(event) => {
              event.stopPropagation();
              handleInference();
            }}
            disabled={inferenceBusy}
            style={{
              position: 'absolute',
              top: 20,
              left: 20,
            }}
          >
            {inferenceBusy ? 'Starting...' : 'Use for Inference'}
          </button>
          {inferenceMessage && (
            <div
              className="muted"
              style={{
                position: 'absolute',
                top: 68,
                left: 20,
                background: '#0b0d12',
                border: '1px solid #2a3347',
                padding: '8px 12px',
                borderRadius: 8,
                maxWidth: 320,
              }}
            >
              {inferenceMessage}
            </div>
          )}
          {swapJobId && (
            <div
              className="muted"
              style={{
                position: 'absolute',
                top: inferenceMessage ? 132 : 68,
                left: 20,
                background: '#0b0d12',
                border: '1px solid #2a3347',
                padding: '8px 12px',
                borderRadius: 8,
                maxWidth: 320,
              }}
            >
              Swap status: {swapJobStatus || 'queued'}
              {swapJobError ? ` (${swapJobError})` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
