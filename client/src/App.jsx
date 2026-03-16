import React from 'react';
import {
  Box,
  Button,
  Container,
  HStack,
  Heading,
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
import { useApp } from './contexts/AppContext.jsx';

export default function App() {
  const { tab, setTab, token, logout } = useApp();
  const tabs = [
    { id: 'model', label: 'Model Upload' },
    { id: 'upload', label: 'Swap' },
    { id: 'gallery', label: 'Gallery' },
    { id: 'civitai', label: 'Civitai' },
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

      <Text fontSize="sm" color="gray.500" mt={8}>
        A modern, database-driven face swapping application.
      </Text>
    </Container>
  );
}
