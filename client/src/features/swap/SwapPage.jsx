import React from 'react';
import { Box, SimpleGrid, Stack, Tab, TabList, TabPanel, TabPanels, Tabs, Text } from '@chakra-ui/react';
import ModelSelector from './components/ModelSelector.jsx';
import TargetImageQueue from './components/TargetImageQueue.jsx';
import VideoSwapSection from './components/VideoSwapSection.jsx';
import InputGallerySection from './components/InputGallerySection.jsx';
import { useSwap } from './SwapContext.jsx';

export default function SwapPage() {
  const { swapTab, setSwapTab } = useSwap();
  const tabKeys = ['image', 'video', 'inputs'];
  const activeIndex = Math.max(0, tabKeys.indexOf(swapTab));

  return (
    <Stack spacing={6}>
      <Box
        bg="rgba(17, 22, 34, 0.9)"
        border="1px solid"
        borderColor="#1d2434"
        borderRadius="20px"
        p={{ base: 4, md: 6 }}
        boxShadow="0 10px 30px rgba(0,0,0,0.35)"
      >
        <Text fontSize="xl" fontWeight="semibold" mb={4}>
          Perform Face Swaps
        </Text>
        <Tabs
          variant="enclosed"
          colorScheme="brand"
          index={activeIndex}
          onChange={(index) => setSwapTab(tabKeys[index] || 'image')}
        >
          <TabList>
            <Tab>Image Gen</Tab>
            <Tab>Video Gen</Tab>
            <Tab>Input Images</Tab>
          </TabList>
          <TabPanels>
            <TabPanel px={0}>
              <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={6}>
                <Stack spacing={4}>
                  <ModelSelector />
                  <TargetImageQueue />
                </Stack>
                <Box />
              </SimpleGrid>
            </TabPanel>
            <TabPanel px={0}>
              <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={6}>
                <Stack spacing={4}>
                  <ModelSelector />
                </Stack>
                <Stack spacing={4}>
                  <VideoSwapSection />
                </Stack>
              </SimpleGrid>
            </TabPanel>
            <TabPanel px={0}>
              <InputGallerySection />
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Box>
    </Stack>
  );
}
