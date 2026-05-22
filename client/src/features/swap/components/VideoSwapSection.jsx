import React from 'react';
import { Alert, AlertIcon, Box, Button, Input, Progress, Stack, Text } from '@chakra-ui/react';
import { useSwap } from '../SwapContext.jsx';

export default function VideoSwapSection() {
  const {
    selectedModelId,
    videoFiles,
    videoUrl,
    setVideoUrl,
    setVideoSelection,
    clearVideoInput,
    handleVideoSwap,
    videoBusy,
    videoError,
    videoProgress,
    videoPreviewItems,
    videoResultUrl,
    controlsDisabled,
  } = useSwap();

  return (
    <Stack spacing={2}>
      <Box
        bg="#0f141f"
        border="1px solid"
        borderColor="#1e2636"
        borderRadius="16px"
        p={4}
      >
        <Text fontSize="lg" fontWeight="semibold">
          Video Face Swap
        </Text>
        <Text fontSize="sm" color="gray.500">
          Upload target videos and run swaps with the selected model version.
        </Text>
      </Box>

      <Box>
        <Button as="label" variant="outline" isDisabled={controlsDisabled}>
          Select Video
          <input
            hidden
            type="file"
            accept="video/*"
            multiple
            onChange={(event) => {
              const files = event.target.files;
              setVideoSelection(files);
              if (files && files.length > 0) {
                setVideoUrl('');
              }
              event.target.value = '';
            }}
          />
        </Button>
        {videoFiles.length > 0 && (
          <Text fontSize="sm" color="gray.500" mt={2}>
            Selected: {videoFiles.length} video{videoFiles.length === 1 ? '' : 's'}
          </Text>
        )}
      </Box>

      <Input
        placeholder="https://example.com/video.mp4"
        value={videoUrl}
        onChange={(event) => {
          setVideoUrl(event.target.value);
          if (event.target.value) {
            setVideoSelection([]);
          }
        }}
        isDisabled={controlsDisabled}
      />

      <Box display="flex" gap={2} flexWrap="wrap">
        <Button
          colorScheme="brand"
          onClick={handleVideoSwap}
          isDisabled={controlsDisabled || !selectedModelId || (videoFiles.length === 0 && !videoUrl)}
        >
          Process Videos
        </Button>
        <Button
          variant="outline"
          onClick={clearVideoInput}
          isDisabled={controlsDisabled || (videoFiles.length === 0 && !videoUrl)}
        >
          Clear Videos
        </Button>
      </Box>

      {videoBusy && (
        <Box>
          <Progress value={Math.min(100, videoProgress)} />
          <Text fontSize="sm" color="gray.500" mt={2}>
            Queueing video jobs... {Math.round(videoProgress)}%
          </Text>
        </Box>
      )}
      {!videoBusy && videoProgress > 0 && (
        <Progress value={Math.min(100, videoProgress)} />
      )}
      {videoError && (
        <Alert status="error" borderRadius="8px">
          <AlertIcon />
          {videoError}
        </Alert>
      )}

      {videoPreviewItems.length > 0 && (
        <Stack spacing={3}>
          <Text fontSize="sm" color="gray.500" mb={2}>
            Input videos
          </Text>
          {videoPreviewItems.map((item) => (
            <Box key={item.id}>
              <Text fontSize="sm" color="gray.500" mb={2} noOfLines={1}>
                {item.file.name}
              </Text>
              <video src={item.previewUrl} controls style={{ maxWidth: '100%' }} />
            </Box>
          ))}
        </Stack>
      )}

      {videoResultUrl && (
        <Box>
          <Text fontSize="sm" color="gray.500" mb={2}>
            Swapped video
          </Text>
          <video src={videoResultUrl} controls style={{ maxWidth: '100%' }} />
        </Box>
      )}
    </Stack>
  );
}
