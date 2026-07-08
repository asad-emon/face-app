import React, { useState } from 'react';
import {
  Box,
  Checkbox,
  FormControl,
  FormLabel,
  Select,
  Slider,
  SliderFilledTrack,
  SliderMark,
  SliderThumb,
  SliderTrack,
  Stack,
  Text,
  Tooltip,
} from '@chakra-ui/react';
import { useSwap } from '../SwapContext.jsx';

export default function ModelSelector() {
  const {
    modelGroups,
    selectedGroup,
    selectedPerson,
    selectedModelId,
    enableRestore,
    setEnableRestore,
    expressionRestoreEnabled,
    expressionStrength,
    setExpressionStrength,
    swapModel,
    setSwapModel,
    handlePersonChange,
    setSelectedModelId,
    controlsDisabled,
  } = useSwap();

  const strengthPct = Math.round(expressionStrength * 100);
  const [showTooltip, setShowTooltip] = useState(false);

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

      {expressionRestoreEnabled && (
        <Checkbox
          isChecked={enableRestore}
          onChange={(event) => setEnableRestore(event.target.checked)}
          isDisabled={controlsDisabled}
        >
          Enable face restore for sharper details and more stable expressions
        </Checkbox>
      )}

      <Box>
        <Text fontSize="sm" mb={4} color="gray.300">
          Expression Strength:{' '}
          <Text as="span" fontWeight="bold" color="brand.200">
            {strengthPct}%
          </Text>
        </Text>
        <Slider
          min={0}
          max={100}
          step={5}
          value={strengthPct}
          onChange={(val) => setExpressionStrength(val / 100)}
          isDisabled={controlsDisabled}
          aria-label="expression-strength"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <SliderMark value={0} mt={2} fontSize="xs" color="gray.500">
            0%
          </SliderMark>
          <SliderMark value={50} mt={2} ml="-3" fontSize="xs" color="gray.500">
            50%
          </SliderMark>
          <SliderMark value={100} mt={2} ml="-6" fontSize="xs" color="gray.500">
            100%
          </SliderMark>
          <SliderTrack bg="whiteAlpha.200">
            <SliderFilledTrack bg="brand.400" />
          </SliderTrack>
          <Tooltip
            hasArrow
            label={`${strengthPct}%`}
            placement="top"
            isOpen={showTooltip}
          >
            <SliderThumb boxSize={4} bg="brand.300" />
          </Tooltip>
        </Slider>
        <Text fontSize="xs" color="gray.500" mt={5}>
          How strongly the target's original expression is restored after the swap.
        </Text>
      </Box>

      <FormControl isDisabled={controlsDisabled}>
        <FormLabel>Swap Engine</FormLabel>
        <Select
          value={swapModel}
          onChange={(event) => setSwapModel(event.target.value)}
        >
          <option value="inswapper_128">InSwapper 128 (default)</option>
          <option value="hyperswap_256">HyperSwap 1B 256</option>
        </Select>
        <Text fontSize="xs" color="gray.500" mt={1}>
          HyperSwap 1B 256 uses a higher-resolution model and may produce sharper results.
        </Text>
      </FormControl>
    </Stack>
  );
}
