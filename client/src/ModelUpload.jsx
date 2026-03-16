import React, { useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControl,
  FormLabel,
  Heading,
  HStack,
  Input,
  NumberInput,
  NumberInputField,
  SimpleGrid,
  Stack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
} from '@chakra-ui/react';
import { apiBaseUrl } from './utils';
import { useApp } from './contexts/AppContext.jsx';

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

export default function ModelUpload() {
  const { token } = useApp();
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

  const tabIndex = mode === 'images' ? 0 : 1;

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
        <Box>
          <Heading size="md">Model Upload</Heading>
          <Text color="gray.500" mt={1}>
            Train from images or upload safetensors. Manage versions and active models below.
          </Text>
        </Box>

        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
          <FormControl>
            <FormLabel>Person Name</FormLabel>
            <Input
              placeholder="Person Name"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Version</FormLabel>
            <NumberInput min={1} value={versionInput} onChange={(value) => setVersionInput(value)}>
              <NumberInputField placeholder="Optional (auto-increments)" />
            </NumberInput>
          </FormControl>
        </SimpleGrid>

        {!canSubmitVersion && (
          <Text color="red.300" fontSize="sm">
            Version must be empty or a positive integer.
          </Text>
        )}

        <Checkbox isChecked={setActive} onChange={(e) => setSetActive(e.target.checked)}>
          Set this version as active for inference
        </Checkbox>

        <Tabs
          index={tabIndex}
          onChange={(index) => handleModeChange(index === 0 ? 'images' : 'safetensors')}
          variant="enclosed"
          colorScheme="brand"
        >
          <TabList>
            <Tab>Images (Generate)</Tab>
            <Tab>Safetensors (Upload)</Tab>
          </TabList>
          <TabPanels>
            <TabPanel px={0}>
              <Stack spacing={4}>
                <Input
                  type="file"
                  accept="image/*,.zip"
                  multiple
                  disabled={busy || parsing}
                  onChange={handleFileSelect}
                />

                <HStack justify="space-between" align="center" flexWrap="wrap">
                  <Text color="gray.500">
                    {parsing ? 'Processing zip...' : `${totalFiles} image${totalFiles === 1 ? '' : 's'} selected`}
                  </Text>
                  <Button onClick={handleGenerateModel} isDisabled={!canSubmitImages}>
                    {busy ? 'Generating...' : 'Generate Model'}
                  </Button>
                </HStack>

                {items.length > 0 && (
                  <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing={4}>
                    {items.map((item) => (
                      <Box
                        key={item.id}
                        bg="#0f141f"
                        border="1px solid"
                        borderColor="#1e2636"
                        borderRadius="16px"
                        overflow="hidden"
                      >
                        <Box as="img" src={item.url} alt={item.file.name} w="100%" h="160px" objectFit="cover" />
                        <Stack spacing={2} p={3}>
                          <Text fontSize="sm" noOfLines={1}>
                            {item.file.name}
                          </Text>
                          <Button size="sm" variant="outline" onClick={() => handleRemove(item.id)}>
                            Remove
                          </Button>
                        </Stack>
                      </Box>
                    ))}
                  </SimpleGrid>
                )}
              </Stack>
            </TabPanel>

            <TabPanel px={0}>
              <Stack spacing={4}>
                <Input
                  type="file"
                  accept=".safetensor,.safetensors"
                  disabled={busy}
                  onChange={handleSafetensorSelect}
                />
                {safetensorFile ? (
                  <HStack justify="space-between" align="center" flexWrap="wrap">
                    <Text color="gray.500">
                      {safetensorFile.name} · {formatBytes(safetensorFile.size)}
                    </Text>
                    <Button size="sm" variant="outline" colorScheme="red" onClick={handleSafetensorRemove}>
                      Remove
                    </Button>
                  </HStack>
                ) : (
                  <Text color="gray.500">No safetensors file selected.</Text>
                )}
                <Button onClick={handleUploadSafetensor} isDisabled={!canSubmitSafetensor}>
                  {busy ? 'Uploading...' : 'Upload Model'}
                </Button>
              </Stack>
            </TabPanel>
          </TabPanels>
        </Tabs>

        <Divider />

        <Box>
          <Heading size="sm" mb={3}>
            People & Versions
          </Heading>
          {groupedModels.size === 0 ? (
            <Text color="gray.500">No models uploaded yet.</Text>
          ) : (
            <Stack spacing={4}>
              {Array.from(groupedModels.entries()).map(([groupName, entries]) => {
                const sorted = [...entries].sort((a, b) => (b.version || 1) - (a.version || 1));
                return (
                  <Box
                    key={groupName}
                    bg="#0f141f"
                    border="1px solid"
                    borderColor="#1e2636"
                    borderRadius="16px"
                    p={4}
                  >
                    <HStack justify="space-between" align="center" flexWrap="wrap">
                      <Heading size="sm">{groupName}</Heading>
                      <HStack spacing={3}>
                        <Text fontSize="sm" color="gray.500">
                          {sorted.length} version{sorted.length === 1 ? '' : 's'}
                        </Text>
                        <Button
                          size="sm"
                          variant="outline"
                          colorScheme="red"
                          disabled={busy}
                          onClick={() => handleDeletePersonVersions(groupName)}
                        >
                          Delete All
                        </Button>
                      </HStack>
                    </HStack>
                    <Stack spacing={2} mt={3}>
                      {sorted.map((model) => (
                        <HStack key={model.id} justify="space-between" align="center" flexWrap="wrap">
                          <HStack>
                            <Text>v{model.version || 1}</Text>
                            {model.is_active && <Badge colorScheme="green">Active</Badge>}
                          </HStack>
                          <HStack spacing={2}>
                            <Button
                              size="sm"
                              variant="outline"
                              isDisabled={busy || model.is_active}
                              onClick={() => handleActivateModel(model.id)}
                            >
                              {model.is_active ? 'Selected' : 'Set for Inference'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              colorScheme="red"
                              isDisabled={busy}
                              onClick={() => handleDeleteModel(model.id, groupName, model.version || 1)}
                            >
                              Delete
                            </Button>
                          </HStack>
                        </HStack>
                      ))}
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          )}
        </Box>
      </Stack>
    </Box>
  );
}
