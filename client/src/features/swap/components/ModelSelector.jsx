import React from 'react';
import { Checkbox, FormControl, FormLabel, Select, Stack } from '@chakra-ui/react';
import { useSwap } from '../SwapContext.jsx';

export default function ModelSelector() {
  const {
    modelGroups,
    selectedGroup,
    selectedPerson,
    selectedModelId,
    enableRestore,
    setEnableRestore,
    handlePersonChange,
    setSelectedModelId,
    controlsDisabled,
  } = useSwap();

  return (
    <Stack
      spacing={3}
      bg="#0f141f"
      border="1px solid"
      borderColor="#1e2636"
      borderRadius="16px"
      p={4}
    >
      <FormControl isDisabled={modelGroups.length === 0 || controlsDisabled}>
        <FormLabel>Person</FormLabel>
        <Select
          value={selectedPerson || ''}
          onChange={(event) => handlePersonChange(event.target.value)}
        >
          <option value="" disabled>
            Select a person
          </option>
          {modelGroups.map((group) => (
            <option key={group.personName} value={group.personName}>
              {group.personName}
            </option>
          ))}
        </Select>
      </FormControl>

      <FormControl isDisabled={!selectedGroup || controlsDisabled}>
        <FormLabel>Version</FormLabel>
        <Select
          value={selectedModelId || ''}
          onChange={(event) => setSelectedModelId(event.target.value)}
        >
          <option value="" disabled>
            Select a version
          </option>
          {(selectedGroup?.versions || []).map((model) => (
            <option key={model.id} value={model.id}>
              v{model.version || 1}
              {model.is_active ? ' (Active)' : ''}
            </option>
          ))}
        </Select>
      </FormControl>

      <Checkbox
        isChecked={enableRestore}
        onChange={(event) => setEnableRestore(event.target.checked)}
        isDisabled={controlsDisabled}
      >
        Enable face restore (slower, better quality)
      </Checkbox>
    </Stack>
  );
}
