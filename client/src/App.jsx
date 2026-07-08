import React from 'react';
import {
  Box,
  Button,
  Container,
  HStack,
  Heading,
  Spinner,
  Stack,
  Tab,
  TabList,
  Tabs,
  Tag,
  Text,
} from '@chakra-ui/react';
import ImageGallery from './ImageGallery';
import ImageUpload from './ImageUpload';
import ModelUpload from './ModelUpload';
import Login from './Login';
import CivitaiGallery from './CivitaiGallery';
import SettingsPage from './SettingsPage';
import { useApp } from './contexts/AppContext.jsx';

function InferenceStatusBanner() {
  const { inferenceStatus, inferenceModelsLoaded, wakeInference } = useApp();

  if (inferenceStatus === 'unknown' || inferenceStatus === 'unconfigured') {
    return null;
  }

  const config = {
    checking: { color: '#3a4256', dot: 'gray.400', label: 'Checking inference service…' },
    online: {
      color: '#1f4d33',
      dot: 'green.400',
      label: inferenceModelsLoaded
        ? 'Inference service is online and warm.'
        : 'Inference service is online (models will load on first swap).',
    },
    waking: { color: '#5a4a1f', dot: 'yellow.400', label: 'Waking up the inference service… this can take a minute.' },
    offline: { color: '#5a2330', dot: 'red.400', label: 'Inference service is offline or asleep.' },
  };
  const current = config[inferenceStatus] || config.offline;

  return (
    <HStack
      justify="space-between"
      align="center"
      bg={current.color}
      borderRadius="12px"
      px={4}
      py={2}
      flexWrap="wrap"
    >
      <HStack spacing={3}>
        {inferenceStatus === 'checking' || inferenceStatus === 'waking' ? (
          <Spinner size="sm" />
        ) : (
          <Box w="10px" h="10px" borderRadius="full" bg={current.dot} />
        )}
        <Text fontSize="sm">{current.label}</Text>
      </HStack>
      {inferenceStatus === 'offline' && (
        <Button size="sm" colorScheme="brand" onClick={wakeInference}>
          Wake up
        </Button>
      )}
    </HStack>
  );
}

export default function App() {
  const { tab, setTab, token, logout } = useApp();
  const tabs = [
    { id: 'model', label: 'Model Upload' },
    { id: 'upload', label: 'Swap' },
    { id: 'gallery', label: 'Gallery' },
    { id: 'civitai', label: 'Civitai' },
    { id: 'settings', label: 'Settings' },
  ];
  const activeIndex = Math.max(0, tabs.findIndex((item) => item.id === tab));

  if (!token) {
    return <Login />;
  }

  return (
    <Container maxW="6xl" py={{ base: 6, md: 10 }}>
      <Stack spacing={6} mb={8}>
        <HStack justify="space-between" align="flex-start" flexWrap="wrap">
          <Box>
            <Tag colorScheme="brand" mb={3}>
              Face App Studio
            </Tag>
            <Heading size="lg">Create, swap, and review media in one place</Heading>
            <Text color="gray.400" mt={2} maxW="560px">
              Run image and video swaps, manage models, and curate your gallery with a focused, production-ready
              workflow.
            </Text>
          </Box>
          <Button variant="outline" colorScheme="red" onClick={logout}>
            Logout
          </Button>
        </HStack>

        <InferenceStatusBanner />

        <Tabs
          index={activeIndex}
          onChange={(index) => setTab(tabs[index].id)}
          variant="enclosed"
          colorScheme="brand"
        >
          <TabList>
            {tabs.map((item) => (
              <Tab key={item.id}>{item.label}</Tab>
            ))}
          </TabList>
        </Tabs>
      </Stack>

      <Box display={tab === 'model' ? 'block' : 'none'}>
        <ModelUpload />
      </Box>
      <Box display={tab === 'upload' ? 'block' : 'none'}>
        <ImageUpload />
      </Box>
      <Box display={tab === 'gallery' ? 'block' : 'none'}>
        <ImageGallery isActive={tab === 'gallery'} />
      </Box>
      <Box display={tab === 'civitai' ? 'block' : 'none'}>
        <CivitaiGallery
          isActive={tab === 'civitai'}
          onUseInputImage={() => setTab('gallery')}
        />
      </Box>
      <Box display={tab === 'settings' ? 'block' : 'none'}>
        <SettingsPage />
      </Box>

      <Text fontSize="sm" color="gray.500" mt={8}>
        A modern, database-driven face swapping application.
      </Text>
    </Container>
  );
}
