import React from 'react';
import { Alert, AlertIcon, Box, Button, Input, Progress, Stack, Text } from '@chakra-ui/react';
import { useSwap } from '../SwapContext.jsx';

export default function VideoSwapSection() {
  const {
    selectedModelId,
    videoFile,
    videoUrl,
    setVideoUrl,
    setVideoSelection,
    clearVideoInput,
    handleVideoSwap,
    videoBusy,
    videoError,
    videoProgress,
    videoPreviewUrl,
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
          Upload one target video and run swap with the selected model version.
        </Text>
      </Box>

      <Box>
        <Button as="label" variant="outline" isDisabled={controlsDisabled}>
          Select Video
          <input
            hidden
            type="file"
            accept="video/*"
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              setVideoSelection(file);
              if (file) {
                setVideoUrl('');
              }
              event.target.value = '';
            }}
          />
        </Button>
        {videoFile && (
          <Text fontSize="sm" color="gray.500" mt={2}>
            Selected: {videoFile.name}
          </Text>
        )}
      </Box>

      <Input
        placeholder="https://example.com/video.mp4"
        value={videoUrl}
        onChange={(event) => {
          setVideoUrl(event.target.value);
          if (event.target.value) {
            setVideoSelection(null);
          }
        }}
        isDisabled={controlsDisabled}
      />

      <Box display="flex" gap={2} flexWrap="wrap">
        <Button
          colorScheme="brand"
          onClick={handleVideoSwap}
          isDisabled={controlsDisabled || !selectedModelId || (!videoFile && !videoUrl)}
        >
          Process Video
        </Button>
        <Button
          variant="outline"
          onClick={clearVideoInput}
          isDisabled={controlsDisabled || (!videoFile && !videoUrl)}
        >
          Clear Video
        </Button>
      </Box>

      {videoBusy && (
        <Box>
          <Progress value={Math.min(100, videoProgress)} />
          <Text fontSize="sm" color="gray.500" mt={2}>
            Processing video... {Math.round(videoProgress)}%
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

      {videoPreviewUrl && (
        <Box>
          <Text fontSize="sm" color="gray.500" mb={2}>
            Input video
          </Text>
          <video src={videoPreviewUrl} controls style={{ maxWidth: '100%' }} />
        </Box>
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
