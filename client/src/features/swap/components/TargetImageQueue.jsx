import React from 'react';
import { Badge, Box, Button, SimpleGrid, Stack, Text } from '@chakra-ui/react';
import { useSwap } from '../SwapContext.jsx';

function statusLabel(status) {
  if (status === 'uploading') return 'Uploading';
  if (status === 'swapping') return 'Swapping';
  if (status === 'done') return 'Done';
  if (status === 'failed') return 'Failed';
  return 'Pending';
}

function statusColor(status) {
  if (status === 'done') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'uploading' || status === 'swapping') return 'yellow';
  return 'gray';
}

export default function TargetImageQueue() {
  const {
    targetImages,
    addFiles,
    removeImage,
    clearImages,
    handleSwap,
    busy,
    processedCount,
    failedCount,
    pendingCount,
    selectedModelId,
    controlsDisabled,
  } = useSwap();

  return (
    <Stack spacing={2}>
      <Box>
        <Button as="label" variant="outline" isDisabled={controlsDisabled}>
          Add Target Images
          <input
            hidden
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </Button>
      </Box>

      <Box display="flex" flexWrap="wrap" gap={3} alignItems="center" justifyContent="space-between">
        <Text fontSize="sm" color="gray.500">
          Total: {targetImages.length} | Done: {processedCount} | Failed: {failedCount} | Pending: {pendingCount}
        </Text>
        <Box display="flex" gap={2}>
          <Button variant="outline" onClick={clearImages} isDisabled={busy || targetImages.length === 0}>
            Clear All
          </Button>
          <Button
            colorScheme="brand"
            onClick={handleSwap}
            isDisabled={controlsDisabled || !selectedModelId || targetImages.length === 0}
          >
            Process Images
          </Button>
        </Box>
      </Box>

      {targetImages.length === 0 ? (
        <Text fontSize="sm" color="gray.500">
          No images selected.
        </Text>
      ) : (
        <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} spacing={4}>
          {targetImages.map((item) => (
            <Box
              key={item.id}
              bg="#0f141f"
              border="1px solid"
              borderColor="#1e2636"
              borderRadius="16px"
              overflow="hidden"
            >
              <Box as="img" src={item.previewUrl} alt={item.file.name} w="100%" h="180px" objectFit="cover" />
              <Stack spacing={2} p={3}>
                <Text fontSize="sm" noOfLines={1}>
                  {item.file.name}
                </Text>
                <Box display="flex" alignItems="center" justifyContent="space-between">
                  <Badge colorScheme={statusColor(item.status)}>{statusLabel(item.status)}</Badge>
                  <Button
                    size="sm"
                    colorScheme="red"
                    variant="outline"
                    onClick={() => removeImage(item.id)}
                    isDisabled={busy}
                  >
                    Remove
                  </Button>
                </Box>
                {item.error && (
                  <Text fontSize="sm" color="red.300">
                    {item.error}
                  </Text>
                )}
                {item.resultImage && (
                  <Box
                    as="img"
                    src={item.resultImage}
                    alt={`Result for ${item.file.name}`}
                    w="100%"
                    h="180px"
                    objectFit="cover"
                    borderRadius="12px"
                  />
                )}
              </Stack>
            </Box>
          ))}
        </SimpleGrid>
      )}

      {busy && (
        <Text fontSize="sm" color="gray.500">
          Processing queued images...
        </Text>
      )}
    </Stack>
  );
}
