import React, { useState, useEffect } from 'react';
import './styles.css';
import { apiBaseUrl } from './utils';

export default function ImageGallery({ token }) {
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [previewId, setPreviewId] = useState(null);

  const fetchImages = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/images/generated`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setImages(data);
        setSelectedIds((prev) => {
          const available = new Set(data.map((image) => image.id));
          return prev.filter((id) => available.has(id));
        });
      } else {
        throw new Error('Failed to fetch images');
      }
    } catch (error) {
      console.error('Failed to fetch images:', error);
      alert('Error: ' + error.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteImages = async (ids) => {
    if (ids.length === 0) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/images/generated`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids }),
      });

      if (!response.ok) {
        let detail = 'Failed to delete images';
        try {
          const data = await response.json();
          if (data?.detail) {
            detail = data.detail;
          }
        } catch (_err) {
          // Keep default error message when response body is not JSON.
        }
        throw new Error(detail);
      }

      const deleted = new Set(ids);
      setImages((prev) => prev.filter((image) => !deleted.has(image.id)));
      setSelectedIds((prev) => prev.filter((id) => !deleted.has(id)));
      if (previewId !== null && deleted.has(previewId)) {
        setPreviewId(null);
      }
    } catch (error) {
      console.error('Failed to delete images:', error);
      alert('Error: ' + error.message);
    } finally {
      setDeleting(false);
    }
  };

  const toggleSelection = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const previewIndex = images.findIndex((image) => image.id === previewId);
  const preview = previewIndex >= 0 ? images[previewIndex] : null;

  const showPrevious = () => {
    if (images.length === 0 || previewIndex < 0) {
      return;
    }
    const nextIndex = (previewIndex - 1 + images.length) % images.length;
    setPreviewId(images[nextIndex].id);
  };

  const showNext = () => {
    if (images.length === 0 || previewIndex < 0) {
      return;
    }
    const nextIndex = (previewIndex + 1) % images.length;
    setPreviewId(images[nextIndex].id);
  };

  useEffect(() => {
    if (token) {
      fetchImages();
    }
  }, [token]);

  useEffect(() => {
    if (!preview) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === 'ArrowLeft') {
        showPrevious();
      } else if (event.key === 'ArrowRight') {
        showNext();
      } else if (event.key === 'Escape') {
        setPreviewId(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preview, previewIndex, images]);

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Generated Images</h2>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn"
            onClick={() => setSelectedIds(images.map((image) => image.id))}
            disabled={images.length === 0 || busy || deleting}
          >
            Select all
          </button>
          <button
            className="btn"
            onClick={() => setSelectedIds([])}
            disabled={selectedIds.length === 0 || busy || deleting}
          >
            Clear
          </button>
          <button
            className="btn"
            onClick={() => deleteImages(selectedIds)}
            disabled={selectedIds.length === 0 || busy || deleting}
            style={{ background: '#4a2525', borderColor: '#7a3a3a', color: '#ffc2c2' }}
          >
            Delete selected ({selectedIds.length})
          </button>
          <button className="btn" onClick={fetchImages} disabled={busy || deleting}>Refresh</button>
        </div>
      </div>
      <div style={{ height: 16 }} />
      {busy || deleting ? (
        <p>Loading...</p>
      ) : images.length === 0 ? (
        <div className="muted">No images generated yet.</div>
      ) : (
        <div className="grid">
          {images.map((image) => (
            <div key={image.id} className="card" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(image.id)}
                    onChange={() => toggleSelection(image.id)}
                  />
                  <span className="muted">#{image.id}</span>
                </label>
                <button
                  className="btn"
                  onClick={() => deleteImages([image.id])}
                  disabled={busy || deleting}
                  style={{ background: '#4a2525', borderColor: '#7a3a3a', color: '#ffc2c2', padding: '6px 10px' }}
                >
                  Delete
                </button>
              </div>
              <img 
                src={`data:image/jpeg;base64,${image.data}`}
                className="thumb"
                alt="Generated content"
                onClick={() => setPreviewId(image.id)}
                style={{ cursor: 'pointer' }}
              />
            </div>
          ))}
        </div>
      )}
      {preview && (
        <div className="modal" onClick={() => setPreviewId(null)}>
          <button
            className="modal-close"
            onClick={(event) => {
              event.stopPropagation();
              setPreviewId(null);
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
            src={`data:image/jpeg;base64,${preview.data}`}
            alt="Preview"
            className="modal-content"
            onClick={(event) => event.stopPropagation()}
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
            {previewIndex + 1} / {images.length}
          </div>
        </div>
      )}
    </div>
  );
}
