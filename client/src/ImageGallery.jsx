import React, { useState, useEffect, useRef } from 'react';
import './styles.css';
import { apiBaseUrl } from './utils';

const IMAGE_PAGE_SIZE = 12;
const VIDEO_PAGE_SIZE = 8;
const PAGE_SIZE_OPTIONS = [8, 12, 24, 48];

function GalleryTab({ active, onClick, children }) {
  return <button className={active ? 'tab active' : 'tab'} onClick={onClick}>{children}</button>;
}

export default function ImageGallery({ token, isActive = false }) {
  const [activeType, setActiveType] = useState('images');
  const [images, setImages] = useState([]);
  const [videos, setVideos] = useState([]);
  const [modelsById, setModelsById] = useState({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedImageIds, setSelectedImageIds] = useState([]);
  const [selectedVideoIds, setSelectedVideoIds] = useState([]);
  const [imageTotal, setImageTotal] = useState(0);
  const [videoTotal, setVideoTotal] = useState(0);
  const [imagePage, setImagePage] = useState(1);
  const [videoPage, setVideoPage] = useState(1);
  const [imagePageSize, setImagePageSize] = useState(IMAGE_PAGE_SIZE);
  const [videoPageSize, setVideoPageSize] = useState(VIDEO_PAGE_SIZE);
  const [previewId, setPreviewId] = useState(null);
  const [videoSources, setVideoSources] = useState({});
  const [loadingVideoIds, setLoadingVideoIds] = useState([]);
  const [statusLoadingIds, setStatusLoadingIds] = useState([]);
  const [zoomLevel, setZoomLevel] = useState(1);
  const videoSourcesRef = useRef({});

  const fetchGallery = async (options = {}) => {
    const nextImagePage = Number.isInteger(options.imagePage) && options.imagePage > 0 ? options.imagePage : imagePage;
    const nextVideoPage = Number.isInteger(options.videoPage) && options.videoPage > 0 ? options.videoPage : videoPage;
    const imageSkip = (nextImagePage - 1) * imagePageSize;
    const videoSkip = (nextVideoPage - 1) * videoPageSize;
    const imageParams = new URLSearchParams({ skip: String(imageSkip), limit: String(imagePageSize) });
    const videoParams = new URLSearchParams({ skip: String(videoSkip), limit: String(videoPageSize) });

    setBusy(true);
    try {
      const [imagesResponse, videosResponse, modelsResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/images/generated?${imageParams.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${apiBaseUrl}/videos/generated?${videoParams.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${apiBaseUrl}/models`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (!imagesResponse.ok) {
        throw new Error('Failed to fetch images');
      }
      if (!videosResponse.ok) {
        throw new Error('Failed to fetch videos');
      }

      const [imageData, videoData] = await Promise.all([
        imagesResponse.json(),
        videosResponse.json(),
      ]);

      const imageItems = Array.isArray(imageData) ? imageData : imageData.items || [];
      const videoItems = Array.isArray(videoData) ? videoData : videoData.items || [];
      const nextImageTotal = Array.isArray(imageData) ? imageItems.length : Number(imageData.total) || 0;
      const nextVideoTotal = Array.isArray(videoData) ? videoItems.length : Number(videoData.total) || 0;

      setImages(imageItems);
      setVideos(videoItems);
      setImageTotal(nextImageTotal);
      setVideoTotal(nextVideoTotal);
      setSelectedImageIds((prev) => {
        const available = new Set(imageItems.map((item) => item.id));
        return prev.filter((id) => available.has(id));
      });
      setSelectedVideoIds((prev) => {
        const available = new Set(videoItems.map((item) => item.id));
        return prev.filter((id) => available.has(id));
      });

      if (modelsResponse.ok) {
        const models = await modelsResponse.json();
        const lookup = {};
        models.forEach((model) => {
          lookup[model.id] = model;
        });
        setModelsById(lookup);
      } else {
        setModelsById({});
      }
    } catch (error) {
      console.error('Failed to fetch gallery:', error);
      alert('Error: ' + error.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteImages = async (ids) => {
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/images/generated`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) {
        let detail = 'Failed to delete images';
        try {
          const data = await response.json();
          detail = data?.detail || detail;
        } catch (_err) {
          // noop
        }
        throw new Error(detail);
      }

      const payload = await response.json();
      const deletedCount = Number(payload?.deleted) || 0;
      const deleted = new Set(ids);
      setSelectedImageIds((prev) => prev.filter((id) => !deleted.has(id)));
      if (previewId !== null && deleted.has(previewId)) {
        setPreviewId(null);
      }
      const nextTotal = Math.max(0, imageTotal - deletedCount);
      const totalPages = Math.max(1, Math.ceil(nextTotal / imagePageSize));
      const nextPage = Math.min(imagePage, totalPages);
      setImagePage(nextPage);
      await fetchGallery({ imagePage: nextPage });
    } catch (error) {
      console.error('Failed to delete images:', error);
      alert('Error: ' + error.message);
    } finally {
      setDeleting(false);
    }
  };

  const deleteSourceImage = async (inputImageId) => {
    if (!inputImageId) return;
    setDeleting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/images/${inputImageId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        let detail = 'Failed to delete source image';
        try {
          const data = await response.json();
          detail = data?.detail || detail;
        } catch (_err) {
          // noop
        }
        throw new Error(detail);
      }

      const payload = await response.json();
      const deletedGenerated = Number(payload?.deleted_generated) || 0;
      const deletedInput = Number(payload?.deleted_input) || 0;
      const removedIds = new Set(
        images.filter((item) => item.input_image_id === inputImageId).map((item) => item.id)
      );
      setSelectedImageIds((prev) => prev.filter((id) => !removedIds.has(id)));
      if (previewId !== null && removedIds.has(previewId)) {
        setPreviewId(null);
      }

      const nextTotal = Math.max(0, imageTotal - deletedGenerated);
      const totalPages = Math.max(1, Math.ceil(nextTotal / imagePageSize));
      const nextPage = Math.min(imagePage, totalPages);
      setImagePage(nextPage);
      await fetchGallery({ imagePage: nextPage });
      if (deletedInput > 0) {
        alert('Deleted source image and its generated results.');
      }
    } catch (error) {
      console.error('Failed to delete source image:', error);
      alert('Error: ' + error.message);
    } finally {
      setDeleting(false);
    }
  };

  const deleteVideos = async (ids) => {
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/videos/generated`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) {
        let detail = 'Failed to delete videos';
        try {
          const data = await response.json();
          detail = data?.detail || detail;
        } catch (_err) {
          // noop
        }
        throw new Error(detail);
      }

      const payload = await response.json();
      const deletedCount = Number(payload?.deleted) || 0;
      const deleted = new Set(ids);
      setSelectedVideoIds((prev) => prev.filter((id) => !deleted.has(id)));
      setVideoSources((prev) => {
        const next = { ...prev };
        ids.forEach((id) => {
          if (next[id]) {
            URL.revokeObjectURL(next[id]);
            delete next[id];
          }
        });
        return next;
      });
      const nextTotal = Math.max(0, videoTotal - deletedCount);
      const totalPages = Math.max(1, Math.ceil(nextTotal / videoPageSize));
      const nextPage = Math.min(videoPage, totalPages);
      setVideoPage(nextPage);
      await fetchGallery({ videoPage: nextPage });
    } catch (error) {
      console.error('Failed to delete videos:', error);
      alert('Error: ' + error.message);
    } finally {
      setDeleting(false);
    }
  };

  const modelLabel = (modelId) => {
    const model = modelsById[modelId];
    if (!model) return 'Model not found';
    const personName = (model.person_name || model.name || '').trim() || model.name;
    const version = model.version || 1;
    return `${personName} v${version}`;
  };

  const loadVideoSource = async (video) => {
    if (!video || video.processing || !video.has_content || videoSources[video.id]) {
      return;
    }
    setLoadingVideoIds((prev) => (prev.includes(video.id) ? prev : [...prev, video.id]));
    try {
      const response = await fetch(`${apiBaseUrl}/videos/generated/${video.id}/content`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        let detail = "Failed to load video";
        try {
          const data = await response.json();
          detail = data?.detail || detail;
        } catch (_err) {
          // noop
        }
        throw new Error(detail);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      setVideoSources((prev) => {
        const next = { ...prev };
        if (next[video.id]) {
          URL.revokeObjectURL(next[video.id]);
        }
        next[video.id] = objectUrl;
        return next;
      });
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoadingVideoIds((prev) => prev.filter((id) => id !== video.id));
    }
  };

  const refreshVideoStatus = async (video) => {
    if (!video) return;
    setStatusLoadingIds((prev) => (prev.includes(video.id) ? prev : [...prev, video.id]));
    try {
      const response = await fetch(`${apiBaseUrl}/videos/generated/${video.id}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        let detail = 'Failed to fetch video status';
        try {
          const data = await response.json();
          detail = data?.detail || detail;
        } catch (_err) {
          // noop
        }
        throw new Error(detail);
      }
      const payload = await response.json();
      setVideos((prev) =>
        prev.map((item) => (item.id === video.id ? { ...item, ...payload } : item))
      );
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setStatusLoadingIds((prev) => prev.filter((id) => id !== video.id));
    }
  };

  const previewIndex = images.findIndex((image) => image.id === previewId);
  const preview = previewIndex >= 0 ? images[previewIndex] : null;

  const showPrevious = () => {
    if (images.length === 0 || previewIndex < 0) return;
    const nextIndex = (previewIndex - 1 + images.length) % images.length;
    setPreviewId(images[nextIndex].id);
    setZoomLevel(1);
  };

  const showNext = () => {
    if (images.length === 0 || previewIndex < 0) return;
    const nextIndex = (previewIndex + 1) % images.length;
    setPreviewId(images[nextIndex].id);
    setZoomLevel(1);
  };

  useEffect(() => {
    if (token && isActive) {
      fetchGallery();
    }
  }, [token, isActive, imagePage, videoPage, imagePageSize, videoPageSize]);

  useEffect(() => {
    if (!preview) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'ArrowLeft') showPrevious();
      else if (event.key === 'ArrowRight') showNext();
      else if (event.key === 'Escape') setPreviewId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preview, previewIndex, images]);

  useEffect(() => {
    videoSourcesRef.current = videoSources;
  }, [videoSources]);

  useEffect(() => {
    return () => {
      Object.values(videoSourcesRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(3, Math.round((prev + 0.25) * 100) / 100));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(1, Math.round((prev - 0.25) * 100) / 100));
  const handleZoomReset = () => setZoomLevel(1);

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Generated Media</h2>
        <div className="row" style={{ gap: 8 }}>
          <GalleryTab active={activeType === 'images'} onClick={() => setActiveType('images')}>Images</GalleryTab>
          <GalleryTab active={activeType === 'videos'} onClick={() => setActiveType('videos')}>Videos</GalleryTab>
          <button className="btn" onClick={() => fetchGallery()} disabled={busy || deleting}>Refresh</button>
        </div>
      </div>

      {activeType === 'images' && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn"
              onClick={() => setSelectedImageIds(images.map((item) => item.id))}
              disabled={images.length === 0 || busy || deleting}
            >
              Select all
            </button>
            <button
              className="btn"
              onClick={() => setSelectedImageIds([])}
              disabled={selectedImageIds.length === 0 || busy || deleting}
            >
              Clear
            </button>
            <button
              className="btn"
              onClick={() => deleteImages(selectedImageIds)}
              disabled={selectedImageIds.length === 0 || busy || deleting}
              style={{ background: '#4a2525', borderColor: '#7a3a3a', color: '#ffc2c2' }}
            >
              Delete selected ({selectedImageIds.length})
            </button>
          </div>
          {busy || deleting ? (
            <p>Loading...</p>
          ) : images.length === 0 ? (
            <div className="muted">No images generated yet.</div>
          ) : (
            <>
              <div className="grid">
                {images.map((image) => (
                  <div key={image.id} className="card" style={{ padding: 12 }}>
                    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={selectedImageIds.includes(image.id)}
                          onChange={() =>
                            setSelectedImageIds((prev) =>
                              prev.includes(image.id) ? prev.filter((id) => id !== image.id) : [...prev, image.id]
                            )
                          }
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
                    <div className="muted" style={{ marginTop: 8 }}>{modelLabel(image.face_model_id)}</div>
                  </div>
                ))}
              </div>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <div className="muted">
                  Page {imagePage} / {Math.max(1, Math.ceil(imageTotal / imagePageSize))} ({imageTotal} total)
                </div>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <label className="muted" htmlFor="image-page-size">Per page</label>
                  <select
                    id="image-page-size"
                    value={imagePageSize}
                    onChange={(event) => {
                      setImagePageSize(Number(event.target.value));
                      setImagePage(1);
                    }}
                    disabled={busy || deleting}
                    style={{ width: 90 }}
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                  <button
                    className="btn"
                    onClick={() => setImagePage((prev) => Math.max(1, prev - 1))}
                    disabled={busy || deleting || imagePage <= 1}
                  >
                    Previous
                  </button>
                  <button
                    className="btn"
                    onClick={() => setImagePage((prev) => prev + 1)}
                    disabled={
                      busy ||
                      deleting ||
                      imagePage >= Math.max(1, Math.ceil(imageTotal / imagePageSize))
                    }
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {activeType === 'videos' && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn"
              onClick={() => setSelectedVideoIds(videos.map((item) => item.id))}
              disabled={videos.length === 0 || busy || deleting}
            >
              Select all
            </button>
            <button
              className="btn"
              onClick={() => setSelectedVideoIds([])}
              disabled={selectedVideoIds.length === 0 || busy || deleting}
            >
              Clear
            </button>
            <button
              className="btn"
              onClick={() => deleteVideos(selectedVideoIds)}
              disabled={selectedVideoIds.length === 0 || busy || deleting}
              style={{ background: '#4a2525', borderColor: '#7a3a3a', color: '#ffc2c2' }}
            >
              Delete selected ({selectedVideoIds.length})
            </button>
          </div>
          {busy || deleting ? (
            <p>Loading...</p>
          ) : videos.length === 0 ? (
            <div className="muted">No videos generated yet.</div>
          ) : (
            <>
              <div className="preview-grid">
                {videos.map((video) => (
                  <div key={video.id} className="preview-card">
                    <div className="preview-meta">
                      <span className="preview-name">#{video.id} {video.filename}</span>
                      <input
                        type="checkbox"
                        checked={selectedVideoIds.includes(video.id)}
                        onChange={() =>
                          setSelectedVideoIds((prev) =>
                            prev.includes(video.id) ? prev.filter((id) => id !== video.id) : [...prev, video.id]
                          )
                        }
                      />
                    </div>
                    {videoSources[video.id] ? (
                      <video
                        src={videoSources[video.id]}
                        controls
                        className="preview-img"
                      />
                    ) : video.processing ? (
                      <div className="muted">
                        Video is still processing{Number.isFinite(video.progress_percent)
                          ? ` (${video.progress_percent}%)`
                          : ''}.
                      </div>
                    ) : !video.has_content ? (
                      <div className="muted">No playable video data yet.</div>
                    ) : (
                      <div className="muted">Ready to load.</div>
                    )}
                    <div className="muted">Model: {modelLabel(video.face_model_id)}</div>
                    <div className="muted">Processing: {video.processing ? 'Yes' : 'No'}</div>
                    <div className="row" style={{ gap: 8, marginTop: 8 }}>
                      <button
                        className="btn"
                        onClick={() => refreshVideoStatus(video)}
                        disabled={statusLoadingIds.includes(video.id) || busy || deleting}
                      >
                        {statusLoadingIds.includes(video.id) ? 'Refreshing...' : 'Refresh Status'}
                      </button>
                      {!video.processing && video.has_content && !videoSources[video.id] && (
                        <button
                          className="btn"
                          onClick={() => loadVideoSource(video)}
                          disabled={loadingVideoIds.includes(video.id)}
                        >
                          {loadingVideoIds.includes(video.id) ? 'Loading...' : 'Load Video'}
                        </button>
                      )}
                    </div>
                    <button
                      className="btn"
                      onClick={() => deleteVideos([video.id])}
                      disabled={busy || deleting}
                      style={{ background: '#4a2525', borderColor: '#7a3a3a', color: '#ffc2c2', padding: '6px 10px' }}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <div className="muted">
                  Page {videoPage} / {Math.max(1, Math.ceil(videoTotal / videoPageSize))} ({videoTotal} total)
                </div>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <label className="muted" htmlFor="video-page-size">Per page</label>
                  <select
                    id="video-page-size"
                    value={videoPageSize}
                    onChange={(event) => {
                      setVideoPageSize(Number(event.target.value));
                      setVideoPage(1);
                    }}
                    disabled={busy || deleting}
                    style={{ width: 90 }}
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                  <button
                    className="btn"
                    onClick={() => setVideoPage((prev) => Math.max(1, prev - 1))}
                    disabled={busy || deleting || videoPage <= 1}
                  >
                    Previous
                  </button>
                  <button
                    className="btn"
                    onClick={() => setVideoPage((prev) => prev + 1)}
                    disabled={
                      busy ||
                      deleting ||
                      videoPage >= Math.max(1, Math.ceil(videoTotal / videoPageSize))
                    }
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

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
            src={`data:image/jpeg;base64,${preview.data}`}
            alt="Preview"
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
            {previewIndex + 1} / {images.length}
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
              deleteImages([preview.id]);
            }}
            disabled={busy || deleting}
            style={{
              position: 'absolute',
              top: 20,
              left: 20,
              background: '#4a2525',
              borderColor: '#7a3a3a',
              color: '#ffc2c2',
            }}
          >
            Delete image
          </button>
          <button
            className="btn"
            onClick={(event) => {
              event.stopPropagation();
              deleteSourceImage(preview.input_image_id);
            }}
            disabled={busy || deleting || !preview.input_image_id}
            style={{
              position: 'absolute',
              top: 20,
              right: 20,
              background: '#4a2525',
              borderColor: '#7a3a3a',
              color: '#ffc2c2',
            }}
          >
            Delete source image
          </button>
        </div>
      )}
    </div>
  );
}
