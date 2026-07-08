import React, { useState } from 'react';
import {
  Box,
  Divider,
  FormControl,
  FormLabel,
  Heading,
  HStack,
  Stack,
  Switch,
  Text,
  useToast,
} from '@chakra-ui/react';
import { useApp } from './contexts/AppContext.jsx';

export default function SettingsPage() {
  const { settings, updateSettings, settingsLoaded } = useApp();
  const [savingKey, setSavingKey] = useState(null);
  const toast = useToast();

  const handleToggle = async (key, checked) => {
    setSavingKey(key);
    try {
      await updateSettings({ [key]: checked });
    } catch (error) {
      toast({
        title: 'Failed to save setting',
        description: error.message || 'Please try again.',
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
    } finally {
      setSavingKey(null);
    }
  };

  const SettingRow = ({ settingKey, title, description }) => (
    <FormControl display="flex" alignItems="flex-start" justifyContent="space-between">
      <Box pr={4}>
        <FormLabel htmlFor={settingKey} mb={1} fontWeight="semibold">
          {title}
        </FormLabel>
        <Text fontSize="sm" color="gray.500">
          {description}
        </Text>
      </Box>
      <Switch
        id={settingKey}
        colorScheme="brand"
        size="lg"
        isChecked={Boolean(settings[settingKey])}
        isDisabled={!settingsLoaded || savingKey === settingKey}
        onChange={(event) => handleToggle(settingKey, event.target.checked)}
      />
    </FormControl>
  );

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
          <Heading size="md">Application Settings</Heading>
          <Text color="gray.500">Configure how your content is processed and stored.</Text>
        </Box>

        <Stack
          spacing={5}
          bg="#0f141f"
          border="1px solid"
          borderColor="#1e2636"
          borderRadius="16px"
          p={{ base: 4, md: 5 }}
        >
          <SettingRow
            settingKey="save_input_files"
            title="Save uploaded input files"
            description="When enabled, the source images and videos you upload are kept in storage. When disabled, inputs are used for the swap and then automatically deleted once the output has been generated."
          />
          <Divider borderColor="#1e2636" />
          <SettingRow
            settingKey="expression_restore_enabled"
            title="Enable expression restore"
            description="Master switch for the face/expression restore feature. When disabled, the restore option is hidden in the swap controls and restore is never applied, even if requested."
          />
        </Stack>

        <HStack color="gray.500" fontSize="sm">
          <Text>{settingsLoaded ? 'Settings are saved to your account.' : 'Loading settings…'}</Text>
        </HStack>
      </Stack>
    </Box>
  );
}
