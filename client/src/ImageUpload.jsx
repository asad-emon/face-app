import React from 'react';
import { SwapProvider } from './features/swap/SwapContext.jsx';
import SwapPage from './features/swap/SwapPage.jsx';

export default function ImageUpload() {
  return (
    <SwapProvider>
      <SwapPage />
    </SwapProvider>
  );
}
