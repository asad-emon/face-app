import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Box,
  Button,
  Divider,
  Heading,
  HStack,
  IconButton,
  Image,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalOverlay,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
} from '@chakra-ui/react';
import {
  AddIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  MinusIcon,
  RepeatIcon,
} from '@chakra-ui/icons';
import { apiBaseUrl } from './utils';
import { useApp } from './contexts/AppContext.jsx';

const CIVITAI_IMAGES_ENDPOINT = 'https://civitai.com/api/v1/images';
const PAGE_SIZE_OPTIONS = [8, 12, 24, 48, 96, 120];
const SORT_OPTIONS = ['Newest', 'Most Reactions', 'Most Comments'];
const PERIOD_OPTIONS = ['AllTime', 'Year', 'Month', 'Week', 'Day'];
const NSFW_OPTIONS = ['', 'None', 'Soft', 'Mature', 'X'];

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function CivitaiGallery({ isActive = false, onUseInputImage }) {
  const { token: appToken } = useApp();
  const [token, setToken] = useState(localStorage.getItem('civitai_token') || '');
  const [tokenInput, setTokenInput] = useState(token);
  const [items, setItems] = useState([]);
  const [metadata, setMetadata] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previewId, setPreviewId] = useState(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [autoSelectPosition, setAutoSelectPosition] = useState(null); // 'first', 'last', or null
  const [zoomLevel, setZoomLevel] = useState(1);
  const [inferenceBusy, setInferenceBusy] = useState(false);
  const [inferenceMessage, setInferenceMessage] = useState('');
  const [swapJobId, setSwapJobId] = useState(null);
  const [swapJobStatus, setSwapJobStatus] = useState('');
  const [swapJobError, setSwapJobError] = useState('');
  const [models, setModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState(
    localStorage.getItem('civitai_inference_model_id') || ''
  );
  const [modelsBusy, setModelsBusy] = useState(false);
  const [favoriteModels, setFavoriteModels] = useState([]);
  const [favoriteModelsBusy, setFavoriteModelsBusy] = useState(false);
  const [favoriteModelsError, setFavoriteModelsError] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(() => {
    const stored = localStorage.getItem('civitai_limit');
    return toNumber(stored, 24);
  });
  const [username, setUsername] = useState(localStorage.getItem('civitai_username') || '');
  const [nsfw, setNsfw] = useState(localStorage.getItem('civitai_nsfw') || '');
  const [sort, setSort] = useState(localStorage.getItem('civitai_sort') || 'Newest');
  const [period, setPeriod] = useState(localStorage.getItem('civitai_period') || 'AllTime');
  const [modelId, setModelId] = useState(localStorage.getItem('civitai_favorite_model_id') || '');
  const [modelVersionId, setModelVersionId] = useState('');
  const [postId, setPostId] = useState('');
  const [followedCreatorsText, setFollowedCreatorsText] = useState(
    localStorage.getItem('civitai_followed_creators') || ''
  );
  const [selectedFollowedCreator, setSelectedFollowedCreator] = useState(
    localStorage.getItem('civitai_followed_creator') || ''
  );
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
    if (postId.trim()) search.set('postId', postId.trim());
    return search;
  }, [limit, page, username, nsfw, sort, period, modelId, modelVersionId, postId]);

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
      setSelectedModelId((prev) => {
        if (prev && incoming.some((item) => String(item.id) === prev)) {
          return prev;
        }
        const next = active ? String(active.id) : '';
        localStorage.setItem('civitai_inference_model_id', next);
        return next;
      });
    } catch (err) {
      console.error('Failed to fetch models:', err);
      setModels([]);
      setSelectedModelId('');
    } finally {
      setModelsBusy(false);
    }
  };

  const fetchFavoriteModels = async () => {
    if (!token) {
      setFavoriteModels([]);
      setFavoriteModelsError('');
      return;
    }
    setFavoriteModelsBusy(true);
    setFavoriteModelsError('');
    try {
      const allModels = [];
      let page = 1;
      let totalPages = 1;
      const limit = 100;
      const maxPages = 10;

      while (page <= totalPages && page <= maxPages) {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        params.set('page', String(page));
        params.set('favorites', 'true');
        params.set('nsfw', 'true');
        const response = await fetch(`${apiBaseUrl}/civitai/models?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          let detail = `Failed to load favorite models (${response.status})`;
          try {
            const data = await response.json();
            detail = data?.message || data?.detail || detail;
          } catch (_err) {
            // noop
          }
          throw new Error(detail);
        }
        const data = await response.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        allModels.push(...items);
        totalPages = toNumber(data?.metadata?.totalPages, page);
        if (items.length === 0) break;
        page += 1;
      }

      setFavoriteModels(allModels);
    } catch (err) {
      console.error('Failed to fetch favorite models:', err);
      setFavoriteModels([]);
      setFavoriteModelsError(err?.message || 'Failed to load favorite models.');
    } finally {
      setFavoriteModelsBusy(false);
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
    if (isActive) {
      fetchFavoriteModels();
    }
  }, [isActive, token]);

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
  const favoriteModelLabel = (model) => {
    if (!model) return 'Unknown model';
    const name = (model.name || '').trim() || 'Untitled model';
    const creator = model.creator?.username ? `by ${model.creator.username}` : '';
    return [name, `#${model.id}`, creator].filter(Boolean).join(' ');
  };

  const followedCreators = useMemo(() => {
    const items = followedCreatorsText
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return Array.from(new Set(items));
  }, [followedCreatorsText]);

  const paginationControls = (
    <HStack justify="space-between" align="center" flexWrap="wrap">
      <Text color="gray.500">
        Page {page}
        {totalPages ? ` / ${totalPages}` : ''}
        {metadata?.totalItems ? ` (${metadata.totalItems} total)` : ''}
      </Text>
      <HStack spacing={2}>
        <Button variant="outline" onClick={() => setPage((prev) => Math.max(1, prev - 1))} isDisabled={busy || page <= 1}>
          Previous
        </Button>
        <Button
          variant="outline"
          onClick={() => setPage((prev) => prev + 1)}
          isDisabled={busy || (totalPages ? page >= totalPages : false)}
        >
          Next
        </Button>
      </HStack>
    </HStack>
  );

  const showPrevious = () => {
    if (items.length === 0 || previewIndex < 0) return;
    if (previewIndex === 0) {
      if (page > 1) {
        setPage((prev) => prev - 1);
        setAutoSelectPosition('last');
      }
    } else {
      setPreviewId(items[previewIndex - 1].id);
    }
    setZoomLevel(1);
  };

  const showNext = () => {
    if (items.length === 0 || previewIndex < 0) return;
    if (previewIndex === items.length - 1) {
      const pages = toNumber(metadata?.totalPages, 1);
      if (page < pages) {
        setPage((prev) => prev + 1);
        setAutoSelectPosition('first');
      }
    } else {
      setPreviewId(items[previewIndex + 1].id);
    }
    setZoomLevel(1);
  };

  useEffect(() => {
    if (!isPreviewOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'ArrowLeft') showPrevious();
      else if (event.key === 'ArrowRight') showNext();
      else if (event.key === 'Escape') {
        setPreviewId(null);
        setIsPreviewOpen(false);
        setZoomLevel(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPreviewOpen, previewIndex, items]);

  useEffect(() => {
    if (items.length === 0) return;

    if (autoSelectPosition) {
      if (autoSelectPosition === 'first') {
        setPreviewId(items[0].id);
      } else if (autoSelectPosition === 'last') {
        setPreviewId(items[items.length - 1].id);
      }
      setAutoSelectPosition(null);
    } else if (isPreviewOpen) {
      const exists = items.some((item) => item.id === previewId);
      if (!exists) {
        setPreviewId(items[0].id);
      }
    }
  }, [items, autoSelectPosition, isPreviewOpen, previewId]);

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
    } catch (err) {
      setInferenceMessage(err?.message || 'Failed to use image for inference.');
    } finally {
      setInferenceBusy(false);
    }
  };

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
            <Heading size="md">Civitai Images</Heading>
            <Text color="gray.500">Browse and pull references for inference.</Text>
          </Box>
          <Button onClick={fetchImages} isDisabled={busy} variant="outline">
            Refresh
          </Button>
        </HStack>

        <Box bg="#0f141f" border="1px solid" borderColor="#1e2636" borderRadius="16px" p={4}>
          <Stack spacing={3}>
            <HStack spacing={3} align="flex-end" flexWrap="wrap">
              <Box flex="1" minW="220px">
                <Text fontSize="sm" color="gray.500" mb={1}>
                  Civitai API token
                </Text>
                <Input
                  type="password"
                  placeholder="Paste your Civitai API key"
                  value={tokenInput}
                  onChange={(event) => setTokenInput(event.target.value)}
                />
              </Box>
              <HStack spacing={2}>
                <Button
                  onClick={() => {
                    localStorage.setItem('civitai_token', tokenInput.trim());
                    setToken(tokenInput.trim());
                  }}
                >
                  Save Token
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    localStorage.removeItem('civitai_token');
                    setToken('');
                    setTokenInput('');
                  }}
                  isDisabled={!token && !tokenInput}
                >
                  Clear
                </Button>
              </HStack>
            </HStack>
            <Text fontSize="sm" color="gray.500">
              Token is optional for public images, but required for content that needs login.
            </Text>
          </Stack>
        </Box>

        <Stack spacing={4}>
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
            <Box>
              <Text fontSize="sm" color="gray.500" mb={1}>
                Username
              </Text>
              <Input
                placeholder="Filter by username"
                value={username}
                onChange={(event) => {
                  localStorage.setItem('civitai_username', event.target.value);
                  localStorage.setItem('civitai_followed_creator', '');
                  setSelectedFollowedCreator('');
                  setPage(1);
                  setUsername(event.target.value);
                }}
              />
            </Box>
            <Box>
              <Text fontSize="sm" color="gray.500" mb={1}>
                Favorite models
              </Text>
            {favoriteModelsBusy ? (
              <Text color="gray.500">Loading favorites...</Text>
            ) : (
                <Select
                  value={modelId}
                  onChange={(event) => {
                    localStorage.setItem('civitai_favorite_model_id', event.target.value);
                    setPage(1);
                    setModelId(event.target.value);
                  }}
                  isDisabled={!token}
                >
                  <option value="">All models</option>
                  {favoriteModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {favoriteModelLabel(model)}
                    </option>
                  ))}
                </Select>
              )}
              {!token && (
                <Text fontSize="xs" color="gray.500" mt={1}>
                  Add a Civitai token to load favorites.
                </Text>
              )}
              {favoriteModelsError && (
                <Text fontSize="xs" color="red.300" mt={1}>
                  {favoriteModelsError}
                </Text>
              )}
            </Box>
          </SimpleGrid>

          <Accordion allowToggle>
            <AccordionItem border="1px solid" borderColor="#1e2636" borderRadius="12px">
              <AccordionButton _hover={{ bg: '#0f141f' }}>
                <Box flex="1" textAlign="left" color="gray.300">
                  Search options
                </Box>
                <AccordionIcon />
              </AccordionButton>
              <AccordionPanel pb={4}>
                <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
                  <Box>
                    <Text fontSize="sm" color="gray.500" mb={1}>
                      Followed creators
                    </Text>
                    <Select
                      value={selectedFollowedCreator}
                      onChange={(event) => {
                        const next = event.target.value;
                        localStorage.setItem('civitai_followed_creator', next);
                        localStorage.setItem('civitai_username', next);
                        setSelectedFollowedCreator(next);
                        setUsername(next);
                        setPage(1);
                      }}
                      isDisabled={followedCreators.length === 0}
                    >
                      <option value="">All creators</option>
                      {followedCreators.map((creator) => (
                        <option key={creator} value={creator}>
                          {creator}
                        </option>
                      ))}
                    </Select>
                    {followedCreators.length === 0 && (
                      <Text fontSize="xs" color="gray.500" mt={1}>
                        Add usernames below to enable this filter.
                      </Text>
                    )}
                  </Box>
                  <Box>
                    <Text fontSize="sm" color="gray.500" mb={1}>
                      Followed list (comma-separated)
                    </Text>
                    <Textarea
                      placeholder="creator1, creator2, creator3"
                      value={followedCreatorsText}
                      onChange={(event) => {
                        const next = event.target.value;
                        localStorage.setItem('civitai_followed_creators', next);
                        setFollowedCreatorsText(next);
                      }}
                      minH="84px"
                    />
                  </Box>
                  <Box>
                    <Text fontSize="sm" color="gray.500" mb={1}>
                      Model Version ID
                    </Text>
                    <Input
                      placeholder="Filter by modelVersionId"
                      value={modelVersionId}
                      onChange={(event) => {
                        setPage(1);
                        setModelVersionId(event.target.value);
                      }}
                    />
                  </Box>
                  <Box>
                    <Text fontSize="sm" color="gray.500" mb={1}>
                      Post ID
                    </Text>
                    <Input
                      placeholder="Filter by postId"
                      value={postId}
                      onChange={(event) => {
                        setPage(1);
                        setPostId(event.target.value);
                      }}
                    />
                  </Box>
                  <Box>
                    <Text fontSize="sm" color="gray.500" mb={1}>
                      Model for inference
                    </Text>
                    {models.length === 0 ? (
                      <Text color="gray.500">{modelsBusy ? 'Loading models...' : 'No models available'}</Text>
                    ) : (
                      <Select
                        value={selectedModelId}
                        onChange={(event) => {
                          const next = event.target.value;
                          setSelectedModelId(next);
                          localStorage.setItem('civitai_inference_model_id', next);
                        }}
                      >
                        {models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {modelLabel(model)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Box>
                  <Box>
                    <Text fontSize="sm" color="gray.500" mb={1}>
                      NSFW
                    </Text>
                    <Select
                      value={nsfw}
                      onChange={(event) => {
                        localStorage.setItem('civitai_nsfw', event.target.value);
                        setPage(1);
                        setNsfw(event.target.value);
                      }}
                    >
                      {NSFW_OPTIONS.map((option) => (
                        <option key={option || 'all'} value={option}>
                          {option || 'All'}
                        </option>
                      ))}
                    </Select>
                  </Box>
                  <Box>
                    <Text fontSize="sm" color="gray.500" mb={1}>
                      Sort
                    </Text>
                    <Select
                      value={sort}
                      onChange={(event) => {
                        localStorage.setItem('civitai_sort', event.target.value);
                        setPage(1);
                        setSort(event.target.value);
                      }}
                    >
                      {SORT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  </Box>
                  <Box>
                    <Text fontSize="sm" color="gray.500" mb={1}>
                      Period
                    </Text>
                    <Select
                      value={period}
                      onChange={(event) => {
                        localStorage.setItem('civitai_period', event.target.value);
                        setPage(1);
                        setPeriod(event.target.value);
                      }}
                    >
                      {PERIOD_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  </Box>
                  <Box>
                    <Text fontSize="sm" color="gray.500" mb={1}>
                      Per page
                    </Text>
                    <Select
                      value={limit}
                      onChange={(event) => {
                        const nextLimit = toNumber(event.target.value, 24);
                        localStorage.setItem('civitai_limit', String(nextLimit));
                        setLimit(nextLimit);
                        setPage(1);
                      }}
                    >
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </Select>
                  </Box>
                </SimpleGrid>
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        </Stack>

        {paginationControls}

        {busy ? (
          <Text color="gray.500">Loading...</Text>
        ) : error ? (
          <Text color="red.300">Error: {error}</Text>
        ) : items.length === 0 ? (
          <Text color="gray.500">No images found for the current filters.</Text>
        ) : (
          <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} spacing={4}>
            {items.map((image) => (
              <Box
                key={image.id}
                bg="#0f141f"
                border="1px solid"
                borderColor="#1e2636"
                borderRadius="16px"
                overflow="hidden"
              >
                <Stack spacing={2} p={3}>
                  <HStack justify="space-between">
                    <Text fontSize="sm">#{image.id}</Text>
                    <Text fontSize="sm" color="gray.500">
                      {image.username || 'Unknown'}
                    </Text>
                  </HStack>
                </Stack>
                <Image
                  src={image.url}
                  alt={`Civitai ${image.id}`}
                  w="100%"
                  h="220px"
                  objectFit="cover"
                  loading="lazy"
                  cursor="pointer"
                  onClick={() => {
                    setPreviewId(image.id);
                    setIsPreviewOpen(true);
                    setZoomLevel(1);
                  }}
                />
                <Stack spacing={2} p={3}>
                  <Text fontSize="sm" color="gray.500">
                    NSFW: {image.nsfwLevel || (image.nsfw ? 'Yes' : 'No')}
                  </Text>
                  {image.stats && (
                    <Text fontSize="sm" color="gray.500">
                      Hearts {toNumber(image.stats.heartCount, 0)} | Likes {toNumber(image.stats.likeCount, 0)} |
                      Comments {toNumber(image.stats.commentCount, 0)}
                    </Text>
                  )}
                </Stack>
              </Box>
            ))}
          </SimpleGrid>
        )}

        {paginationControls}

        <Text fontSize="sm" color="gray.500">
          If you hit CORS errors in the browser, we can proxy the Civitai API through the backend.
        </Text>
      </Stack>

      <Modal
        isOpen={isPreviewOpen}
        onClose={() => {
          setPreviewId(null);
          setIsPreviewOpen(false);
          setZoomLevel(1);
        }}
        size="6xl"
      >
        <ModalOverlay />
        <ModalContent bg="#0b0f1a">
          <ModalCloseButton />
          <ModalBody py={6}>
            {preview ? (
              <Stack spacing={4} align="center">
                <Image
                  src={preview.url}
                  alt={`Civitai ${preview.id}`}
                  maxH="70vh"
                  style={{ transform: `scale(${zoomLevel})`, transition: 'transform 120ms ease-out' }}
                />
                <Text color="gray.500">
                  {previewIndex + 1} / {items.length}
                </Text>
                <HStack spacing={2}>
                  <IconButton
                    variant="outline"
                    aria-label="Previous image"
                    icon={<ArrowLeftIcon />}
                    onClick={showPrevious}
                    isDisabled={page <= 1 && previewIndex === 0}
                  />
                  <IconButton
                    variant="outline"
                    aria-label="Next image"
                    icon={<ArrowRightIcon />}
                    onClick={showNext}
                    isDisabled={
                      page >= toNumber(metadata?.totalPages, 1) &&
                      previewIndex === items.length - 1
                    }
                  />
                </HStack>
                <HStack spacing={2}>
                  <IconButton
                    variant="outline"
                    aria-label="Zoom out"
                    icon={<MinusIcon />}
                    onClick={handleZoomOut}
                  />
                  <Text color="gray.500" fontSize="sm" minW="80px" textAlign="center">
                    {Math.round(zoomLevel * 100)}%
                  </Text>
                  <IconButton
                    variant="outline"
                    aria-label="Zoom in"
                    icon={<AddIcon />}
                    onClick={handleZoomIn}
                  />
                  <IconButton
                    variant="outline"
                    aria-label="Reset zoom"
                    icon={<RepeatIcon />}
                    onClick={handleZoomReset}
                  />
                </HStack>
                <IconButton
                  variant="outline"
                  aria-label="Use for inference"
                  icon={<AddIcon />}
                  onClick={handleInference}
                  isDisabled={inferenceBusy}
                />
                {inferenceMessage && (
                  <Text color="gray.500" fontSize="sm">
                    {inferenceMessage}
                  </Text>
                )}
                {swapJobId && (
                  <Text color="gray.500" fontSize="sm">
                    Swap status: {swapJobStatus || 'queued'}
                    {swapJobError ? ` (${swapJobError})` : ''}
                  </Text>
                )}
              </Stack>
            ) : (
              <Box display="flex" justifyContent="center" alignItems="center" minH="400px">
                <Text color="gray.500">{busy ? 'Loading...' : 'No images found'}</Text>
              </Box>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </Box>
  );
}
