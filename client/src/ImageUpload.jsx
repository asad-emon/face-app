import React, { useState, useEffect, useRef } from 'react';
import './styles.css';
import { apiBaseUrl } from './utils';

let nextLocalId = 1;
const INPUT_PAGE_SIZE = 12;
const PAGE_SIZE_OPTIONS = [8, 12, 24, 48, 96];

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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollGeneratedVideoContent(videoId, token, options = {}) {
  const attempts = Number.isInteger(options.attempts) ? options.attempts : 120;
  const delayMs = Number.isInteger(options.delayMs) ? options.delayMs : 2000;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const statusResponse = await fetch(`${apiBaseUrl}/videos/generated/${videoId}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (statusResponse.ok) {
        const statusPayload = await statusResponse.json();
        const percent = Number(statusPayload?.progress_percent);
        if (onProgress && Number.isFinite(percent)) {
          onProgress(Math.max(0, Math.min(100, percent)));
        }
        if (!statusPayload?.processing && statusPayload?.has_content) {
          const contentResponse = await fetch(`${apiBaseUrl}/videos/generated/${videoId}/content`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (contentResponse.ok) {
            return contentResponse.blob();
          }
        }
      }
    } catch (_err) {
      // noop, fall back to content polling
    }

    const response = await fetch(`${apiBaseUrl}/videos/generated/${videoId}/content`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 409) {
      await wait(delayMs);
      continue;
    }
    if (!response.ok) {
      let detail = 'Failed to load generated video';
      try {
        const data = await response.json();
        detail = data?.detail || detail;
      } catch (_err) {
        // noop
      }
      throw new Error(detail);
    }
    return response.blob();
  }

  throw new Error('Video processing is taking longer than expected. Please try again.');
}

export default function ImageUpload({ token }) {
  const [targetImages, setTargetImages] = useState([]);
  const [models, setModels] = useState([]);
  const [selectedPerson, setSelectedPerson] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [enableRestore, setEnableRestore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState('');
  const [videoResultUrl, setVideoResultUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [videoProgress, setVideoProgress] = useState(0);
  const [inputImages, setInputImages] = useState([]);
  const [selectedInputImageIds, setSelectedInputImageIds] = useState([]);
  const [inputImageTotal, setInputImageTotal] = useState(0);
  const [inputImagePage, setInputImagePage] = useState(1);
  const [inputImagePageSize, setInputImagePageSize] = useState(INPUT_PAGE_SIZE);
  const [inputGalleryBusy, setInputGalleryBusy] = useState(false);
  const [reInferenceBusy, setReInferenceBusy] = useState(false);
  const [inputDeleteBusy, setInputDeleteBusy] = useState(false);
  const [reInferenceProgress, setReInferenceProgress] = useState({
    total: 0,
    completed: 0,
    success: 0,
    failed: 0,
    currentImageId: null,
  });
  const [inputImageJobStatus, setInputImageJobStatus] = useState({});
  const targetImagesRef = useRef([]);

  useEffect(() => {
    fetchModels();
  }, [token]);

  useEffect(() => {
    fetchInputImages();
  }, [token, inputImagePage, inputImagePageSize]);

  useEffect(() => {
    targetImagesRef.current = targetImages;
  }, [targetImages]);

  useEffect(() => {
    return () => {
      targetImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      if (videoPreviewUrl) {
        URL.revokeObjectURL(videoPreviewUrl);
      }
      if (videoResultUrl) {
        URL.revokeObjectURL(videoResultUrl);
      }
    };
  }, [videoPreviewUrl, videoResultUrl]);

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

  const fetchInputImages = async (options = {}) => {
    const nextPage = Number.isInteger(options.page) && options.page > 0 ? options.page : inputImagePage;
    const nextPageSize =
      Number.isInteger(options.pageSize) && options.pageSize > 0 ? options.pageSize : inputImagePageSize;
    const skip = (nextPage - 1) * nextPageSize;
    const params = new URLSearchParams({
      skip: String(skip),
      limit: String(nextPageSize),
      include_data: '1',
    });

    setInputGalleryBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/images?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('Failed to fetch input images');
      }
      const data = await response.json();
      const items = Array.isArray(data) ? data : data.items || [];
      const total = Array.isArray(data) ? items.length : Number(data.total) || 0;
      setInputImages(items);
      setInputImageTotal(total);
    } catch (error) {
      console.error('Failed to fetch input images:', error);
      alert('Error: ' + error.message);
    } finally {
      setInputGalleryBusy(false);
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

  const setVideoSelection = (file) => {
    if (videoPreviewUrl) {
      URL.revokeObjectURL(videoPreviewUrl);
    }
    if (videoResultUrl) {
      URL.revokeObjectURL(videoResultUrl);
      setVideoResultUrl('');
    }
    setVideoError('');
    setVideoProgress(0);
    if (!file) {
      setVideoFile(null);
      setVideoPreviewUrl('');
      return;
    }
    setVideoFile(file);
    setVideoPreviewUrl(URL.createObjectURL(file));
  };

  const clearVideoInput = () => {
    setVideoSelection(null);
    setVideoUrl('');
  };

  const buildVideoFileFromUrl = async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch video URL (${response.status})`);
    }
    const blob = await response.blob();
    const contentType = blob.type || 'video/mp4';
    let filename = 'remote-video.mp4';
    try {
      const parsed = new URL(url);
      const lastPart = parsed.pathname.split('/').filter(Boolean).pop();
      if (lastPart) {
        filename = lastPart;
      }
    } catch (_err) {
      // noop
    }
    return new File([blob], filename, { type: contentType });
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
            `${apiBaseUrl}/swap?model_id=${selectedModelId}&image_id=${imageId}&enable_restore=${enableRestore ? '1' : '0'}`,
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
      await fetchInputImages();
      setBusy(false);
    }
  };

  const handleReInference = async () => {
    if (!selectedModelId) {
      alert('Please select a person/version first.');
      return;
    }
    if (selectedInputImageIds.length === 0) {
      alert('Select at least one input image from the gallery.');
      return;
    }

    const queue = [...selectedInputImageIds];
    setReInferenceBusy(true);
    setReInferenceProgress({
      total: queue.length,
      completed: 0,
      success: 0,
      failed: 0,
      currentImageId: null,
    });
    setInputImageJobStatus((prev) => {
      const next = { ...prev };
      queue.forEach((id) => {
        next[id] = 'queued';
      });
      return next;
    });

    let success = 0;
    let failed = 0;
    try {
      const createResponse = await fetch(`${apiBaseUrl}/swap-jobs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: Number(selectedModelId),
          image_ids: queue,
          enable_restore: enableRestore,
        }),
      });
      if (!createResponse.ok) {
        const errorData = await createResponse.json().catch(() => null);
        throw new Error(errorData?.detail || 'Failed to enqueue re-inference jobs');
      }
      const createData = await createResponse.json();
      const jobs = Array.isArray(createData?.items) ? createData.items : [];
      const jobIds = jobs.map((job) => Number(job.id)).filter((id) => Number.isInteger(id) && id > 0);
      if (jobIds.length === 0) {
        throw new Error('No jobs were created');
      }

      let done = false;
      while (!done) {
        const pollResponse = await fetch(`${apiBaseUrl}/swap-jobs?ids=${jobIds.join(',')}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!pollResponse.ok) {
          const errorData = await pollResponse.json().catch(() => null);
          throw new Error(errorData?.detail || 'Failed to poll re-inference jobs');
        }
        const pollData = await pollResponse.json();
        const polledJobs = Array.isArray(pollData?.items) ? pollData.items : [];

        let completed = 0;
        success = 0;
        failed = 0;
        let currentImageId = null;
        const nextJobStatus = {};
        polledJobs.forEach((job) => {
          const status = String(job?.status || 'queued');
          const imageId = Number(job?.input_image_id);
          if (Number.isInteger(imageId) && imageId > 0) {
            nextJobStatus[imageId] = status;
          }
          if (status === 'done') {
            completed += 1;
            success += 1;
          } else if (status === 'failed') {
            completed += 1;
            failed += 1;
          } else if (!currentImageId && status === 'processing' && Number.isInteger(imageId) && imageId > 0) {
            currentImageId = imageId;
          }
        });
        setInputImageJobStatus((prev) => ({ ...prev, ...nextJobStatus }));
        setReInferenceProgress({
          total: jobIds.length,
          completed,
          success,
          failed,
          currentImageId,
        });

        done = completed >= jobIds.length;
        if (!done) {
          await wait(1200);
        }
      }

      await fetchInputImages();
      alert(`Re-inference completed. Success: ${success}, Failed: ${failed}`);
    } catch (error) {
      alert(`Error: ${error.message || 'Unknown error'}`);
    } finally {
      setReInferenceProgress((prev) => ({ ...prev, currentImageId: null }));
      setReInferenceBusy(false);
    }
  };

  const deleteInputImages = async (ids) => {
    if (ids.length === 0) return;
    setInputDeleteBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/images`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || 'Failed to delete input images');
      }

      const payload = await response.json();
      const deletedInput = Number(payload?.deleted_input) || 0;
      const deletedGenerated = Number(payload?.deleted_generated) || 0;
      const deletedSet = new Set(ids);
      setSelectedInputImageIds((prev) => prev.filter((id) => !deletedSet.has(id)));

      const nextTotal = Math.max(0, inputImageTotal - deletedInput);
      const totalPages = Math.max(1, Math.ceil(nextTotal / inputImagePageSize));
      const nextPage = Math.min(inputImagePage, totalPages);
      setInputImagePage(nextPage);
      await fetchInputImages({ page: nextPage });
      alert(`Deleted ${deletedInput} input image(s) and ${deletedGenerated} generated result(s).`);
    } catch (error) {
      console.error('Failed to delete input images:', error);
      alert('Error: ' + error.message);
    } finally {
      setInputDeleteBusy(false);
    }
  };

  const handleVideoSwap = async () => {
    if (!selectedModelId) {
      alert('Please select a person/version first.');
      return;
    }
    if (!videoFile && !videoUrl) {
      alert('Please select a target video or paste a video URL first.');
      return;
    }

    setVideoBusy(true);
    setVideoError('');
    setVideoProgress(0);

    try {
      let fileToUpload = videoFile;
      if (!fileToUpload && videoUrl) {
        fileToUpload = await buildVideoFileFromUrl(videoUrl.trim());
        setVideoSelection(fileToUpload);
      }

      const formData = new FormData();
      formData.append('file', fileToUpload);
      formData.append('model_id', selectedModelId);
      formData.append('enable_restore', enableRestore ? '1' : '0');

      const response = await fetch(`${apiBaseUrl}/swap-video`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || 'Video face swap failed');
      }

      const payload = await response.json().catch(() => null);
      const generatedVideoId = Number(payload?.id || payload?.generated_video_id);
      if (!generatedVideoId) {
        throw new Error('Video swap did not return a generated id');
      }

      const outputBlob = await pollGeneratedVideoContent(generatedVideoId, token, {
        onProgress: (percent) => setVideoProgress(percent),
      });
      if (videoResultUrl) {
        URL.revokeObjectURL(videoResultUrl);
      }
      setVideoResultUrl(URL.createObjectURL(outputBlob));
      setVideoProgress(100);
    } catch (error) {
      setVideoError(error.message || 'Unknown error');
    } finally {
      setVideoBusy(false);
    }
  };

  const processedCount = targetImages.filter((item) => item.status === 'done').length;
  const failedCount = targetImages.filter((item) => item.status === 'failed').length;
  const pendingCount = targetImages.filter(
    (item) => item.status === 'idle' || item.status === 'uploading' || item.status === 'swapping'
  ).length;
  const controlsDisabled = busy || videoBusy || reInferenceBusy || inputDeleteBusy;

  const statusText = (status) => {
    if (status === 'uploading') return 'Uploading';
    if (status === 'swapping') return 'Swapping';
    if (status === 'done') return 'Done';
    if (status === 'failed') return 'Failed';
    return 'Pending';
  };
  const reInferencePercent = reInferenceProgress.total > 0
    ? Math.round((reInferenceProgress.completed / reInferenceProgress.total) * 100)
    : 0;

  return (
    <div>
      <div className="card">
        <h2>Perform Face Swaps</h2>

        <label className="muted">Person</label>
        <select
          value={selectedPerson}
          onChange={(e) => handlePersonChange(e.target.value)}
          disabled={modelGroups.length === 0 || controlsDisabled}
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
          disabled={!selectedGroup || controlsDisabled}
        >
          <option value="" disabled>Select a version</option>
          {(selectedGroup?.versions || []).map((model) => (
            <option key={model.id} value={model.id}>
              v{model.version || 1}{model.is_active ? ' (Active)' : ''}
            </option>
          ))}
        </select>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={enableRestore}
            onChange={(e) => setEnableRestore(e.target.checked)}
            disabled={controlsDisabled}
          />
          <span>Enable face restore (slower, better quality)</span>
        </label>

        <input
          type="file"
          accept="image/*"
          multiple
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          disabled={controlsDisabled}
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
              disabled={controlsDisabled || !selectedModelId || targetImages.length === 0}
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

        <hr style={{ margin: '16px 0', borderColor: '#ddd' }} />
        <h3>Video Face Swap</h3>
        <p className="muted">Upload one target video and run swap with the selected model version.</p>
        <input
          type="file"
          accept="video/*"
          onChange={(e) => {
            const file = e.target.files?.[0] || null;
            setVideoSelection(file);
            if (file) {
              setVideoUrl('');
            }
            e.target.value = '';
          }}
          disabled={controlsDisabled}
        />
        <div className="muted" style={{ marginTop: 8 }}>Or paste a video URL</div>
        <input
          type="url"
          placeholder="https://example.com/video.mp4"
          value={videoUrl}
          onChange={(e) => {
            setVideoUrl(e.target.value);
            if (e.target.value) {
              setVideoSelection(null);
            }
          }}
          disabled={controlsDisabled}
          style={{ width: '100%' }}
        />
        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          <button
            onClick={handleVideoSwap}
            disabled={controlsDisabled || !selectedModelId || (!videoFile && !videoUrl)}
          >
            Process Video
          </button>
          <button
            onClick={() => clearVideoInput()}
            disabled={controlsDisabled || (!videoFile && !videoUrl)}
          >
            Clear Video
          </button>
        </div>
        {videoError && <div className="error" style={{ marginTop: 8 }}>{videoError}</div>}
        {videoPreviewUrl && (
          <div style={{ marginTop: 12 }}>
            <div className="muted">Input video</div>
            <video src={videoPreviewUrl} controls className="preview-img" />
          </div>
        )}
        {videoResultUrl && (
          <div style={{ marginTop: 12 }}>
            <div className="muted">Swapped video</div>
            <video src={videoResultUrl} controls className="preview-img" />
          </div>
        )}
      </div>

      {busy && <p>Processing queued images...</p>}
      {videoBusy && <p>Processing video...</p>}

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Input Image Gallery</h3>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn"
            onClick={() => {
              const pageIds = inputImages.map((item) => item.id);
              setSelectedInputImageIds((prev) => {
                const next = new Set(prev);
                pageIds.forEach((id) => next.add(id));
                return Array.from(next);
              });
            }}
            disabled={inputImages.length === 0 || inputGalleryBusy || inputDeleteBusy || reInferenceBusy}
          >
            Select all (page)
          </button>
          <button
            className="btn"
            onClick={() => setSelectedInputImageIds([])}
            disabled={selectedInputImageIds.length === 0 || inputDeleteBusy || reInferenceBusy}
          >
            Clear selection
          </button>
          <button
            className="btn"
            onClick={handleReInference}
            disabled={selectedInputImageIds.length === 0 || !selectedModelId || controlsDisabled}
          >
            Re-inference selected ({selectedInputImageIds.length})
          </button>
          <button
            className="btn"
            onClick={() => deleteInputImages(selectedInputImageIds)}
            disabled={selectedInputImageIds.length === 0 || inputDeleteBusy || reInferenceBusy}
            style={{ background: '#4a2525', borderColor: '#7a3a3a', color: '#ffc2c2' }}
          >
            Delete selected ({selectedInputImageIds.length})
          </button>
        </div>
        {(reInferenceBusy || reInferenceProgress.total > 0) && (
          <div className="card" style={{ padding: 10 }}>
            <div className="muted">
              Re-inference Progress: {reInferenceProgress.completed}/{reInferenceProgress.total} ({reInferencePercent}%)
            </div>
            <div className="muted">
              Success: {reInferenceProgress.success} | Failed: {reInferenceProgress.failed}
              {reInferenceBusy && reInferenceProgress.currentImageId
                ? ` | Processing image #${reInferenceProgress.currentImageId}`
                : ''}
            </div>
            <progress
              value={reInferenceProgress.completed}
              max={Math.max(1, reInferenceProgress.total)}
              style={{ width: '100%' }}
            />
          </div>
        )}

        {inputGalleryBusy || inputDeleteBusy ? (
          <p>Loading input images...</p>
        ) : inputImages.length === 0 ? (
          <div className="muted">No input images found.</div>
        ) : (
          <>
            <div className="preview-grid">
              {inputImages.map((item) => (
                <div key={item.id} className="preview-card">
                  <img
                    src={`data:image/jpeg;base64,${item.data}`}
                    alt={item.filename || `Input #${item.id}`}
                    className="preview-img"
                  />
                  <div className="preview-meta">
                    <span className="preview-name">#{item.id} {item.filename}</span>
                    <input
                      type="checkbox"
                      checked={selectedInputImageIds.includes(item.id)}
                      onChange={() =>
                        setSelectedInputImageIds((prev) =>
                          prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
                        )
                      }
                      disabled={inputDeleteBusy || reInferenceBusy}
                    />
                  </div>
                  {inputImageJobStatus[item.id] && (
                    <div className="muted">Job: {inputImageJobStatus[item.id]}</div>
                  )}
                  <button
                    className="btn"
                    onClick={() => deleteInputImages([item.id])}
                    disabled={inputDeleteBusy || reInferenceBusy}
                    style={{ background: '#4a2525', borderColor: '#7a3a3a', color: '#ffc2c2', padding: '6px 10px' }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>

            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <div className="muted">
                Page {inputImagePage} / {Math.max(1, Math.ceil(inputImageTotal / inputImagePageSize))} ({inputImageTotal} total)
              </div>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <label className="muted" htmlFor="input-page-size">Per page</label>
                <select
                  id="input-page-size"
                  value={inputImagePageSize}
                  onChange={(event) => {
                    setInputImagePageSize(Number(event.target.value));
                    setInputImagePage(1);
                  }}
                  disabled={inputGalleryBusy || inputDeleteBusy || reInferenceBusy}
                  style={{ width: 90 }}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
                <button
                  className="btn"
                  onClick={() => setInputImagePage((prev) => Math.max(1, prev - 1))}
                  disabled={inputGalleryBusy || inputDeleteBusy || reInferenceBusy || inputImagePage <= 1}
                >
                  Previous
                </button>
                <button
                  className="btn"
                  onClick={() => setInputImagePage((prev) => prev + 1)}
                  disabled={
                    inputGalleryBusy ||
                    inputDeleteBusy ||
                    reInferenceBusy ||
                    inputImagePage >= Math.max(1, Math.ceil(inputImageTotal / inputImagePageSize))
                  }
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
