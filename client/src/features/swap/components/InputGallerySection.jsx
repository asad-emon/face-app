import React from 'react';
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormLabel,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Text,
} from '@chakra-ui/react';
import { PAGE_SIZE_OPTIONS, useSwap } from '../SwapContext.jsx';

export default function InputGallerySection() {
  const {
    inputImages,
    selectedInputImageIds,
    setSelectedInputImageIds,
    inputImageTotal,
    inputImagePage,
    setInputImagePage,
    inputImagePageSize,
    setInputImagePageSize,
    inputGalleryBusy,
    inputDeleteBusy,
    reInferenceBusy,
    reInferenceProgress,
    reInferencePercent,
    inputImageJobStatus,
    handleReInference,
    deleteInputImages,
    selectedModelId,
    controlsDisabled,
  } = useSwap();

  const totalPages = Math.max(1, Math.ceil(inputImageTotal / inputImagePageSize));

  return (
    <Stack spacing={2}>
      <Text fontSize="lg" fontWeight="semibold">
        Input Image Gallery
      </Text>

      <Box display="flex" gap={2} flexWrap="wrap">
        <Button
          variant="outline"
          onClick={() => {
            const pageIds = inputImages.map((item) => item.id);
            setSelectedInputImageIds((prev) => {
              const next = new Set(prev);
              pageIds.forEach((id) => next.add(id));
              return Array.from(next);
            });
          }}
          isDisabled={inputImages.length === 0 || inputGalleryBusy || inputDeleteBusy || reInferenceBusy}
        >
          Select all (page)
        </Button>
        <Button
          variant="outline"
          onClick={() => setSelectedInputImageIds([])}
          isDisabled={selectedInputImageIds.length === 0 || inputDeleteBusy || reInferenceBusy}
        >
          Clear selection
        </Button>
        <Button
          colorScheme="brand"
          onClick={handleReInference}
          isDisabled={selectedInputImageIds.length === 0 || !selectedModelId || controlsDisabled}
        >
          Re-inference selected ({selectedInputImageIds.length})
        </Button>
        <Button
          variant="outline"
          colorScheme="red"
          onClick={() => deleteInputImages(selectedInputImageIds)}
          isDisabled={selectedInputImageIds.length === 0 || inputDeleteBusy || reInferenceBusy}
        >
          Delete selected ({selectedInputImageIds.length})
        </Button>
      </Box>

      {(reInferenceBusy || reInferenceProgress.total > 0) && (
        <Box
          bg="#0f141f"
          border="1px solid"
          borderColor="#1e2636"
          borderRadius="16px"
          p={4}
        >
          <Text fontSize="sm" color="gray.500">
            Re-inference Progress: {reInferenceProgress.completed}/{reInferenceProgress.total} ({reInferencePercent}%)
          </Text>
          <Text fontSize="sm" color="gray.500">
            Success: {reInferenceProgress.success} | Failed: {reInferenceProgress.failed}
            {reInferenceBusy && reInferenceProgress.currentImageId
              ? ` | Processing image #${reInferenceProgress.currentImageId}`
              : ''}
          </Text>
          <Progress
            value={(reInferenceProgress.completed / Math.max(1, reInferenceProgress.total)) * 100}
            mt={2}
          />
        </Box>
      )}

      {inputGalleryBusy || inputDeleteBusy ? (
        <Text fontSize="sm" color="gray.500">
          Loading input images...
        </Text>
      ) : inputImages.length === 0 ? (
        <Text fontSize="sm" color="gray.500">
          No input images found.
        </Text>
      ) : (
        <>
          <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} spacing={4}>
            {inputImages.map((item) => (
              <Box
                key={item.id}
                bg="#0f141f"
                border="1px solid"
                borderColor="#1e2636"
                borderRadius="16px"
                overflow="hidden"
              >
                <Box
                  as="img"
                  src={`data:image/jpeg;base64,${item.data}`}
                  alt={item.filename || `Input #${item.id}`}
                  w="100%"
                  h="180px"
                  objectFit="cover"
                />
                <Stack spacing={2} p={3}>
                  <Box display="flex" alignItems="center" justifyContent="space-between" gap={2}>
                    <Text fontSize="sm" noOfLines={1}>
                      #{item.id} {item.filename}
                    </Text>
                    <Checkbox
                      isChecked={selectedInputImageIds.includes(item.id)}
                      onChange={() =>
                        setSelectedInputImageIds((prev) =>
                          prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
                        )
                      }
                      isDisabled={inputDeleteBusy || reInferenceBusy}
                    />
                  </Box>
                  {inputImageJobStatus[item.id] && (
                    <Text fontSize="sm" color="gray.500">
                      Job: {inputImageJobStatus[item.id]}
                    </Text>
                  )}
                  <Button
                    variant="outline"
                    colorScheme="red"
                    onClick={() => deleteInputImages([item.id])}
                    isDisabled={inputDeleteBusy || reInferenceBusy}
                    size="sm"
                  >
                    Delete
                  </Button>
                </Stack>
              </Box>
            ))}
          </SimpleGrid>

          <Box display="flex" flexWrap="wrap" justifyContent="space-between" alignItems="center" gap={2} mt={2}>
            <Text fontSize="sm" color="gray.500">
              Page {inputImagePage} / {totalPages} ({inputImageTotal} total)
            </Text>
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <FormControl minW="120px">
                <FormLabel fontSize="sm" mb={1}>
                  Per page
                </FormLabel>
                <Select
                  value={inputImagePageSize}
                  onChange={(event) => {
                    setInputImagePageSize(Number(event.target.value));
                    setInputImagePage(1);
                  }}
                  isDisabled={inputGalleryBusy || inputDeleteBusy || reInferenceBusy}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </Select>
              </FormControl>
              <Button
                variant="outline"
                onClick={() => setInputImagePage((prev) => Math.max(1, prev - 1))}
                isDisabled={inputGalleryBusy || inputDeleteBusy || reInferenceBusy || inputImagePage <= 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                onClick={() => setInputImagePage((prev) => Math.min(totalPages, prev + 1))}
                isDisabled={
                  inputGalleryBusy ||
                  inputDeleteBusy ||
                  reInferenceBusy ||
                  inputImagePage >= totalPages
                }
              >
                Next
              </Button>
            </Box>
          </Box>
        </>
      )}
    </Stack>
  );
}
