import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiBaseUrl } from '../../utils';
import { useApp } from '../../contexts/AppContext.jsx';
import {
  INPUT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  buildVideoFileFromUrl,
  getDefaultVersionId,
  groupByPerson,
  wait,
} from './swapUtils.js';

let nextLocalId = 1;

const SwapContext = createContext(null);

export function SwapProvider({ children }) {
  const { token, settings, settingsLoaded } = useApp();
  const expressionRestoreEnabled = settings?.expression_restore_enabled !== false;
  const restoreDefaultApplied = useRef(false);
  const [targetImages, setTargetImages] = useState([]);
  const [models, setModels] = useState([]);
  const [selectedPerson, setSelectedPerson] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [enableRestore, setEnableRestore] = useState(false);
  const [expressionStrength, setExpressionStrength] = useState(0.85);
  const [swapModel, setSwapModel] = useState('inswapper_128');
  const [busy, setBusy] = useState(false);
  const [videoFiles, setVideoFiles] = useState([]);
  const [videoPreviewItems, setVideoPreviewItems] = useState([]);
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
  const [swapTab, setSwapTab] = useState('image');
  const targetImagesRef = useRef([]);

  useEffect(() => {
    targetImagesRef.current = targetImages;
  }, [targetImages]);

  // Default the per-swap restore toggle from the master setting, and force it
  // off whenever the feature is disabled in settings.
  useEffect(() => {
    if (!settingsLoaded) return;
    if (!expressionRestoreEnabled) {
      setEnableRestore(false);
      restoreDefaultApplied.current = true;
      return;
    }
    if (!restoreDefaultApplied.current) {
      setEnableRestore(true);
      restoreDefaultApplied.current = true;
    }
  }, [settingsLoaded, expressionRestoreEnabled]);

  useEffect(() => {
    return () => {
      targetImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      videoPreviewItems.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      if (videoResultUrl) {
        URL.revokeObjectURL(videoResultUrl);
      }
    };
  }, [videoPreviewItems, videoResultUrl]);

  const modelGroups = useMemo(() => groupByPerson(models), [models]);
  const selectedGroup = useMemo(
    () => modelGroups.find((group) => group.personName === selectedPerson) || null,
    [modelGroups, selectedPerson]
  );

  const fetchModels = useCallback(async () => {
    if (!token) return;
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
  }, [token, selectedPerson, selectedModelId]);

  const fetchInputImages = useCallback(
    async (options = {}) => {
      if (!token) return;
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
    },
    [token, inputImagePage, inputImagePageSize]
  );

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    fetchInputImages();
  }, [fetchInputImages]);

  useEffect(() => {
    const handler = () => {
      fetchInputImages({ page: 1, pageSize: inputImagePageSize });
      setInputImagePage(1);
    };
    window.addEventListener('input-images:refresh', handler);
    return () => window.removeEventListener('input-images:refresh', handler);
  }, [fetchInputImages, inputImagePageSize]);

  const handlePersonChange = useCallback(
    (personName) => {
      setSelectedPerson(personName);
      const group = modelGroups.find((item) => item.personName === personName);
      setSelectedModelId(getDefaultVersionId(group?.versions));
    },
    [modelGroups]
  );

  const updateImageItem = useCallback((id, updates) => {
    setTargetImages((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  }, []);

  const addFiles = useCallback((files) => {
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
  }, []);

  const removeImage = useCallback((id) => {
    setTargetImages((prev) => {
      const current = prev.find((item) => item.id === id);
      if (current) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const clearImages = useCallback(() => {
    setTargetImages((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  }, []);

  const setVideoSelection = useCallback(
    (files) => {
      videoPreviewItems.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      if (videoResultUrl) {
        URL.revokeObjectURL(videoResultUrl);
        setVideoResultUrl('');
      }
      setVideoError('');
      setVideoProgress(0);
      const nextFiles = files
        ? (Array.isArray(files) ? files : Array.from(files instanceof FileList ? files : [files]))
            .filter(Boolean)
        : [];
      if (nextFiles.length === 0) {
        setVideoFiles([]);
        setVideoPreviewItems([]);
        return;
      }
      setVideoFiles(nextFiles);
      setVideoPreviewItems(
        nextFiles.map((file, index) => ({
          id: `${Date.now()}-${index}-${file.name}`,
          file,
          previewUrl: URL.createObjectURL(file),
        }))
      );
    },
    [videoPreviewItems, videoResultUrl]
  );

  const clearVideoInput = useCallback(() => {
    setVideoSelection(null);
    setVideoUrl('');
  }, [setVideoSelection]);

  const handleSwap = useCallback(async () => {
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
            `${apiBaseUrl}/swap?model_id=${selectedModelId}&image_id=${imageId}&enable_restore=${enableRestore ? '1' : '0'}&expression_strength=${expressionStrength}&swap_model=${swapModel}`,
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
  }, [selectedModelId, targetImages, token, enableRestore, expressionStrength, swapModel, updateImageItem, fetchInputImages]);

  const handleReInference = useCallback(async () => {
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
          expression_strength: expressionStrength,
          swap_model: swapModel,
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
  }, [selectedModelId, selectedInputImageIds, token, enableRestore, expressionStrength, swapModel, fetchInputImages]);

  const deleteInputImages = useCallback(
    async (ids) => {
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
    },
    [token, inputImageTotal, inputImagePageSize, inputImagePage, fetchInputImages]
  );

  const handleVideoSwap = useCallback(async () => {
    if (!selectedModelId) {
      alert('Please select a person/version first.');
      return;
    }
    if (videoFiles.length === 0 && !videoUrl) {
      alert('Please select target videos or paste a video URL first.');
      return;
    }

    setVideoBusy(true);
    setVideoError('');
    setVideoProgress(0);

    try {
      let filesToUpload = videoFiles;
      if (filesToUpload.length === 0 && videoUrl) {
        const remoteFile = await buildVideoFileFromUrl(videoUrl.trim());
        filesToUpload = [remoteFile];
        setVideoSelection(remoteFile);
      }

      const formData = new FormData();
      filesToUpload.forEach((file) => formData.append('files', file));
      formData.append('model_id', selectedModelId);
      formData.append('enable_restore', enableRestore ? '1' : '0');
      formData.append('expression_strength', String(expressionStrength));
      formData.append('swap_model', swapModel);

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
      const total = Number(payload?.total) || (Array.isArray(payload?.items) ? payload.items.length : 1);
      setVideoProgress(100);
      window.dispatchEvent(new CustomEvent('gallery:open', { detail: { type: 'videos' } }));
      alert(`Queued ${total} video${total === 1 ? '' : 's'} for processing. Check the gallery for status.`);
    } catch (error) {
      setVideoError(error.message || 'Unknown error');
    } finally {
      setVideoBusy(false);
    }
  }, [selectedModelId, videoFiles, videoUrl, enableRestore, expressionStrength, swapModel, token, setVideoSelection]);

  const processedCount = useMemo(
    () => targetImages.filter((item) => item.status === 'done').length,
    [targetImages]
  );
  const failedCount = useMemo(
    () => targetImages.filter((item) => item.status === 'failed').length,
    [targetImages]
  );
  const pendingCount = useMemo(
    () =>
      targetImages.filter(
        (item) => item.status === 'idle' || item.status === 'uploading' || item.status === 'swapping'
      ).length,
    [targetImages]
  );
  const controlsDisabled = useMemo(
    () => busy || videoBusy || reInferenceBusy || inputDeleteBusy,
    [busy, videoBusy, reInferenceBusy, inputDeleteBusy]
  );
  const reInferencePercent = useMemo(
    () =>
      reInferenceProgress.total > 0
        ? Math.round((reInferenceProgress.completed / reInferenceProgress.total) * 100)
        : 0,
    [reInferenceProgress]
  );

  const value = useMemo(
    () => ({
      models,
      modelGroups,
      selectedGroup,
      selectedPerson,
      selectedModelId,
      enableRestore,
      setEnableRestore,
      expressionRestoreEnabled,
      expressionStrength,
      setExpressionStrength,
      swapModel,
      setSwapModel,
      handlePersonChange,
      setSelectedModelId,
      targetImages,
      addFiles,
      removeImage,
      clearImages,
      handleSwap,
      busy,
      processedCount,
      failedCount,
      pendingCount,
      videoFile: videoFiles[0] || null,
      videoFiles,
      videoPreviewUrl: videoPreviewItems[0]?.previewUrl || '',
      videoPreviewItems,
      videoResultUrl,
      videoUrl,
      setVideoUrl,
      videoBusy,
      videoError,
      videoProgress,
      setVideoSelection,
      clearVideoInput,
      handleVideoSwap,
      inputImages,
      selectedInputImageIds,
      setSelectedInputImageIds,
      inputImageTotal,
      inputImagePage,
      setInputImagePage,
      inputImagePageSize,
      setInputImagePageSize,
      inputGalleryBusy,
      reInferenceBusy,
      inputDeleteBusy,
      reInferenceProgress,
      reInferencePercent,
      inputImageJobStatus,
      handleReInference,
      deleteInputImages,
      controlsDisabled,
      swapTab,
      setSwapTab,
    }),
    [
      models,
      modelGroups,
      selectedGroup,
      selectedPerson,
      selectedModelId,
      enableRestore,
      expressionRestoreEnabled,
      expressionStrength,
      swapModel,
      handlePersonChange,
      targetImages,
      addFiles,
      removeImage,
      clearImages,
      handleSwap,
      busy,
      processedCount,
      failedCount,
      pendingCount,
      videoFiles,
      videoPreviewItems,
      videoResultUrl,
      videoUrl,
      videoBusy,
      videoError,
      videoProgress,
      setVideoSelection,
      clearVideoInput,
      handleVideoSwap,
      inputImages,
      selectedInputImageIds,
      inputImageTotal,
      inputImagePage,
      inputImagePageSize,
      inputGalleryBusy,
      reInferenceBusy,
      inputDeleteBusy,
      reInferenceProgress,
      reInferencePercent,
      inputImageJobStatus,
      handleReInference,
      deleteInputImages,
      controlsDisabled,
      swapTab,
    ]
  );

  return <SwapContext.Provider value={value}>{children}</SwapContext.Provider>;
}

export function useSwap() {
  const ctx = useContext(SwapContext);
  if (!ctx) {
    throw new Error('useSwap must be used within SwapProvider');
  }
  return ctx;
}

export { PAGE_SIZE_OPTIONS };
