import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Badge,
  Button,
  Checkbox,
  Divider,
  Heading,
  HStack,
  IconButton,
  Image,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalOverlay,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
} from '@chakra-ui/react';
import {
  AddIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  DeleteIcon,
  LinkIcon,
  MinusIcon,
  RepeatIcon,
} from '@chakra-ui/icons';
import { apiBaseUrl } from './utils';
import { useApp } from './contexts/AppContext.jsx';

const IMAGE_PAGE_SIZE = 12;
const VIDEO_PAGE_SIZE = 8;
const PAGE_SIZE_OPTIONS = [8, 12, 24, 48];

export default function ImageGallery({ isActive = false }) {
  const { token } = useApp();
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
  const [forcedPreview, setForcedPreview] = useState(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [videoSources, setVideoSources] = useState({});
  const [loadingVideoIds, setLoadingVideoIds] = useState([]);
  const [statusLoadingIds, setStatusLoadingIds] = useState([]);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [autoSelectPosition, setAutoSelectPosition] = useState(null); // 'first', 'last', or null
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
        setIsPreviewOpen(false);
      }
      const nextTotal = Math.max(0, imageTotal - deletedCount);
      const totalPages = Math.max(1, Math.ceil(nextTotal / imagePageSize));
      const nextPage = Math.min(imagePage, totalPages);
      if (nextPage !== imagePage) {
        setImagePage(nextPage); // This will trigger fetchGallery via useEffect
        setAutoSelectPosition('first'); // When page changes due to deletion, select first image of new page
      } else {
        // If page didn't change, but images were deleted, we need to re-fetch to update the list
        // and potentially trigger auto-selection if previewId became null.
        fetchGallery(); // Explicitly re-fetch for the current page
      }
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
        setIsPreviewOpen(false);
      }

      const nextTotal = Math.max(0, imageTotal - deletedGenerated);
      const totalPages = Math.max(1, Math.ceil(nextTotal / imagePageSize));
      const nextPage = Math.min(imagePage, totalPages);
      if (nextPage !== imagePage) {
        setImagePage(nextPage); // This will trigger fetchGallery via useEffect
        setAutoSelectPosition('first'); // When page changes due to deletion, select first image of new page
      } else {
        // If page didn't change, but images were deleted, we need to re-fetch to update the list
        // and potentially trigger auto-selection if previewId became null.
        fetchGallery(); // Explicitly re-fetch for the current page
      }
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
  const activePreview = forcedPreview || preview;
  const isForcedPreview = Boolean(forcedPreview && (!preview || forcedPreview.id !== preview.id));

  const showPrevious = () => {
    if (images.length === 0 || previewIndex < 0) return;
    if (previewIndex === 0) {
      if (imagePage > 1) {
        setImagePage((prev) => prev - 1);
        setAutoSelectPosition('last');
      }
    } else {
      setPreviewId(images[previewIndex - 1].id);
    }
    setZoomLevel(1);
  };

  const showNext = () => {
    if (images.length === 0 || previewIndex < 0) return;
    if (previewIndex === images.length - 1) {
      const totalPages = Math.max(1, Math.ceil(imageTotal / imagePageSize));
      if (imagePage < totalPages) {
        setImagePage((prev) => prev + 1);
        setAutoSelectPosition('first');
      }
    } else {
      setPreviewId(images[previewIndex + 1].id);
    }
    setZoomLevel(1);
  };

  const openPreview = (imageId) => {
    if (!imageId) return;
    setPreviewId(imageId);
    setZoomLevel(1);
    setIsPreviewOpen(true);
  };

  const videoStatusLabel = (video) => {
    const status = video.status || (video.processing ? 'processing' : video.has_content ? 'done' : 'failed');
    if (status === 'queued') return 'Queued';
    if (status === 'processing') return 'Processing';
    if (status === 'done') return 'Done';
    if (status === 'failed') return 'Failed';
    return status;
  };

  const videoStatusColor = (video) => {
    const status = video.status || (video.processing ? 'processing' : video.has_content ? 'done' : 'failed');
    if (status === 'done') return 'green';
    if (status === 'failed') return 'red';
    if (status === 'queued' || status === 'processing') return 'yellow';
    return 'gray';
  };

  useEffect(() => {
    if (token && isActive) {
      fetchGallery();
    }
  }, [token, isActive, imagePage, videoPage, imagePageSize, videoPageSize]);

  useEffect(() => {
    if (!isPreviewOpen) return undefined;
    const onKeyDown = (event) => {
      if (!isForcedPreview && event.key === 'ArrowLeft') showPrevious();
      else if (!isForcedPreview && event.key === 'ArrowRight') showNext();
      else if (event.key === 'Escape') {
        setPreviewId(null);
        setForcedPreview(null);
        setIsPreviewOpen(false);
        setZoomLevel(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPreviewOpen, isForcedPreview, previewIndex, images]);

  useEffect(() => {
    const handler = async (event) => {
      if (event?.detail?.type === 'videos') {
        setActiveType('videos');
        setVideoPage(1);
        await fetchGallery({ videoPage: 1 });
        return;
      }
      const imageId = Number(event?.detail?.imageId);
      if (!imageId) return;
      try {
        const response = await fetch(`${apiBaseUrl}/images/generated/${imageId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          return;
        }
        const payload = await response.json();
        if (payload?.id) {
          setForcedPreview(payload);
          setPreviewId(payload.id);
          setIsPreviewOpen(true);
          setZoomLevel(1);
        }
      } catch (_err) {
        // noop
      }
    };
    window.addEventListener('gallery:open', handler);
    return () => window.removeEventListener('gallery:open', handler);
  }, [token]);

  // Effect for auto-selection after page change or deletion
  useEffect(() => {
    if (images.length === 0) return;

    if (autoSelectPosition) {
      if (autoSelectPosition === 'first') {
        setPreviewId(images[0].id);
      } else if (autoSelectPosition === 'last') {
        setPreviewId(images[images.length - 1].id);
      }
      setAutoSelectPosition(null); // Reset the flag after selection
    } else if (isPreviewOpen && !forcedPreview) {
      // If modal is open, ensure previewId is valid for the current page
      const exists = images.some((img) => img.id === previewId);
      if (!exists) {
        setPreviewId(images[0].id);
      }
    }
  }, [images, autoSelectPosition, previewId, isPreviewOpen, forcedPreview]);

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

  const tabIndex = activeType === 'images' ? 0 : 1;

  return (
    <Box
      bg="rgba(17, 22, 34, 0.9)"
      border="1px solid"
      borderColor="#1d2434"
      borderRadius="20px"
      p={{ base: 4, md: 6 }}
      boxShadow="0 10px 30px rgba(0,0,0,0.35)"
    >
      <Stack spacing={5}>
        <HStack justify="space-between" align="center" flexWrap="wrap">
          <Box>
            <Heading size="md">Generated Media</Heading>
            <Text color="gray.500">Review outputs and manage your gallery.</Text>
          </Box>
          <Button onClick={() => fetchGallery()} isDisabled={busy || deleting} variant="outline">
            Refresh
          </Button>
        </HStack>

        <Tabs index={tabIndex} onChange={(index) => setActiveType(index === 0 ? 'images' : 'videos')}>
          <TabList>
            <Tab>Images</Tab>
            <Tab>Videos</Tab>
          </TabList>
          <TabPanels>
            <TabPanel px={0}>
              <HStack spacing={3} flexWrap="wrap">
                <Button
                  variant="outline"
                  onClick={() => setSelectedImageIds(images.map((item) => item.id))}
                  isDisabled={images.length === 0 || busy || deleting}
                >
                  Select all
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setSelectedImageIds([])}
                  isDisabled={selectedImageIds.length === 0 || busy || deleting}
                >
                  Clear
                </Button>
                <Button
                  variant="outline"
                  colorScheme="red"
                  onClick={() => deleteImages(selectedImageIds)}
                  isDisabled={selectedImageIds.length === 0 || busy || deleting}
                >
                  Delete selected ({selectedImageIds.length})
                </Button>
              </HStack>

              <Divider my={4} />

              {busy || deleting ? (
                <Text color="gray.500">Loading...</Text>
              ) : images.length === 0 ? (
                <Text color="gray.500">No images generated yet.</Text>
              ) : (
                <>
                  <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} spacing={4}>
                    {images.map((item) => (
                      <Box
                        key={item.id}
                        bg="#0f141f"
                        border="1px solid"
                        borderColor="#1e2636"
                        borderRadius="16px"
                        overflow="hidden"
                      >
                        <Image
                          src={`data:image/jpeg;base64,${item.data}`}
                          alt={item.filename || `Generated #${item.id}`}
                          w="100%"
                          h="200px"
                          objectFit="cover"
                          cursor="pointer"
                          onClick={() => openPreview(item.id)}
                        />
                        <Stack spacing={2} p={3}>
                          <HStack justify="space-between">
                            <Text fontSize="sm" noOfLines={1}>
                              #{item.id} {item.filename}
                            </Text>
                            <Checkbox
                              isChecked={selectedImageIds.includes(item.id)}
                              onChange={() =>
                                setSelectedImageIds((prev) =>
                                  prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
                                )
                              }
                            />
                          </HStack>
                          <Text fontSize="sm" color="gray.500">
                            Model: {modelLabel(item.face_model_id)}
                          </Text>
                          <Text fontSize="sm" color="gray.500">
                            Restore: {item.restore ? 'Yes' : 'No'}
                          </Text>
                          <HStack spacing={2}>
                            <Button size="sm" variant="outline" onClick={() => openPreview(item.id)}>
                              Preview
                            </Button>
                            <Button size="sm" variant="outline" colorScheme="red" onClick={() => deleteImages([item.id])}>
                              Delete
                            </Button>
                          </HStack>
                        </Stack>
                      </Box>
                    ))}
                  </SimpleGrid>

                  <HStack justify="space-between" align="center" mt={4} flexWrap="wrap">
                    <Text color="gray.500" fontSize="sm">
                      Page {imagePage} / {Math.max(1, Math.ceil(imageTotal / imagePageSize))} ({imageTotal} total)
                    </Text>
                    <HStack spacing={2} flexWrap="wrap">
                      <Select
                        value={imagePageSize}
                        onChange={(event) => {
                          setImagePageSize(Number(event.target.value));
                          setImagePage(1);
                        }}
                        isDisabled={busy || deleting}
                        maxW="120px"
                      >
                        {PAGE_SIZE_OPTIONS.map((size) => (
                          <option key={size} value={size}>
                            {size} / page
                          </option>
                        ))}
                      </Select>
                      <Button
                        variant="outline"
                        onClick={() => setImagePage((prev) => Math.max(1, prev - 1))}
                        isDisabled={busy || deleting || imagePage <= 1}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setImagePage((prev) => prev + 1)}
                        isDisabled={busy || deleting || imagePage >= Math.max(1, Math.ceil(imageTotal / imagePageSize))}
                      >
                        Next
                      </Button>
                    </HStack>
                  </HStack>
                </>
              )}
            </TabPanel>
            <TabPanel px={0}>
              <HStack spacing={3} flexWrap="wrap">
                <Button
                  variant="outline"
                  onClick={() => setSelectedVideoIds(videos.map((item) => item.id))}
                  isDisabled={videos.length === 0 || busy || deleting}
                >
                  Select all
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setSelectedVideoIds([])}
                  isDisabled={selectedVideoIds.length === 0 || busy || deleting}
                >
                  Clear
                </Button>
                <Button
                  variant="outline"
                  colorScheme="red"
                  onClick={() => deleteVideos(selectedVideoIds)}
                  isDisabled={selectedVideoIds.length === 0 || busy || deleting}
                >
                  Delete selected ({selectedVideoIds.length})
                </Button>
              </HStack>

              <Divider my={4} />

              {busy || deleting ? (
                <Text color="gray.500">Loading...</Text>
              ) : videos.length === 0 ? (
                <Text color="gray.500">No videos generated yet.</Text>
              ) : (
                <>
                  <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} spacing={4}>
                    {videos.map((video) => (
                      <Box
                        key={video.id}
                        bg="#0f141f"
                        border="1px solid"
                        borderColor="#1e2636"
                        borderRadius="16px"
                        overflow="hidden"
                      >
                        <Stack spacing={2} p={3}>
                          <HStack justify="space-between">
                            <Text fontSize="sm" noOfLines={1}>
                              #{video.id} {video.filename}
                            </Text>
                            <Badge colorScheme={videoStatusColor(video)}>{videoStatusLabel(video)}</Badge>
                            <Checkbox
                              isChecked={selectedVideoIds.includes(video.id)}
                              onChange={() =>
                                setSelectedVideoIds((prev) =>
                                  prev.includes(video.id) ? prev.filter((id) => id !== video.id) : [...prev, video.id]
                                )
                              }
                            />
                          </HStack>
                          {videoSources[video.id] ? (
                            <Box as="video" src={videoSources[video.id]} controls w="100%" h="200px" />
                          ) : video.status === 'queued' ? (
                            <Text color="gray.500" fontSize="sm">
                              Waiting for the background worker.
                            </Text>
                          ) : video.processing ? (
                            <Box>
                              <Progress value={Math.min(100, Number(video.progress_percent) || 0)} />
                              <Text color="gray.500" fontSize="sm" mt={2}>
                                Processing{Number.isFinite(video.progress_percent) ? ` (${video.progress_percent}%)` : ''}.
                              </Text>
                            </Box>
                          ) : video.status === 'failed' ? (
                            <Text color="red.300" fontSize="sm">
                              {video.error || 'Video processing failed.'}
                            </Text>
                          ) : !video.has_content ? (
                            <Text color="gray.500" fontSize="sm">
                              No playable video data yet.
                            </Text>
                          ) : (
                            <Text color="gray.500" fontSize="sm">
                              Ready to load.
                            </Text>
                          )}
                          <Text fontSize="sm" color="gray.500">
                            Model: {modelLabel(video.face_model_id)}
                          </Text>
                          <HStack spacing={2}>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => refreshVideoStatus(video)}
                              isDisabled={statusLoadingIds.includes(video.id) || busy || deleting}
                            >
                              {statusLoadingIds.includes(video.id) ? 'Refreshing...' : 'Refresh Status'}
                            </Button>
                            {!video.processing && video.has_content && !videoSources[video.id] && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => loadVideoSource(video)}
                                isDisabled={loadingVideoIds.includes(video.id)}
                              >
                                {loadingVideoIds.includes(video.id) ? 'Loading...' : 'Load Video'}
                              </Button>
                            )}
                          </HStack>
                          <Button
                            size="sm"
                            variant="outline"
                            colorScheme="red"
                            onClick={() => deleteVideos([video.id])}
                            isDisabled={busy || deleting}
                          >
                            Delete
                          </Button>
                        </Stack>
                      </Box>
                    ))}
                  </SimpleGrid>

                  <HStack justify="space-between" align="center" mt={4} flexWrap="wrap">
                    <Text color="gray.500" fontSize="sm">
                      Page {videoPage} / {Math.max(1, Math.ceil(videoTotal / videoPageSize))} ({videoTotal} total)
                    </Text>
                    <HStack spacing={2} flexWrap="wrap">
                      <Select
                        value={videoPageSize}
                        onChange={(event) => {
                          setVideoPageSize(Number(event.target.value));
                          setVideoPage(1);
                        }}
                        isDisabled={busy || deleting}
                        maxW="120px"
                      >
                        {PAGE_SIZE_OPTIONS.map((size) => (
                          <option key={size} value={size}>
                            {size} / page
                          </option>
                        ))}
                      </Select>
                      <Button
                        variant="outline"
                        onClick={() => setVideoPage((prev) => Math.max(1, prev - 1))}
                        isDisabled={busy || deleting || videoPage <= 1}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setVideoPage((prev) => prev + 1)}
                        isDisabled={busy || deleting || videoPage >= Math.max(1, Math.ceil(videoTotal / videoPageSize))}
                      >
                        Next
                      </Button>
                    </HStack>
                  </HStack>
                </>
              )}
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Stack>

      <Modal
        isOpen={isPreviewOpen}
        onClose={() => {
          setPreviewId(null);
          setForcedPreview(null);
          setIsPreviewOpen(false);
          setZoomLevel(1);
        }}
        size="6xl"
      >
        <ModalOverlay />
        <ModalContent bg="#0b0f1a" marginY={6}>
          <ModalCloseButton />
          <ModalBody py={6}>
            {activePreview && !busy && !deleting ? (
              <Stack spacing={2} align="center">
                <Box h="70vh" alignContent="center">
                  <Box
                    as="img"
                    src={`data:image/jpeg;base64,${activePreview.data}`}
                    alt="Preview"
                    maxH="70vh"
                    style={{ transform: `scale(${zoomLevel})`, transition: 'transform 120ms ease-out' }}
                  />
                </Box>
                <HStack spacing={1}>
                  {!isForcedPreview && (
                    <IconButton
                      variant="outline"
                      aria-label="Previous image"
                      icon={<ArrowLeftIcon />}
                      onClick={showPrevious}
                      isDisabled={imagePage <= 1 && previewIndex === 0}
                    />
                  )}
                  {!isForcedPreview && (
                    <Text color="gray.500" align="center">
                      {previewIndex + 1} / {images.length}
                    </Text>
                  )}
                  {!isForcedPreview && (
                    <IconButton
                      variant="outline"
                      aria-label="Next image"
                      icon={<ArrowRightIcon />}
                      onClick={showNext}
                      isDisabled={
                        imagePage >= Math.max(1, Math.ceil(imageTotal / imagePageSize)) &&
                        previewIndex === images.length - 1
                      }
                    />
                  )}
                  <IconButton
                    variant="outline"
                    aria-label="Zoom out"
                    icon={<MinusIcon />}
                    onClick={handleZoomOut}
                  />
                  <Text color="gray.500"
                    fontSize="sm"
                    minW="20px"
                    textAlign="center"
                  >
                    {Math.round(zoomLevel * 100)}%
                  </Text>
                  <IconButton
                    variant="outline"
                    aria-label="Zoom in"
                    icon={<AddIcon />}
                    onClick={handleZoomIn}
                  />
                </HStack>
                <HStack spacing={1}>
                  <IconButton
                    variant="outline"
                    colorScheme="red"
                    aria-label="Delete image"
                    icon={<DeleteIcon />}
                    onClick={() => deleteImages([activePreview.id])}
                    isDisabled={busy || deleting}
                  />
                  <IconButton
                    variant="outline"
                    colorScheme="red"
                    aria-label="Delete source image"
                    icon={<LinkIcon color="red.500" />}
                    onClick={() => deleteSourceImage(activePreview.input_image_id)}
                    isDisabled={busy || deleting || !activePreview.input_image_id}
                  />
                </HStack>
              </Stack>
            ) : (
              <Box display="flex" justifyContent="center" alignItems="center" minH="400px">
                <Text color="gray.500">{busy || deleting ? 'Loading image...' : 'No images found'}</Text>
              </Box>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </Box>
  );
}
